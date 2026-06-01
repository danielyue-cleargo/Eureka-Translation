import { getActiveLlmApiKey, getGeminiBaseUrl, getGeminiModel } from "./settings";
import { parseJsonText } from "./parse-json-text";

export async function verifyGeminiConnection(apiKey: string, baseUrl = getGeminiBaseUrl()): Promise<void> {
  if (!apiKey.trim()) throw new Error("API key is required");
  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      "x-goog-api-key": apiKey.trim()
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(formatGeminiVerificationError(response.status, body));
  }
}

export async function callGeminiStructured(input: {
  schemaName: string;
  schema: object;
  instructions: string;
  input: string;
}): Promise<any> {
  const apiKey = getActiveLlmApiKey();
  if (!apiKey) throw new Error("Gemini API key is required. Add it in Setting.");

  const baseUrl = getGeminiBaseUrl();
  const model = getGeminiModel();
  const requestBody = JSON.stringify({
    systemInstruction: {
      parts: [{ text: input.instructions }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: input.input }]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: input.schema
    }
  });

  let response: Response | undefined;
  let responseText = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: requestBody
    });

    if (response.ok) break;
    responseText = await response.text();
    if (!isTransientGeminiStatus(response.status) || attempt === 3) break;
    await delay(600 * attempt);
  }

  if (!response?.ok) {
    throw new Error(formatGeminiRequestError(response?.status, responseText));
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;
  if (!text) {
    throw new Error("Gemini response did not include structured text output");
  }
  return parseJsonText(text);
}

function isTransientGeminiStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function formatGeminiVerificationError(status: number, body: string): string {
  const message = extractGeminiErrorMessage(body);
  if (isGeminiLocationRestriction(body, message)) {
    return [
      `Gemini is not available from your current region (${status}).`,
      "Set a Gemini API URL proxy in Setting if you have one, connect through a supported region/VPN, or switch to OpenAI.",
      message
    ].join(" ");
  }
  return `API key verification failed: ${status} ${message}`.trim();
}

function formatGeminiRequestError(status: number | undefined, body: string): string {
  const details = extractGeminiErrorMessage(body);
  if (isGeminiLocationRestriction(body, details)) {
    return [
      `Gemini is not available from your current region${status ? ` (${status})` : ""}.`,
      "Set a Gemini API URL proxy in Setting if you have one, connect through a supported region/VPN, or switch to OpenAI.",
      details
    ].join(" ");
  }
  if (status && isTransientGeminiStatus(status)) {
    return `Gemini provider temporarily failed after retries (${status}). Try again, or check the model in Setting. ${details}`.trim();
  }
  return `Gemini request failed${status ? ` (${status})` : ""}. ${details}`.trim();
}

function isGeminiLocationRestriction(body: string, message: string): boolean {
  return /location is not supported|FAILED_PRECONDITION/i.test(`${body} ${message}`);
}

function extractGeminiErrorMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    return String(parsed.error?.message || parsed.message || body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
