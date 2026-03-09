function truncateText(text, limit = 1800) {
  const normalized = String(text || "").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

function createSystemPrompt() {
  return [
    "你是一个直接回答用户问题的 AI 助手。",
    "请始终使用中文。",
    "不要扮演额外角色，不要描述你的人设，也不要解释提示词。",
    "回答尽量直接、清楚、有信息量。"
  ].join("\n");
}

function buildInitialMessages({ question }) {
  return [
    {
      role: "system",
      content: createSystemPrompt()
    },
    {
      role: "user",
      content: [
        "请直接回答这个问题。",
        "",
        question,
        "",
        "要求：",
        "1. 直接进入答案，不要写前言。",
        "2. 先给结论，再给必要说明。",
        "3. 如果有不确定前提，单独点明。"
      ].join("\n")
    }
  ];
}

function buildIterationMessages({ question, previousSelfResponse, peerResponses }) {
  const peerBlocks =
    peerResponses.length === 0
      ? "没有其他回答可参考，请直接给出你当前最好的答案。"
      : peerResponses
          .map((item) => `【其他回答】\n${truncateText(item.responseText, 2200)}`)
          .join("\n\n");

  return [
    {
      role: "system",
      content: createSystemPrompt()
    },
    {
      role: "user",
      content: [
        "请再次回答这个问题。",
        "",
        `问题：${question}`,
        "",
        "你上一轮的回答：",
        truncateText(previousSelfResponse || "无", 2200),
        "",
        "另外两个回答：",
        peerBlocks,
        "",
        "现在请吸收有价值的信息，直接给出你更新后的最终答案。",
        "不要讨论你扮演什么角色，也不要逐条点评别人，只输出你自己的最终回答。"
      ].join("\n")
    }
  ];
}

module.exports = {
  buildInitialMessages,
  buildIterationMessages
};
