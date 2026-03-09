const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const FALLBACK_AGENTS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    provider: "mock",
    model: "gpt-4.1-mini",
    role: "",
    systemPrompt: "",
    accentColor: "#111111"
  },
  {
    id: "gemini",
    name: "Gemini",
    provider: "mock",
    model: "gemini-2.0-flash",
    role: "",
    systemPrompt: "",
    accentColor: "#4c6fff"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    provider: "mock",
    model: "deepseek-chat",
    role: "",
    systemPrompt: "",
    accentColor: "#246b4f"
  }
];

const DEFAULT_COLORS = ["#d1603d", "#2b7a78", "#f2a541", "#457b9d", "#7f5539"];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeAgent(agent, index) {
  const id = String(agent.id || `agent-${index + 1}`).trim();
  const provider = String(agent.provider || "mock").trim();
  const model = String(agent.model || `${provider}-${id}`).trim();

  return {
    id,
    name: String(agent.name || id).trim(),
    provider,
    model,
    role: String(agent.role || "Collaborator").trim(),
    systemPrompt: String(agent.systemPrompt || "").trim(),
    baseUrl: String(agent.baseUrl || "").trim(),
    apiKey: String(agent.apiKey || "").trim(),
    temperature: toNumber(agent.temperature, 0.7),
    maxTokens: toNumber(agent.maxTokens, 900),
    accentColor: String(agent.accentColor || DEFAULT_COLORS[index % DEFAULT_COLORS.length]).trim()
  };
}

function parseAgents(rawAgents) {
  if (!rawAgents || !String(rawAgents).trim()) {
    return FALLBACK_AGENTS;
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

module.exports = config;
