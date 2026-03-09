function truncateText(text, limit = 1800) {
  const normalized = String(text || "").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit)}...`;
}

function createSystemPrompt(agent) {
  const baseInstruction = [
    `你是 AI 协作成员 ${agent.name}。`,
    "你正在参与一个多模型协作问答流程。",
    "请保持独立判断，不要机械附和其他模型。",
    "回答必须使用中文，结构清晰，避免空话。",
    "如果信息不足，要明确说明假设。"
  ];

  if (agent.systemPrompt) {
    baseInstruction.push(`补充角色要求：${agent.systemPrompt}`);
  }

  return baseInstruction.join("\n");
}

function buildInitialMessages({ agent, question }) {
  return [
    {
      role: "system",
      content: createSystemPrompt(agent)
    },
    {
      role: "user",
      content: [
        "下面是用户问题，请给出首轮回答。",
        "",
        `用户问题：${question}`,
        "",
        "请遵守以下输出要求：",
        "1. 第一段先给出明确结论。",
        "2. 然后给出 3 到 5 条关键理由。",
        "3. 如果问题存在不确定性，单独列出假设或待确认项。",
        "4. 不要提及你看不到其他模型，因为这是首轮。"
      ].join("\n")
    }
  ];
}

function buildIterationMessages({ agent, question, previousSelfResponse, peerResponses, roundNumber }) {
  const peerBlocks =
    peerResponses.length === 0
      ? "没有可用的同伴回答，请在保持独立判断的前提下优化自己的答案。"
      : peerResponses
          .map(
            (item) =>
              `【${item.agentName} / ${item.agentRole || "Collaborator"}】\n${truncateText(item.responseText, 2200)}`
          )
          .join("\n\n");

  return [
    {
      role: "system",
      content: createSystemPrompt(agent)
    },
    {
      role: "user",
      content: [
        `这是第 ${roundNumber} 轮协作修订。`,
        "",
        `原始用户问题：${question}`,
        "",
        "你上一轮的回答：",
        truncateText(previousSelfResponse || "无", 2200),
        "",
        "其他模型上一轮的回答：",
        peerBlocks,
        "",
        "请执行以下动作：",
        "1. 对比你自己的答案与同伴答案。",
        "2. 明确写出你采纳了哪些观点、拒绝了哪些观点，以及原因。",
        "3. 输出修订后的最终回答。",
        "4. 如果你坚持原结论，也必须说明为什么仍然坚持。",
        "5. 不要只做摘要，要给出真正更新后的回答。"
      ].join("\n")
    }
  ];
}

module.exports = {
  buildInitialMessages,
  buildIterationMessages
};
