import { NextResponse } from "next/server";
import { verifyGeminiConnection } from "@/lib/gemini";
import {
  clearActiveLlmApiKey,
  getActiveLlmApiKey,
  getGeminiBaseUrl,
  getLlmProvider,
  getLlmSettingsStatus,
  getOpenAiBaseUrl,
  getOpenAiKeyStatus,
  getGeminiKeyStatus,
  getRuntimeGeminiApiKey,
  getRuntimeOpenAiApiKey,
  normalizeGeminiBaseUrl,
  normalizeGeminiModel,
  normalizeLlmProvider,
  normalizeOpenAiBaseUrl,
  normalizeOpenAiModel,
  setRuntimeGeminiApiKey,
  setRuntimeGeminiBaseUrl,
  setRuntimeGeminiModel,
  setRuntimeLlmProvider,
  setRuntimeOpenAiApiKey,
  setRuntimeOpenAiBaseUrl,
  setRuntimeOpenAiModel,
  type LlmProvider
} from "@/lib/settings";

export async function GET(request: Request) {
  const status = getLlmSettingsStatus();
  const { searchParams } = new URL(request.url);
  if (searchParams.get("verify") !== "1") return NextResponse.json(status);

  const apiKey = getActiveLlmApiKey() || "";
  if (!status.configured || !apiKey) {
    return NextResponse.json({ ...status, connected: false });
  }

  try {
    await verifyActiveProviderConnection(status.provider, apiKey);
    return NextResponse.json({ ...status, connected: true });
  } catch (error) {
    return NextResponse.json({
      ...status,
      connected: false,
      error: error instanceof Error ? error.message : "AI provider connection failed"
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const provider = normalizeLlmProvider(body.provider) ?? getLlmProvider();
    const openAiStatus = getOpenAiKeyStatus();
    const geminiStatus = getGeminiKeyStatus();

    const submittedOpenAiKey = String(body.apiKey || "");
    const openAiKey =
      getRuntimeOpenAiApiKey() && submittedOpenAiKey === openAiStatus.maskedKey
        ? getRuntimeOpenAiApiKey()!
        : submittedOpenAiKey;

    const submittedGeminiKey = String(body.geminiApiKey || "");
    const geminiKey =
      getRuntimeGeminiApiKey() && submittedGeminiKey === geminiStatus.maskedKey
        ? getRuntimeGeminiApiKey()!
        : submittedGeminiKey;

    const baseUrl = normalizeOpenAiBaseUrl(String(body.baseUrl || ""));
    const geminiBaseUrl = normalizeGeminiBaseUrl(String(body.geminiBaseUrl || ""));
    const model = normalizeOpenAiModel(String(body.model || ""));
    const geminiModel = normalizeGeminiModel(String(body.geminiModel || ""));

    if (provider === "gemini") {
      await verifyGeminiConnection(geminiKey, geminiBaseUrl);
    } else {
      await verifyOpenAiConnection(openAiKey, baseUrl);
    }

    if (openAiKey.trim()) {
      setRuntimeOpenAiApiKey(openAiKey);
      setRuntimeOpenAiBaseUrl(baseUrl);
      setRuntimeOpenAiModel(model);
    }
    if (geminiKey.trim()) {
      setRuntimeGeminiApiKey(geminiKey);
    }
    setRuntimeGeminiBaseUrl(geminiBaseUrl);
    setRuntimeGeminiModel(geminiModel);
    setRuntimeLlmProvider(provider);

    return NextResponse.json(getLlmSettingsStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 400 });
  }
}

export async function DELETE() {
  clearActiveLlmApiKey();
  return NextResponse.json(getLlmSettingsStatus());
}

async function verifyActiveProviderConnection(provider: LlmProvider, apiKey: string): Promise<void> {
  if (provider === "gemini") {
    await verifyGeminiConnection(apiKey, getGeminiBaseUrl());
    return;
  }
  await verifyOpenAiConnection(apiKey, getOpenAiBaseUrl());
}

async function verifyOpenAiConnection(apiKey: string, baseUrl: string): Promise<void> {
  if (!apiKey.trim()) throw new Error("API key is required");
  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      authorization: `Bearer ${apiKey.trim()}`
    }
  });
  if (!response.ok) {
    const details = summarizeResponseText(await response.text());
    throw new Error(`API key verification failed: ${response.status} ${details.slice(0, 240)}`);
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new Error("Settings request must be valid JSON");
  }
}

function summarizeResponseText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<")) return trimmed;
  return "OpenAI API URL returned an HTML page instead of an API response. Check the API URL.";
}
