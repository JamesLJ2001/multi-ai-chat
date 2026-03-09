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

function buildGeminiRequest(messages, agent) {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => extractTextContent(message.content))
    .filter(Boolean)
    .join("\n\n");

  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: extractTextContent(message.content) }]
    }))
    .filter((message) => message.parts[0].text);

  return {
    ...(systemText
      ? {
          systemInstruction: {
            parts: [{ text: systemText }]
          }
        }
      : {}),
    contents,
    generationConfig: {
      temperature: agent.temperature,
      maxOutputTokens: agent.maxTokens
    }
  };
}

function extractGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return "";
}

async function createGeminiResponse({ agent, messages, signal }) {
  if (!agent.apiKey) {
    throw createProviderError(`Agent "${agent.name}" is missing apiKey.`, {
      code: "agent_not_configured"
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(agent.model)}:generateContent?key=${encodeURIComponent(agent.apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildGeminiRequest(messages, agent))
  });

  if (!response.ok) {
    await response.text().catch(() => "");
    throw createProviderError(`Agent "${agent.name}" request failed.`, {
      statusCode: response.status,
      code: "upstream_error"
    });
  }

  const data = await response.json();
  const text = extractGeminiText(data);

  if (!text) {
    throw createProviderError(`Agent "${agent.name}" returned an empty response.`, {
      statusCode: 502,
      code: "empty_response"
    });
  }

  return text;
}

module.exports = {
  createGeminiResponse
};
