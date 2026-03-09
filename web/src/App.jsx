import { startTransition, useEffect, useState } from "react";

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

function getLatestRound(conversation) {
  if (!conversation?.rounds?.length) {
    return null;
  }

  return conversation.rounds[conversation.rounds.length - 1];
}

function buildResponseMap(conversation) {
  const latestRound = getLatestRound(conversation);
  return new Map((latestRound?.responses || []).map((response) => [response.agentId, response]));
}

function AnswerCard({ agent, response, loading }) {
  const stateLabel = response
    ? response.status === "completed"
      ? "Final"
      : "Error"
    : loading
      ? "Thinking"
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
        <div className="answer-placeholder">{loading ? "正在结合另外两个回答生成最终答案..." : "等待提问"}</div>
      )}

      {response?.errorMessage ? <p className="answer-error">{response.errorMessage}</p> : null}
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
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    const nextQuestion = question.trim();
    if (!nextQuestion) {
      return;
    }

    setSubmitting(true);
    setError("");
    setConversation(null);
    setActiveQuestion(nextQuestion);

    try {
      const payload = await request("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ question: nextQuestion })
      });

      startTransition(() => {
        setConversation(payload.conversation);
        setQuestion("");
      });
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const responseMap = buildResponseMap(conversation);
  const shownQuestion = conversation?.question || activeQuestion;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">multi-ai-chat</div>
        <div className="topbar-status">
          {submitting ? "正在生成 3 个最终回答" : loadingAgents ? "加载模型中" : "两轮自动协作"}
        </div>
      </header>

      {shownQuestion ? <section className="question-strip">{shownQuestion}</section> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <main className="answers-grid">
        {agents.map((agent) => (
          <AnswerCard
            key={agent.id}
            agent={agent}
            response={responseMap.get(agent.id)}
            loading={submitting}
          />
        ))}
      </main>

      <form className="composer" onSubmit={handleSubmit}>
        <label className="composer-shell" htmlFor="question">
          <textarea
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="输入问题，系统会让 3 个模型先各答一轮，再互相参考后输出最终答案。"
            rows={3}
            maxLength={4000}
            disabled={submitting}
          />
          <div className="composer-actions">
            <span className="composer-meta">{question.length}/4000</span>
            <button
              className="send-button"
              type="submit"
              disabled={submitting || !question.trim()}
            >
              {submitting ? "生成中..." : "发送"}
            </button>
          </div>
        </label>
      </form>
    </div>
  );
}
