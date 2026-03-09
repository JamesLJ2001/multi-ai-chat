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

function extractGeminiChunkText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");

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

async function streamGeminiResponse({ agent, messages, signal, onDelta }) {
  if (!agent.apiKey) {
    throw createProviderError(`Agent "${agent.name}" is missing apiKey.`, {
      code: "agent_not_configured"
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(agent.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(agent.apiKey)}`;

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

    if (!payload) {
      return;
    }

    let data;

    try {
      data = JSON.parse(payload);
    } catch (error) {
      return;
    }

    const nextText = extractGeminiChunkText(data);

    if (!nextText) {
      return;
    }

    const delta = nextText.startsWith(fullText) ? nextText.slice(fullText.length) : nextText;

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
  createGeminiResponse,
  streamGeminiResponse
};
