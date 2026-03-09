const MODEL_VARIANTS = {
  deepseek: {
    initialLead: "我先直接回答你。",
    refinedLead: "我结合另外两份回答后，更新一下答案。",
    closing: "如果你想继续展开，我可以接着往下说。"
  },
  gemini: {
    initialLead: "直接说重点。",
    refinedLead: "我再把答案补充得更完整一点。",
    closing: "如果你要更短或更细，我都可以改。"
  },
  grok: {
    initialLead: "先给你一个直接版本。",
    refinedLead: "我参考完另外两份回答后，再给你一个更稳的版本。",
    closing: "如果你想让我更直接一点，也可以继续压缩。"
  }
};

function getVariant(agent) {
  return MODEL_VARIANTS[agent.id] || {
    initialLead: "我先直接回答。",
    refinedLead: "我更新一下答案。",
    closing: "如果需要，我可以继续展开。"
  };
}

function createMockResponse({ agent, question, roundNumber }) {
  const variant = getVariant(agent);
  const lead = roundNumber > 1 ? variant.refinedLead : variant.initialLead;

  return [
    lead,
    `关于“${question}”，我现在给的是演示用 mock 回答，不是真实模型输出。`,
    "如果你已经配好真实 provider，正常情况下这里会是一边生成一边出现的真实内容。",
    variant.closing
  ].join("\n");
}

async function streamMockResponse({ agent, question, roundNumber, onDelta }) {
  const text = createMockResponse({ agent, question, roundNumber });

  for (const char of text) {
    onDelta(char);
    await new Promise((resolve) => setTimeout(resolve, 8));
  }

  return text;
}

module.exports = {
  createMockResponse,
  streamMockResponse
};
