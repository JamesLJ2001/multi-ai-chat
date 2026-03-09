const config = require("./config");
const db = require("./db");
const { createMockResponse, streamMockResponse } = require("./mockProvider");
const {
  createOpenAiCompatibleResponse,
  streamOpenAiCompatibleResponse
} = require("./openAiCompatibleProvider");
const { createGeminiResponse, streamGeminiResponse } = require("./geminiProvider");
const { buildInitialMessages, buildIterationMessages } = require("./prompts");

function publicAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    accentColor: agent.accentColor,
    configured: Boolean(agent.configured)
  };
}

function normalizeQuestion(question) {
  return String(question || "").replace(/\r/g, "").trim();
}

function clampRounds(rounds) {
  const value = Number(rounds);

  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(5, Math.max(1, Math.floor(value)));
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function createConfigurationError(message) {
  const error = new Error(message);
  error.code = "agent_not_configured";
  return error;
}

function sanitizeAgentError(error) {
  if (error?.name === "AbortError") {
    return "请求超时。";
  }

  if (error?.code === "agent_not_configured") {
    return "未配置 API Key。";
  }

  if (error?.statusCode === 401 || error?.statusCode === 403) {
    return "认证失败。";
  }

  if (error?.statusCode === 429) {
    return "请求过多，请稍后再试。";
  }

  if (error?.statusCode >= 500) {
    return "上游服务暂时不可用。";
  }

  return "上游请求失败。";
}

function validateQuestion(questionInput) {
  const question = normalizeQuestion(questionInput);

  if (!question) {
    throw badRequest("Question is required.");
  }

  if (question.length > 4000) {
    throw badRequest("Question is too long. Please keep it within 4000 characters.");
  }

  return question;
}

function buildPeerContext(peerResponses) {
  return peerResponses.map((item) => ({
    agentId: item.agentId,
    agentName: item.agentName,
    excerpt: String(item.responseText || "").slice(0, 200)
  }));
}

function buildMessages({ mode, question, previousSelfResponse, peerResponses }) {
  return mode === "initial"
    ? buildInitialMessages({ question })
    : buildIterationMessages({
        question,
        previousSelfResponse,
        peerResponses
      });
}

function emitEvent(emit, event) {
  if (typeof emit === "function") {
    emit(event);
  }
}

function buildSuccessPayload({ conversationId, roundId, agent, responseText, peerResponses }) {
  return {
    conversationId,
    roundId,
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model,
    status: "completed",
    responseText,
    errorMessage: null,
    peerContext: buildPeerContext(peerResponses)
  };
}

function buildFailurePayload({ conversationId, roundId, agent, peerResponses, errorMessage }) {
  return {
    conversationId,
    roundId,
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model,
    status: "failed",
    responseText: `${agent.name} 当前未返回结果。`,
    errorMessage,
    peerContext: buildPeerContext(peerResponses)
  };
}

async function runAgent(agent, messages, runtime) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    if (config.mockMode) {
      return createMockResponse({
        agent,
        question: runtime.question,
        roundNumber: runtime.roundNumber,
        peerResponses: runtime.peerResponses,
        previousSelfResponse: runtime.previousSelfResponse
      });
    }

    if (!agent.configured) {
      throw createConfigurationError(`Agent "${agent.name}" is not configured.`);
    }

    if (agent.provider === "openai-compatible") {
      return await createOpenAiCompatibleResponse({
        agent,
        messages,
        signal: controller.signal
      });
    }

    if (agent.provider === "gemini") {
      return await createGeminiResponse({
        agent,
        messages,
        signal: controller.signal
      });
    }

    if (agent.provider === "mock") {
      return createMockResponse({
        agent,
        question: runtime.question,
        roundNumber: runtime.roundNumber,
        peerResponses: runtime.peerResponses,
        previousSelfResponse: runtime.previousSelfResponse
      });
    }

    throw new Error(`Unsupported provider "${agent.provider}".`);
  } finally {
    clearTimeout(timeout);
  }
}

async function runAgentStream(agent, messages, runtime, onDelta) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    if (config.mockMode) {
      return await streamMockResponse({
        agent,
        question: runtime.question,
        roundNumber: runtime.roundNumber,
        onDelta
      });
    }

    if (!agent.configured) {
      throw createConfigurationError(`Agent "${agent.name}" is not configured.`);
    }

    if (agent.provider === "openai-compatible") {
      return await streamOpenAiCompatibleResponse({
        agent,
        messages,
        signal: controller.signal,
        onDelta
      });
    }

    if (agent.provider === "gemini") {
      return await streamGeminiResponse({
        agent,
        messages,
        signal: controller.signal,
        onDelta
      });
    }

    if (agent.provider === "mock") {
      return await streamMockResponse({
        agent,
        question: runtime.question,
        roundNumber: runtime.roundNumber,
        onDelta
      });
    }

    throw new Error(`Unsupported provider "${agent.provider}".`);
  } finally {
    clearTimeout(timeout);
  }
}

async function executeRound({ conversationId, question, roundNumber, mode, previousResponses }) {
  const round = await db.createRound(conversationId, roundNumber, mode);

  const jobs = config.agents.map(async (agent) => {
    const previousSelf = previousResponses.find((item) => item.agentId === agent.id);
    const peerResponses = previousResponses.filter(
      (item) => item.agentId !== agent.id && item.status === "completed"
    );
    const messages = buildMessages({
      mode,
      question,
      previousSelfResponse: previousSelf?.responseText || "",
      peerResponses
    });

    try {
      const responseText = await runAgent(agent, messages, {
        question,
        roundNumber,
        peerResponses,
        previousSelfResponse: previousSelf?.responseText || ""
      });

      const payload = buildSuccessPayload({
        conversationId,
        roundId: round.id,
        agent,
        responseText,
        peerResponses
      });

      await db.insertAgentResponse(payload);
      return payload;
    } catch (error) {
      const payload = buildFailurePayload({
        conversationId,
        roundId: round.id,
        agent,
        peerResponses,
        errorMessage: sanitizeAgentError(error)
      });

      await db.insertAgentResponse(payload);
      return payload;
    }
  });

  const responses = await Promise.all(jobs);
  return {
    round,
    responses,
    hasFailures: responses.some((item) => item.status !== "completed")
  };
}

async function executeStreamingRound({
  conversationId,
  question,
  roundNumber,
  mode,
  previousResponses,
  emit
}) {
  const round = await db.createRound(conversationId, roundNumber, mode);
  emitEvent(emit, {
    type: "round.started",
    round: {
      roundNumber,
      mode
    }
  });

  const jobs = config.agents.map(async (agent) => {
    const previousSelf = previousResponses.find((item) => item.agentId === agent.id);
    const peerResponses = previousResponses.filter(
      (item) => item.agentId !== agent.id && item.status === "completed"
    );
    const messages = buildMessages({
      mode,
      question,
      previousSelfResponse: previousSelf?.responseText || "",
      peerResponses
    });

    emitEvent(emit, {
      type: "response.started",
      roundNumber,
      agent: {
        id: agent.id,
        name: agent.name,
        model: agent.model
      }
    });

    try {
      const responseText = await runAgentStream(
        agent,
        messages,
        {
          question,
          roundNumber,
          peerResponses,
          previousSelfResponse: previousSelf?.responseText || ""
        },
        (delta) => {
          emitEvent(emit, {
            type: "response.delta",
            roundNumber,
            agentId: agent.id,
            delta
          });
        }
      );

      const payload = buildSuccessPayload({
        conversationId,
        roundId: round.id,
        agent,
        responseText,
        peerResponses
      });

      await db.insertAgentResponse(payload);
      emitEvent(emit, {
        type: "response.completed",
        roundNumber,
        agentId: agent.id,
        response: {
          agentId: payload.agentId,
          agentName: payload.agentName,
          model: payload.model,
          status: payload.status,
          responseText: payload.responseText,
          errorMessage: payload.errorMessage
        }
      });
      return payload;
    } catch (error) {
      const payload = buildFailurePayload({
        conversationId,
        roundId: round.id,
        agent,
        peerResponses,
        errorMessage: sanitizeAgentError(error)
      });

      await db.insertAgentResponse(payload);
      emitEvent(emit, {
        type: "response.failed",
        roundNumber,
        agentId: agent.id,
        response: {
          agentId: payload.agentId,
          agentName: payload.agentName,
          model: payload.model,
          status: payload.status,
          responseText: payload.responseText,
          errorMessage: payload.errorMessage
        }
      });
      return payload;
    }
  });

  const responses = await Promise.all(jobs);
  const hasFailures = responses.some((item) => item.status !== "completed");

  emitEvent(emit, {
    type: "round.completed",
    round: {
      roundNumber,
      mode,
      hasFailures
    }
  });

  return {
    round,
    responses,
    hasFailures
  };
}

async function runConversationWorkflow(questionInput, emit) {
  const question = validateQuestion(questionInput);
  const conversation = await db.createConversation(question);

  await db.updateConversationStatus(conversation.id, "running");

  emitEvent(emit, {
    type: "conversation.created",
    conversation: {
      ...conversation,
      status: "running",
      totalRounds: 0,
      rounds: []
    }
  });

  let hasFailures = false;
  let finalStatus = "completed";

  try {
    const execute = emit ? executeStreamingRound : executeRound;

    const initialResult = await execute({
      conversationId: conversation.id,
      question,
      roundNumber: 1,
      mode: "initial",
      previousResponses: [],
      emit
    });

    hasFailures = hasFailures || initialResult.hasFailures;

    const refinementResult = await execute({
      conversationId: conversation.id,
      question,
      roundNumber: 2,
      mode: "iteration",
      previousResponses: initialResult.responses,
      emit
    });

    hasFailures = hasFailures || refinementResult.hasFailures;
    finalStatus = hasFailures ? "completed_with_errors" : "completed";
  } catch (error) {
    finalStatus = "failed";
    emitEvent(emit, {
      type: "conversation.failed",
      error: error.message || "Unexpected server error."
    });
    throw error;
  } finally {
    await db.updateConversationStatus(conversation.id, finalStatus);
  }

  const finalConversation = await db.getConversationById(conversation.id);
  emitEvent(emit, {
    type: "conversation.completed",
    conversation: finalConversation
  });

  return finalConversation;
}

async function createConversation(questionInput) {
  return runConversationWorkflow(questionInput);
}

async function streamConversation(questionInput, emit) {
  return runConversationWorkflow(questionInput, emit);
}

async function iterateConversation(conversationId, requestedRounds) {
  const roundsToRun = clampRounds(requestedRounds);
  let currentConversation = await db.getConversationById(conversationId);

  if (!currentConversation) {
    return null;
  }

  await db.updateConversationStatus(conversationId, "running");

  let hasFailures = false;

  try {
    for (let step = 0; step < roundsToRun; step += 1) {
      currentConversation = await db.getConversationById(conversationId);
      const previousRound = currentConversation.rounds[currentConversation.rounds.length - 1];

      const result = await executeRound({
        conversationId,
        question: currentConversation.question,
        roundNumber: previousRound ? previousRound.roundNumber + 1 : 1,
        mode: previousRound ? "iteration" : "initial",
        previousResponses: previousRound ? previousRound.responses : []
      });

      if (result.hasFailures) {
        hasFailures = true;
      }
    }
  } catch (error) {
    await db.updateConversationStatus(conversationId, "failed");
    throw error;
  }

  await db.updateConversationStatus(
    conversationId,
    hasFailures ? "completed_with_errors" : "completed"
  );

  return db.getConversationById(conversationId);
}

async function listConversations() {
  return db.listConversations();
}

async function getConversationById(conversationId) {
  return db.getConversationById(conversationId);
}

function getAgents() {
  return config.agents.map(publicAgent);
}

module.exports = {
  createConversation,
  streamConversation,
  iterateConversation,
  listConversations,
  getConversationById,
  getAgents
};
