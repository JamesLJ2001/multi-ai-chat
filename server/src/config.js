const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEFAULT_AGENT_PRESETS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-reasoner",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    role: "",
    systemPrompt: "",
    accentColor: "#246b4f"
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "gemini",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    apiKeyEnv: "GEMINI_API_KEY",
    role: "",
    systemPrompt: "",
    accentColor: "#4c6fff"
  },
  {
    id: "grok",
    name: "Grok",
    provider: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    modelEnv: "XAI_MODEL",
    defaultModel: "grok-3",
    apiKeyEnv: "XAI_API_KEY",
    role: "",
    systemPrompt: "",
    accentColor: "#111111"
  }
];

const DEFAULT_COLORS = ["#d1603d", "#2b7a78", "#f2a541", "#457b9d", "#7f5539"];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveApiKey(agent) {
  const explicitApiKey = String(agent.apiKey || "").trim();

  if (explicitApiKey) {
    return explicitApiKey;
  }

  const apiKeyEnv = String(agent.apiKeyEnv || "").trim();

  if (!apiKeyEnv) {
    return "";
  }

  return String(process.env[apiKeyEnv] || "").trim();
}

function normalizeAgent(agent, index) {
  const id = String(agent.id || `agent-${index + 1}`).trim();
  const provider = String(agent.provider || "mock").trim();
  const fallbackModel =
    String(agent.defaultModel || `${provider}-${id}`).trim();
  const modelEnv = String(agent.modelEnv || "").trim();
  const model = String(
    agent.model || (modelEnv ? process.env[modelEnv] : "") || fallbackModel
  ).trim();
  const apiKeyEnv = String(agent.apiKeyEnv || "").trim();
  const apiKey = resolveApiKey(agent);

  return {
    id,
    name: String(agent.name || id).trim(),
    provider,
    model,
    role: String(agent.role || "").trim(),
    systemPrompt: String(agent.systemPrompt || "").trim(),
    baseUrl: String(agent.baseUrl || "").trim(),
    apiKey,
    apiKeyEnv,
    temperature: toNumber(agent.temperature, 0.7),
    maxTokens: toNumber(agent.maxTokens, 900),
    accentColor: String(agent.accentColor || DEFAULT_COLORS[index % DEFAULT_COLORS.length]).trim(),
    configured: provider === "mock" || Boolean(apiKey)
  };
}

function parseAgents(rawAgents) {
  if (!rawAgents || !String(rawAgents).trim()) {
    return DEFAULT_AGENT_PRESETS.map(normalizeAgent);
  }

  let parsedAgents;

  try {
    parsedAgents = JSON.parse(rawAgents);
  } catch (error) {
    throw new Error("AI_AGENTS_JSON is not valid JSON.");
  }

  if (!Array.isArray(parsedAgents) || parsedAgents.length === 0) {
    throw new Error("AI_AGENTS_JSON must be a non-empty array.");
  }

  return parsedAgents.map(normalizeAgent);
}

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toNumber(process.env.PORT, 8080),
  databaseUrl: process.env.DATABASE_URL || "postgresql://root:password@db:5432/app_db",
  requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 90000),
  agents: parseAgents(process.env.AI_AGENTS_JSON)
};

config.mockMode = !config.agents.some((agent) => agent.provider !== "mock" && agent.configured);

module.exports = config;
