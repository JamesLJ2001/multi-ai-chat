const MODEL_VARIANTS = {
  deepseek: {
    initialLead: "最稳妥的方案是先做核心，再处理风险点。",
    refinedLead: "最终建议是优先解决最容易卡住上线的部分。",
    closing: "把风险提前处理，后续返工会少很多。"
  },
  gemini: {
    initialLead: "可以直接按一个清晰的顺序推进。",
    refinedLead: "更简洁的做法是把步骤压缩成一条最短路径。",
    closing: "顺序清楚，执行成本会显著下降。"
  },
  grok: {
    initialLead: "先把结论压缩到最短执行路径，效率最高。",
    refinedLead: "更新后的建议是把步骤再收紧，减少无关动作。",
    closing: "路径越短，落地速度越快。"
  }
};

function getVariant(agent) {
  return MODEL_VARIANTS[agent.id] || {
    initialLead: "结论：直接先做核心部分。",
    refinedLead: "结论：把步骤进一步压缩，先解决关键问题。",
    closing: "先完成主流程，再做细节优化。"
  };
}

function createMockResponse({ agent, question, roundNumber }) {
  const variant = getVariant(agent);
  const lead = roundNumber > 1 ? variant.refinedLead : variant.initialLead;

  return [
    lead,
    `针对“${question}”，建议直接这样做：`,
    "1. 先明确目标、边界和验收标准，只保留当前必须要做的部分。",
    "2. 立刻完成最核心的主流程，让结果尽快可运行、可验证、可展示。",
    "3. 用真实反馈继续补充剩余功能、性能优化和异常处理。",
    variant.closing
  ].join("\n");
}

module.exports = {
  createMockResponse
};
