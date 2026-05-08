import { NextResponse } from "next/server";
import {
  clearRuntimeOpenAiApiKey,
  getOpenAiBaseUrl,
  getOpenAiKeyStatus,
  getRuntimeOpenAiApiKey,
  normalizeOpenAiBaseUrl,
  normalizeOpenAiModel,
  setRuntimeOpenAiBaseUrl,
  setRuntimeOpenAiApiKey,
  setRuntimeOpenAiModel
} from "@/lib/settings";

export async function GET(request: Request) {
  const status = getOpenAiKeyStatus();
  const { searchParams } = new URL(request.url);
  if (searchParams.get("verify") !== "1") return NextResponse.json(status);

  const apiKey = getRuntimeOpenAiApiKey() || process.env.OPENAI_API_KEY || "";
  if (!status.configured || !apiKey) {
    return NextResponse.json({ ...status, connected: false });
  }

  try {
    await verifyOpenAiConnection(apiKey, getOpenAiBaseUrl());
    return NextResponse.json({ ...status, connected: true });
  } catch (error) {
    return NextResponse.json({
      ...status,
      connected: false,
      error: error instanceof Error ? error.message : "OpenAI connection failed"
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const submittedApiKey = String(body.apiKey || "");
    const currentKey = getRuntimeOpenAiApiKey();
    const currentStatus = getOpenAiKeyStatus();
    const apiKey =
      currentKey && submittedApiKey === currentStatus.maskedKey
        ? currentKey
        : submittedApiKey;
    const baseUrl = normalizeOpenAiBaseUrl(String(body.baseUrl || ""));
    const model = normalizeOpenAiModel(String(body.model || ""));
    await verifyOpenAiConnection(apiKey, baseUrl);
    setRuntimeOpenAiApiKey(apiKey);
    setRuntimeOpenAiBaseUrl(baseUrl);
    setRuntimeOpenAiModel(model);
    return NextResponse.json(getOpenAiKeyStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 400 });
  }
}

export async function DELETE() {
  clearRuntimeOpenAiApiKey();
  return NextResponse.json(getOpenAiKeyStatus());
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
