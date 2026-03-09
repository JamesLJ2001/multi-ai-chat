const { Pool } = require("pg");
const { randomUUID } = require("node:crypto");
const config = require("./config");

const pool = new Pool({
  connectionString: config.databaseUrl
});

const schemaSql = `
  CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    mode TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, round_number)
  );

  CREATE TABLE IF NOT EXISTS agent_responses (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    agent_role TEXT,
    model TEXT,
    base_url TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    response_text TEXT NOT NULL,
    error_message TEXT,
    peer_context JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_rounds_conversation_id
    ON rounds(conversation_id, round_number);

  CREATE INDEX IF NOT EXISTS idx_agent_responses_conversation_id
    ON agent_responses(conversation_id, round_id);
`;

function mapConversation(row) {
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    status: row.status,
    totalRounds: Number(row.total_rounds || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildTitle(question) {
  const compact = question.replace(/\s+/g, " ").trim();
  if (compact.length <= 48) {
    return compact;
  }

  return `${compact.slice(0, 45)}...`;
}

async function ensureDatabase(maxAttempts = 20) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      await pool.query(schemaSql);
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function listConversations(limit = 20) {
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.title,
        c.question,
        c.status,
        c.created_at,
        c.updated_at,
        COALESCE(MAX(r.round_number), 0) AS total_rounds
      FROM conversations c
      LEFT JOIN rounds r ON r.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows.map(mapConversation);
}

async function getConversationById(conversationId) {
  const conversationResult = await pool.query(
    `
      SELECT
        c.id,
        c.title,
        c.question,
        c.status,
        c.created_at,
        c.updated_at,
        COALESCE(MAX(r.round_number), 0) AS total_rounds
      FROM conversations c
      LEFT JOIN rounds r ON r.conversation_id = c.id
      WHERE c.id = $1
      GROUP BY c.id
    `,
    [conversationId]
  );

  if (conversationResult.rowCount === 0) {
    return null;
  }

  const roundsResult = await pool.query(
    `
      SELECT id, conversation_id, round_number, mode, created_at
      FROM rounds
      WHERE conversation_id = $1
      ORDER BY round_number ASC
    `,
    [conversationId]
  );

  const responsesResult = await pool.query(
    `
      SELECT
        ar.id,
        ar.round_id,
        ar.agent_id,
        ar.agent_name,
        ar.agent_role,
        ar.model,
        ar.base_url,
        ar.status,
        ar.response_text,
        ar.error_message,
        ar.peer_context,
        ar.created_at
      FROM agent_responses ar
      JOIN rounds r ON r.id = ar.round_id
      WHERE ar.conversation_id = $1
      ORDER BY r.round_number ASC, ar.created_at ASC
    `,
    [conversationId]
  );

  const rounds = roundsResult.rows.map((round) => ({
    id: round.id,
    roundNumber: round.round_number,
    mode: round.mode,
    createdAt: round.created_at,
    responses: []
  }));

  const roundMap = new Map(rounds.map((round) => [round.id, round]));

  for (const row of responsesResult.rows) {
    const targetRound = roundMap.get(row.round_id);

    if (!targetRound) {
      continue;
    }

    targetRound.responses.push({
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentRole: row.agent_role,
      model: row.model,
      baseUrl: row.base_url,
      status: row.status,
      responseText: row.response_text,
      errorMessage: row.error_message,
      peerContext: Array.isArray(row.peer_context) ? row.peer_context : [],
      createdAt: row.created_at
    });
  }

  return {
    ...mapConversation(conversationResult.rows[0]),
    rounds
  };
}

async function createConversation(question) {
  const id = randomUUID();
  const title = buildTitle(question);

  await pool.query(
    `
      INSERT INTO conversations (id, title, question, status)
      VALUES ($1, $2, $3, $4)
    `,
    [id, title, question, "pending"]
  );

  return { id, title, question };
}

async function updateConversationStatus(conversationId, status) {
  await pool.query(
    `
      UPDATE conversations
      SET status = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [conversationId, status]
  );
}

async function createRound(conversationId, roundNumber, mode) {
  const id = randomUUID();

  await pool.query(
    `
      INSERT INTO rounds (id, conversation_id, round_number, mode)
      VALUES ($1, $2, $3, $4)
    `,
    [id, conversationId, roundNumber, mode]
  );

  await pool.query(
    `
      UPDATE conversations
      SET updated_at = NOW()
      WHERE id = $1
    `,
    [conversationId]
  );

  return {
    id,
    conversationId,
    roundNumber,
    mode
  };
}

async function insertAgentResponse(input) {
  await pool.query(
    `
      INSERT INTO agent_responses (
        id,
        conversation_id,
        round_id,
        agent_id,
        agent_name,
        agent_role,
        model,
        base_url,
        status,
        response_text,
        error_message,
        peer_context
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12
      )
    `,
    [
      randomUUID(),
      input.conversationId,
      input.roundId,
      input.agentId,
      input.agentName,
      input.agentRole,
      input.model,
      input.baseUrl,
      input.status,
      input.responseText,
      input.errorMessage || null,
      input.peerContext || []
    ]
  );
}

async function close() {
  await pool.end();
}

module.exports = {
  ensureDatabase,
  listConversations,
  getConversationById,
  createConversation,
  updateConversationStatus,
  createRound,
  insertAgentResponse,
  close
};
