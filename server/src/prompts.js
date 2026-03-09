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
    "不要套固定模板，不要强行写“结论”“说明”“前提”之类的小标题。",
    "回答尽量自然、直接、清楚。"
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
        question
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
        "现在请吸收有价值的信息，重新直接回答用户。",
        "不要套固定格式，也不要逐条点评别人，只输出你自己的新答案。"
      ].join("\n")
    }
  ];
}

module.exports = {
  buildInitialMessages,
  buildIterationMessages
};
