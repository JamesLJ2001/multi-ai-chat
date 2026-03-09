function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}

function createProviderError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function extractRawTextContent(content) {
  if (typeof content === "string") {
    return content;
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
      .join("");
  }

  return "";
}

function extractTextContent(content) {
  return extractRawTextContent(content).trim();
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

async function streamOpenAiCompatibleResponse({ agent, messages, signal, onDelta }) {
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
      max_tokens: agent.maxTokens,
      stream: true
    })
  });

  if (!response.ok) {
    await response.text().catch(() => "");
    throw createProviderError(`Agent "${agent.name}" request failed.`, {
      statusCode: response.status,
      code: "upstream_error"
    });
  }

  if (!response.body) {
    throw createProviderError(`Agent "${agent.name}" returned an empty stream.`, {
      statusCode: 502,
      code: "empty_response"
    });
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let fullText = "";
  const processLine = (rawLine) => {
    const line = rawLine.trim();

    if (!line.startsWith("data:")) {
      return;
    }

    const payload = line.slice(5).trim();

    if (!payload || payload === "[DONE]") {
      return;
    }

    let data;

    try {
      data = JSON.parse(payload);
    } catch (error) {
      return;
    }

    const delta = extractRawTextContent(data?.choices?.[0]?.delta?.content);

    if (!delta) {
      return;
    }

    fullText += delta;
    onDelta(delta);
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      processLine(rawLine);
    }
  }

  if (buffer.trim()) {
    for (const rawLine of buffer.split(/\r?\n/)) {
      processLine(rawLine);
    }
  }

  if (!fullText.trim()) {
    throw createProviderError(`Agent "${agent.name}" returned an empty response.`, {
      statusCode: 502,
      code: "empty_response"
    });
  }

  return fullText;
}

module.exports = {
  createOpenAiCompatibleResponse,
  streamOpenAiCompatibleResponse
};
