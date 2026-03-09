import { startTransition, useDeferredValue, useEffect, useState } from "react";

const starterQuestion =
  "帮我设计一个多 AI 协作问答应用，要求支持多个模型并发回答、互相读取对方回答后再次作答，并且能继续多轮迭代。";

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

function formatDate(value) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status) {
  if (!status) {
    return "--";
  }

  if (status === "completed_with_errors") {
    return "部分失败";
  }

  if (status === "failed") {
    return "失败";
  }

  if (status === "running") {
    return "运行中";
  }

  return "完成";
}

function EmptyState({ agents }) {
  return (
    <section className="empty-state">
      <div className="empty-badge">协作流程</div>
      <h2>先提出问题，再让多个代理同时作答。</h2>
      <p>
        首轮结果出来后，系统会把每个代理的答案发给其他代理做交叉阅读。你可以继续追加轮次，让他们不断修订立场。
      </p>

      <div className="flow-grid">
        <div className="flow-card">
          <span>01</span>
          <strong>并发首轮</strong>
          <p>同一个问题同时发送给所有代理。</p>
        </div>
        <div className="flow-card">
          <span>02</span>
          <strong>互看答案</strong>
          <p>每个代理收到其他代理的上一轮回答。</p>
        </div>
        <div className="flow-card">
          <span>03</span>
          <strong>继续迭代</strong>
          <p>用户可以决定是否再跑 1 到 5 轮修订。</p>
        </div>
      </div>

      <div className="agent-strip">
        {agents.map((agent) => (
          <div
            className="agent-pill"
            key={agent.id}
            style={{ "--accent": agent.accentColor || "#d1603d" }}
          >
            <strong>{agent.name}</strong>
            <span>
              {agent.role} · {agent.provider}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ResponseCard({ response, accentColor }) {
  const peerNames = (response.peerContext || []).map((item) => item.agentName).filter(Boolean);

  return (
    <article className="response-card" style={{ "--accent": accentColor || "#d1603d" }}>
      <div className="response-head">
        <div>
          <p className="eyebrow">{response.agentRole || "Collaborator"}</p>
          <h4>{response.agentName}</h4>
        </div>
        <div className={`status status-${response.status}`}>
          <span>{response.status === "completed" ? "OK" : "ERR"}</span>
        </div>
      </div>

      <p className="model-tag">{response.model}</p>
      <pre className="response-text">{response.responseText}</pre>

      <div className="response-meta">
        <span>{formatDate(response.createdAt)}</span>
        <span>{peerNames.length ? `参考: ${peerNames.join(" / ")}` : "独立首轮"}</span>
      </div>

      {response.errorMessage ? <p className="error-text">{response.errorMessage}</p> : null}
    </article>
  );
}

function RoundSection({ round, agents }) {
  return (
    <section className="round-section">
      <div className="round-header">
        <div>
          <p className="eyebrow">{round.mode === "initial" ? "首轮并发" : "协作修订"}</p>
          <h3>Round {round.roundNumber}</h3>
        </div>
        <span className="round-time">{formatDate(round.createdAt)}</span>
      </div>

      <div className="responses-grid">
        {round.responses.map((response) => {
          const agent = agents.find((item) => item.id === response.agentId);
          return (
            <ResponseCard
              key={response.id}
              response={response}
              accentColor={agent?.accentColor}
            />
          );
        })}
      </div>
    </section>
  );
}

export default function App() {
  const [agents, setAgents] = useState([]);
  const [recentConversations, setRecentConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [question, setQuestion] = useState(starterQuestion);
  const [iterationCount, setIterationCount] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [iterating, setIterating] = useState(false);

  const deferredQuestion = useDeferredValue(question);

  async function loadBootstrap() {
    setLoading(true);

    try {
      const [agentsPayload, conversationsPayload] = await Promise.all([
        request(`/api/agents?t=${Date.now()}`),
        request(`/api/conversations?t=${Date.now()}`)
      ]);

      startTransition(() => {
        setAgents(agentsPayload.agents || []);
        setRecentConversations(conversationsPayload.conversations || []);
      });
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBootstrap();
  }, []);

  async function openConversation(conversationId) {
    try {
      setError("");
      const payload = await request(`/api/conversations/${conversationId}?t=${Date.now()}`);
      startTransition(() => {
        setConversation(payload.conversation);
      });
    } catch (openError) {
      setError(openError.message);
    }
  }

  async function refreshRecentConversations() {
    const payload = await request(`/api/conversations?t=${Date.now()}`);
    startTransition(() => {
      setRecentConversations(payload.conversations || []);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload = await request("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ question })
      });

      startTransition(() => {
        setConversation(payload.conversation);
      });

      await refreshRecentConversations();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleIterate() {
    if (!conversation) {
      return;
    }

    setIterating(true);
    setError("");

    try {
      const payload = await request(`/api/conversations/${conversation.id}/iterate`, {
        method: "POST",
        body: JSON.stringify({ rounds: iterationCount })
      });

      startTransition(() => {
        setConversation(payload.conversation);
      });

      await refreshRecentConversations();
    } catch (iterateError) {
      setError(iterateError.message);
    } finally {
      setIterating(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="hero">
        <div>
          <p className="hero-kicker">Multi-Agent Orchestration</p>
          <h1>让多个 AI 同时回答，再把彼此的观点送回去继续推演。</h1>
          <p className="hero-copy">
            前端只请求 <code>/api/</code>，后端负责编排代理、持久化轮次和回答，并支持继续迭代。
          </p>
        </div>

        <div className="hero-summary">
          <div>
            <span>当前代理</span>
            <strong>{agents.length || "--"}</strong>
          </div>
          <div>
            <span>当前轮次</span>
            <strong>{conversation?.totalRounds || 0}</strong>
          </div>
          <div>
            <span>状态</span>
            <strong>{statusLabel(conversation?.status)}</strong>
          </div>
        </div>
      </header>

      <main className="main-grid">
        <aside className="control-panel">
          <section className="panel-card composer">
            <div className="panel-heading">
              <p className="eyebrow">发起问题</p>
              <h2>{deferredQuestion.trim().slice(0, 28) || "准备开始一轮新对话"}</h2>
            </div>

            <form onSubmit={handleSubmit}>
              <label className="field">
                <span>问题内容</span>
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="输入你的问题..."
                  rows={8}
                  maxLength={4000}
                />
              </label>

              <div className="inline-metrics">
                <span>{question.length} / 4000</span>
                <span>后端会自动并发调用所有代理</span>
              </div>

              <button className="primary-button" type="submit" disabled={submitting || loading}>
                {submitting ? "正在生成首轮回答..." : "开始协作回答"}
              </button>
            </form>
          </section>

          <section className="panel-card iterate-card">
            <div className="panel-heading">
              <p className="eyebrow">追加轮次</p>
              <h2>继续让模型互相修订</h2>
            </div>

            <label className="field">
              <span>本次追加轮数</span>
              <input
                type="number"
                min="1"
                max="5"
                value={iterationCount}
                onChange={(event) => setIterationCount(Number(event.target.value) || 1)}
              />
            </label>

            <button
              className="secondary-button"
              type="button"
              disabled={!conversation || iterating || submitting}
              onClick={handleIterate}
            >
              {iterating ? "正在迭代..." : `继续迭代 ${iterationCount} 轮`}
            </button>
          </section>

          <section className="panel-card recent-card">
            <div className="panel-heading">
              <p className="eyebrow">最近会话</p>
              <h2>可随时回看之前的轮次</h2>
            </div>

            <div className="recent-list">
              {recentConversations.length === 0 ? (
                <p className="muted-text">还没有历史会话。</p>
              ) : (
                recentConversations.map((item) => (
                  <button
                    className={`recent-item ${conversation?.id === item.id ? "active" : ""}`}
                    key={item.id}
                    type="button"
                    onClick={() => openConversation(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <span>
                      {item.totalRounds} 轮 · {statusLabel(item.status)} · {formatDate(item.updatedAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="workspace">
          {error ? <div className="error-banner">{error}</div> : null}

          {loading ? (
            <div className="loading-card">正在加载代理与会话列表...</div>
          ) : conversation ? (
            <>
              <section className="conversation-overview">
                <div>
                  <p className="eyebrow">当前问题</p>
                  <h2>{conversation.title}</h2>
                </div>
                <div className="overview-meta">
                  <span>{conversation.totalRounds} 轮</span>
                  <span>{statusLabel(conversation.status)}</span>
                  <span>{formatDate(conversation.updatedAt)}</span>
                </div>
              </section>

              <section className="question-card">
                <p>{conversation.question}</p>
              </section>

              {conversation.rounds.map((round) => (
                <RoundSection key={round.id} round={round} agents={agents} />
              ))}
            </>
          ) : (
            <EmptyState agents={agents} />
          )}
        </section>
      </main>
    </div>
  );
}
