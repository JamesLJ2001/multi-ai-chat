function buildPerspective(agent) {
  const role = agent.role.toLowerCase();

  if (role.includes("analyst")) {
    return "我会优先拆分目标、约束、风险和验证路径。";
  }

  if (role.includes("challenger")) {
    return "我会优先攻击薄弱假设，指出最容易被忽略的失败模式。";
  }

  if (role.includes("synthesizer")) {
    return "我会优先综合不同观点，收敛成一个能执行的版本。";
  }

  return "我会优先从自身角色出发，给出结构化判断。";
}

function buildPeerNotes(peerResponses) {
  if (!peerResponses.length) {
    return "本轮还没有可参考的同伴观点，所以保持独立判断。";
  }

  return `我参考了 ${peerResponses.map((item) => item.agentName).join("、")} 的上一轮观点，并筛选了能强化当前答案的部分。`;
}

function createMockResponse({ agent, question, roundNumber, peerResponses, previousSelfResponse }) {
  const title = roundNumber === 1 ? "首轮结论" : `第 ${roundNumber} 轮修订结论`;
  const peerNotes = buildPeerNotes(peerResponses);
  const previousLine =
    roundNumber === 1
      ? "这是当前问题的第一次作答。"
      : `我先回看了自己上一轮的主张：${String(previousSelfResponse || "").slice(0, 100)}。`;

  return [
    `${title}：建议先围绕“问题定义、协作策略、迭代停止条件、工程落地方式”来组织答案。`,
    `角色视角：${buildPerspective(agent)}`,
    `用户问题：${question}`,
    previousLine,
    peerNotes,
    "建议输出结构：",
    "1. 先给一个明确结论，不要先铺垫。",
    "2. 再列出关键依据，包括为什么要多模型并发、为什么需要互看答案、什么时候继续迭代。",
    "3. 最后给出可执行下一步，例如先做一个可运行 MVP，再补充流式输出、权限和模型配置后台。",
    "风险提醒：多模型协作会增加 token 成本和上下文长度，真实部署时应设置轮次上限、超时与失败回退策略。"
  ].join("\n\n");
}

module.exports = {
  createMockResponse
};
