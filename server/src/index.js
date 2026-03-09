const express = require("express");
const config = require("./config");
const db = require("./db");
const chatService = require("./chatService");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

app.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    res.json({
      status: "ok",
      agents: chatService.getAgents().length
    });
  })
);

app.get(
  "/api/agents",
  asyncHandler(async (req, res) => {
    res.json({
      agents: chatService.getAgents()
    });
  })
);

app.get(
  "/api/conversations",
  asyncHandler(async (req, res) => {
    const conversations = await chatService.listConversations();
    res.json({ conversations });
  })
);

app.get(
  "/api/conversations/:conversationId",
  asyncHandler(async (req, res) => {
    const conversation = await chatService.getConversationById(req.params.conversationId);

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    res.json({ conversation });
  })
);

app.post(
  "/api/conversations",
  asyncHandler(async (req, res) => {
    const conversation = await chatService.createConversation(req.body?.question);
    res.status(201).json({ conversation });
  })
);

app.post(
  "/api/conversations/:conversationId/iterate",
  asyncHandler(async (req, res) => {
    const conversation = await chatService.iterateConversation(
      req.params.conversationId,
      req.body?.rounds
    );

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }

    res.json({ conversation });
  })
);

app.use((error, req, res, next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || "Unexpected server error."
  });
});

async function start() {
  await db.ensureDatabase();

  const server = app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
