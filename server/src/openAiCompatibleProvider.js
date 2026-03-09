function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function createProviderError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
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
    throw createProviderError(`Agent "${agent.name}" is missing baseUrl or apiKey.`, {
      code: "agent_not_configured"
    });
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
    await response.text().catch(() => "");
    throw createProviderError(`Agent "${agent.name}" request failed.`, {
      statusCode: response.status,
      code: "upstream_error"
    });
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = extractTextContent(content);

  if (!text) {
    throw createProviderError(`Agent "${agent.name}" returned an empty response.`, {
      statusCode: 502,
      code: "empty_response"
    });
  }

  return text;
}

module.exports = {
  createOpenAiCompatibleResponse
};
