function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

async function createOpenAiCompatibleResponse({ agent, messages, signal }) {
  if (!agent.baseUrl || !agent.apiKey) {
    throw new Error(`Agent "${agent.name}" is missing baseUrl or apiKey.`);
  }

  const response = await fetch(`${normalizeBaseUrl(agent.baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agent.apiKey}`
    },
    body: JSON.stringify({
      model: agent.model,
      messages,
      temperature: agent.temperature,
      max_tokens: agent.maxTokens
    })
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Agent "${agent.name}" request failed with ${response.status}: ${bodyText.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = extractTextContent(content);

  if (!text) {
    throw new Error(`Agent "${agent.name}" returned an empty response.`);
  }

  return text;
}

module.exports = {
  createOpenAiCompatibleResponse
};
