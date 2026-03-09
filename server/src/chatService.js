const config = require("./config");
const db = require("./db");
const { createMockResponse } = require("./mockProvider");
const { createOpenAiCompatibleResponse } = require("./openAiCompatibleProvider");
const { createGeminiResponse } = require("./geminiProvider");
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

async function executeRound({ conversationId, question, roundNumber, mode, previousResponses }) {
  const round = await db.createRound(conversationId, roundNumber, mode);

  const jobs = config.agents.map(async (agent) => {
    const previousSelf = previousResponses.find((item) => item.agentId === agent.id);
    const peerResponses = previousResponses.filter(
      (item) => item.agentId !== agent.id && item.status === "completed"
    );

    const messages =
      mode === "initial"
        ? buildInitialMessages({ question })
        : buildIterationMessages({
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

      const payload = {
        conversationId,
        roundId: round.id,
        agentId: agent.id,
        agentName: agent.name,
        model: agent.model,
        status: "completed",
        responseText,
        errorMessage: null,
        peerContext: peerResponses.map((item) => ({
          agentId: item.agentId,
          agentName: item.agentName,
          excerpt: String(item.responseText || "").slice(0, 200)
        }))
      };

      await db.insertAgentResponse(payload);
      return payload;
    } catch (error) {
      const userError = sanitizeAgentError(error);
      const payload = {
        conversationId,
        roundId: round.id,
        agentId: agent.id,
        agentName: agent.name,
        model: agent.model,
        status: "failed",
        responseText: `${agent.name} 当前未返回结果。`,
        errorMessage: userError,
        peerContext: peerResponses.map((item) => ({
          agentId: item.agentId,
          agentName: item.agentName,
          excerpt: String(item.responseText || "").slice(0, 200)
        }))
      };

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

async function createConversation(questionInput) {
  const question = normalizeQuestion(questionInput);

  if (!question) {
    throw badRequest("Question is required.");
  }

  if (question.length > 4000) {
    throw badRequest("Question is too long. Please keep it within 4000 characters.");
  }

  const conversation = await db.createConversation(question);
  await db.updateConversationStatus(conversation.id, "running");

  let hasFailures = false;
  let finalStatus = "completed";

  try {
    const initialResult = await executeRound({
      conversationId: conversation.id,
      question,
      roundNumber: 1,
      mode: "initial",
      previousResponses: []
    });

    hasFailures = hasFailures || initialResult.hasFailures;

    const refinementResult = await executeRound({
      conversationId: conversation.id,
      question,
      roundNumber: 2,
      mode: "iteration",
      previousResponses: initialResult.responses
    });

    hasFailures = hasFailures || refinementResult.hasFailures;
    finalStatus = hasFailures ? "completed_with_errors" : "completed";
  } catch (error) {
    finalStatus = "failed";
    throw error;
  } finally {
    await db.updateConversationStatus(conversation.id, finalStatus);
  }

  return db.getConversationById(conversation.id);
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
  iterateConversation,
  listConversations,
  getConversationById,
  getAgents
};
