import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { callGeminiStructured, verifyGeminiConnection } from "./gemini";
import { resetRuntimeSettingsForTest, setRuntimeGeminiApiKey, setRuntimeGeminiBaseUrl, setRuntimeGeminiModel, setRuntimeLlmProvider } from "./settings";

beforeEach(() => {
  resetRuntimeSettingsForTest(join(mkdtempSync(join(tmpdir(), "eu-web-gemini-test-settings-")), "settings.json"));
  setRuntimeLlmProvider("gemini");
  setRuntimeGeminiApiKey("gemini-key_1234567890abcdef");
  setRuntimeGeminiModel("gemini-2.5-flash");
});

test("verifyGeminiConnection calls models endpoint with api key header", async () => {
  const previousFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders: HeadersInit | undefined;
  globalThis.fetch = (async (url, init) => {
    requestUrl = String(url);
    requestHeaders = init?.headers;
    return new Response(JSON.stringify({ models: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    await verifyGeminiConnection("gemini-key_1234567890abcdef");
    assert.match(requestUrl, /\/v1beta\/models$/);
    assert.equal((requestHeaders as Record<string, string>)["x-goog-api-key"], "gemini-key_1234567890abcdef");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("callGeminiStructured posts schema-backed generateContent request", async () => {
  const previousFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: any;
  globalThis.fetch = (async (url, init) => {
    requestUrl = String(url);
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ terms: [{ canonical: "Example" }] }) }]
            }
          }
        ]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const result = await callGeminiStructured({
      schemaName: "term_extraction",
      schema: {
        type: "object",
        properties: {
          terms: { type: "array" }
        }
      },
      instructions: "Extract terms",
      input: '{"primarySource":{"sourceText":"Example"}}'
    });

    assert.match(requestUrl, /models\/gemini-2\.5-flash:generateContent$/);
    assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
    assert.equal(requestBody.systemInstruction.parts[0].text, "Extract terms");
    assert.deepEqual(result, { terms: [{ canonical: "Example" }] });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("verifyGeminiConnection surfaces location restriction guidance", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          code: 400,
          message: "User location is not supported for the API use.",
          status: "FAILED_PRECONDITION"
        }
      }),
      { status: 400 }
    )) as typeof fetch;

  try {
    await assert.rejects(
      () => verifyGeminiConnection("gemini-key_1234567890abcdef"),
      /not available from your current region/i
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("callGeminiStructured uses configured gemini base url", async () => {
  const previousFetch = globalThis.fetch;
  setRuntimeGeminiBaseUrl("https://proxy.example.com/v1beta");
  let requestUrl = "";
  globalThis.fetch = (async (url) => {
    requestUrl = String(url);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ terms: [] }) }] } }]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    await callGeminiStructured({
      schemaName: "term_extraction",
      schema: { type: "object", properties: { terms: { type: "array" } } },
      instructions: "Extract terms",
      input: "{}"
    });
    assert.match(requestUrl, /^https:\/\/proxy\.example\.com\/v1beta\/models\//);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
