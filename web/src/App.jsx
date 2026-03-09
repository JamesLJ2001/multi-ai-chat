import { startTransition, useEffect, useRef, useState } from "react";

const defaultAgents = [
  { id: "deepseek", name: "DeepSeek", accentColor: "#246b4f", model: "deepseek-reasoner" },
  { id: "gemini", name: "Gemini", accentColor: "#4c6fff", model: "gemini-2.5-flash" },
  { id: "grok", name: "Grok", accentColor: "#111111", model: "grok-3" }
];

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function createRound(roundNumber, mode) {
  return {
    roundNumber,
    mode,
    responses: []
  };
}

function createPendingConversation(question) {
  return {
    id: null,
    title: question,
    question,
    status: "running",
    totalRounds: 2,
    rounds: [createRound(1, "initial"), createRound(2, "iteration")]
  };
}

function cloneConversation(conversation) {
  if (!conversation) {
    return null;
  }

  return {
    ...conversation,
    rounds: (conversation.rounds || []).map((round) => ({
      ...round,
      responses: (round.responses || []).map((response) => ({ ...response }))
    }))
  };
}

function ensureRound(conversation, roundNumber, mode) {
  let round = conversation.rounds.find((item) => item.roundNumber === roundNumber);

  if (!round) {
    round = createRound(roundNumber, mode || "initial");
    conversation.rounds.push(round);
    conversation.rounds.sort((left, right) => left.roundNumber - right.roundNumber);
  }

  if (mode) {
    round.mode = mode;
  }

  return round;
}

function ensureResponse(round, agent) {
  let response = round.responses.find((item) => item.agentId === agent.id);

  if (!response) {
    response = {
      agentId: agent.id,
      agentName: agent.name,
      model: agent.model,
      status: "running",
      responseText: "",
      errorMessage: null
    };
    round.responses.push(response);
  }

  return response;
}

function appendCharacters(conversation, updates) {
  if (!conversation) {
    return conversation;
  }

  const nextConversation = cloneConversation(conversation);

  for (const update of updates) {
    const round = nextConversation.rounds.find((item) => item.roundNumber === update.roundNumber);

    if (!round) {
      continue;
    }

    const response = round.responses.find((item) => item.agentId === update.agentId);

    if (!response) {
      continue;
    }

    response.responseText = `${response.responseText || ""}${update.char}`;
  }

  return nextConversation;
}

function applyStreamEvent(conversation, event) {
  const baseConversation =
    cloneConversation(conversation) ||
    createPendingConversation(event?.conversation?.question || "");

  switch (event.type) {
    case "conversation.created":
      return {
        ...baseConversation,
        ...event.conversation,
        rounds: baseConversation.rounds?.length ? baseConversation.rounds : event.conversation.rounds || []
      };
    case "round.started": {
      ensureRound(baseConversation, event.round.roundNumber, event.round.mode);
      return baseConversation;
    }
    case "response.started": {
      const round = ensureRound(baseConversation, event.roundNumber, null);
      const response = ensureResponse(round, event.agent);
      response.agentName = event.agent.name;
      response.model = event.agent.model;
      response.status = "running";
      response.errorMessage = null;
      return baseConversation;
    }
    case "response.completed": {
      const round = ensureRound(baseConversation, event.roundNumber, null);
      const response = ensureResponse(round, {
        id: event.agentId,
        name: event.response.agentName,
        model: event.response.model
      });
      response.agentName = event.response.agentName;
      response.model = event.response.model;
      response.status = event.response.status;
      response.errorMessage = event.response.errorMessage;

      if (!response.responseText) {
        response.responseText = event.response.responseText;
      }

      return baseConversation;
    }
    case "response.failed": {
      const round = ensureRound(baseConversation, event.roundNumber, null);
      const response = ensureResponse(round, {
        id: event.agentId,
        name: event.response.agentName,
        model: event.response.model
      });
      response.agentName = event.response.agentName;
      response.model = event.response.model;
      response.status = event.response.status;
      response.errorMessage = event.response.errorMessage;

      if (!response.responseText) {
        response.responseText = event.response.responseText;
      }

      return baseConversation;
    }
    default:
      return baseConversation;
  }
}

function getRoundTitle(round) {
  return `第 ${round.roundNumber} 轮`;
}

function getRoundSubtitle(round) {
  if (round.mode === "initial") {
    return "先各自独立回答";
  }

  return "读取另外两份回答后再次回答";
}

function getPlaceholder(round, loading) {
  if (!loading) {
    return "等待提问";
  }

  if (round.mode === "initial") {
    return "这一轮正在实时生成...";
  }

  return "这一轮会在第 1 轮结束后，继续在下面实时生成...";
}

function AnswerCard({ agent, response, round, loading }) {
  const stateLabel = response
    ? response.status === "completed"
      ? "Done"
      : response.status === "failed"
        ? "Error"
        : "Live"
    : loading
      ? "Waiting"
      : "Idle";

  return (
    <section className="answer-card" style={{ "--accent": agent.accentColor || "#111111" }}>
      <header className="answer-head">
        <div className="answer-agent">
          <span className="agent-dot" />
          <div>
            <h2>{agent.name}</h2>
            <p>{agent.model || "model"}</p>
          </div>
        </div>
        <span className="answer-state">{stateLabel}</span>
      </header>

      {response ? (
        <pre className="answer-text">{response.responseText}</pre>
      ) : (
        <div className="answer-placeholder">{getPlaceholder(round, loading)}</div>
      )}

      {response?.errorMessage ? <p className="answer-error">{response.errorMessage}</p> : null}
    </section>
  );
}

function RoundSection({ round, agents, loading }) {
  return (
    <section className="round-section">
      <header className="round-head">
        <h2>{getRoundTitle(round)}</h2>
        <p>{getRoundSubtitle(round)}</p>
      </header>

      <div className="answers-grid">
        {agents.map((agent) => {
          const response = (round.responses || []).find((item) => item.agentId === agent.id) || null;

          return (
            <AnswerCard
              key={`${round.roundNumber}-${agent.id}`}
              agent={agent}
              response={response}
              round={round}
              loading={loading}
            />
          );
        })}
      </div>
    </section>
  );
}

export default function App() {
  const [agents, setAgents] = useState(defaultAgents);
  const [conversation, setConversation] = useState(null);
  const [question, setQuestion] = useState("");
  const [activeQuestion, setActiveQuestion] = useState("");
  const [error, setError] = useState("");
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [animating, setAnimating] = useState(false);

  const pendingCharsRef = useRef(new Map());
  const flushTimerRef = useRef(null);
  const finalConversationRef = useRef(null);
  const streamControllerRef = useRef(null);

  function stopFlushTimer() {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    setAnimating(false);
  }

  function ensureFlushTimer() {
    if (flushTimerRef.current) {
      return;
    }

    setAnimating(true);
    flushTimerRef.current = setInterval(() => {
      const updates = [];

      for (const [key, queue] of pendingCharsRef.current.entries()) {
        if (!queue) {
          pendingCharsRef.current.delete(key);
          continue;
        }

        const char = queue[0];
        const rest = queue.slice(1);
        const [roundNumber, agentId] = key.split(":");

        updates.push({
          roundNumber: Number(roundNumber),
          agentId,
          char
        });

        if (rest) {
          pendingCharsRef.current.set(key, rest);
        } else {
          pendingCharsRef.current.delete(key);
        }
      }

      if (updates.length > 0) {
        startTransition(() => {
          setConversation((current) => appendCharacters(current, updates));
        });
      }

      if (pendingCharsRef.current.size === 0) {
        stopFlushTimer();

        if (finalConversationRef.current) {
          const finalConversation = finalConversationRef.current;
          finalConversationRef.current = null;
          startTransition(() => {
            setConversation(finalConversation);
          });
        }
      }
    }, 14);
  }

  function queueDelta(roundNumber, agentId, delta) {
    const key = `${roundNumber}:${agentId}`;
    pendingCharsRef.current.set(key, `${pendingCharsRef.current.get(key) || ""}${delta}`);
    ensureFlushTimer();
  }

  function handleStreamEvent(event) {
    if (event.type === "response.delta") {
      queueDelta(event.roundNumber, event.agentId, event.delta);
      return;
    }

    if (event.type === "conversation.completed") {
      finalConversationRef.current = event.conversation;

      if (pendingCharsRef.current.size === 0) {
        startTransition(() => {
          setConversation(event.conversation);
        });
        finalConversationRef.current = null;
      }

      return;
    }

    if (event.type === "error" || event.type === "conversation.failed") {
      setError(event.error || "生成失败。");
      return;
    }

    startTransition(() => {
      setConversation((current) => applyStreamEvent(current, event));
    });
  }

  useEffect(() => {
    let disposed = false;

    async function loadAgents() {
      try {
        const payload = await request(`/api/agents?t=${Date.now()}`);

        if (disposed) {
          return;
        }

        const nextAgents = Array.isArray(payload.agents) && payload.agents.length > 0
          ? payload.agents.slice(0, 3)
          : defaultAgents;

        startTransition(() => {
          setAgents(nextAgents);
        });
      } catch (loadError) {
        if (!disposed) {
          setError(loadError.message);
        }
      } finally {
        if (!disposed) {
          setLoadingAgents(false);
        }
      }
    }

    loadAgents();

    return () => {
      disposed = true;

      if (streamControllerRef.current) {
        streamControllerRef.current.abort();
      }

      pendingCharsRef.current.clear();
      finalConversationRef.current = null;
      stopFlushTimer();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    const nextQuestion = question.trim();

    if (!nextQuestion) {
      return;
    }

    if (streamControllerRef.current) {
      streamControllerRef.current.abort();
    }

    pendingCharsRef.current.clear();
    finalConversationRef.current = null;
    stopFlushTimer();
    setSubmitting(true);
    setError("");
    setActiveQuestion(nextQuestion);
    setConversation(createPendingConversation(nextQuestion));

    const controller = new AbortController();
    streamControllerRef.current = controller;

    try {
      const response = await fetch("/api/conversations/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ question: nextQuestion }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const message = await response.text().catch(() => "");
        throw new Error(message || "Request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();

          if (!line) {
            continue;
          }

          try {
            handleStreamEvent(JSON.parse(line));
          } catch (error) {
            continue;
          }
        }
      }

      if (buffer.trim()) {
        try {
          handleStreamEvent(JSON.parse(buffer.trim()));
        } catch (error) {
          // ignore trailing malformed chunks
        }
      }

      startTransition(() => {
        setQuestion("");
      });
    } catch (submitError) {
      if (submitError.name !== "AbortError") {
        setError(submitError.message || "生成失败。");
      }
    } finally {
      streamControllerRef.current = null;
      setSubmitting(false);

      if (pendingCharsRef.current.size === 0 && finalConversationRef.current) {
        const finalConversation = finalConversationRef.current;
        finalConversationRef.current = null;
        startTransition(() => {
          setConversation(finalConversation);
        });
      }
    }
  }

  const shownQuestion = conversation?.question || activeQuestion;
  const visibleRounds = conversation?.rounds?.length ? conversation.rounds : [];
  const isBusy = submitting || animating;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">multi-ai-chat</div>
        <div className="topbar-status">
          {isBusy ? "实时生成中" : loadingAgents ? "加载模型中" : "两轮实时协作"}
        </div>
      </header>

      {shownQuestion ? <section className="question-strip">{shownQuestion}</section> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <main className="rounds-stack">
        {visibleRounds.length > 0 ? (
          visibleRounds.map((round) => (
            <RoundSection
              key={`${round.roundNumber}-${round.mode}`}
              round={round}
              agents={agents}
              loading={isBusy}
            />
          ))
        ) : (
          <div className="answers-grid">
            {agents.map((agent) => (
              <AnswerCard
                key={`idle-${agent.id}`}
                agent={agent}
                response={null}
                round={createRound(1, "initial")}
                loading={false}
              />
            ))}
          </div>
        )}
      </main>

      <form className="composer" onSubmit={handleSubmit}>
        <label className="composer-shell" htmlFor="question">
          <textarea
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="输入问题，三个模型会先各答一轮，再继续生成第二轮答案。"
            rows={3}
            maxLength={4000}
            disabled={isBusy}
          />
          <div className="composer-actions">
            <span className="composer-meta">{question.length}/4000</span>
            <button
              className="send-button"
              type="submit"
              disabled={isBusy || !question.trim()}
            >
              {isBusy ? "生成中..." : "发送"}
            </button>
          </div>
        </label>
      </form>
    </div>
  );
}
