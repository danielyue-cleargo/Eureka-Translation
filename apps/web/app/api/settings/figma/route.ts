import { NextResponse } from "next/server";
import {
  clearRuntimeFigmaAccessToken,
  getFigmaAccessToken,
  getFigmaTokenStatus,
  getRuntimeFigmaAccessToken,
  setRuntimeFigmaAccessToken
} from "@/lib/settings";

export async function GET(request: Request) {
  const status = getFigmaTokenStatus();
  const { searchParams } = new URL(request.url);
  if (searchParams.get("verify") !== "1") return NextResponse.json(status);

  const token = getFigmaAccessToken() || "";
  if (!status.configured || !token) {
    return NextResponse.json({ ...status, connected: false });
  }

  try {
    await verifyFigmaConnection(token);
    return NextResponse.json({ ...status, connected: true });
  } catch (error) {
    return NextResponse.json({
      ...status,
      connected: false,
      error: error instanceof Error ? error.message : "Figma connection failed"
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const submittedToken = String(body.token || "");
    const currentToken = getRuntimeFigmaAccessToken();
    const currentStatus = getFigmaTokenStatus();
    const token = currentToken && submittedToken === currentStatus.maskedToken ? currentToken : submittedToken;
    await verifyFigmaConnection(token);
    setRuntimeFigmaAccessToken(token);
    return NextResponse.json(getFigmaTokenStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 400 });
  }
}

export async function DELETE() {
  clearRuntimeFigmaAccessToken();
  return NextResponse.json(getFigmaTokenStatus());
}

async function verifyFigmaConnection(token: string): Promise<void> {
  if (!token.trim()) throw new Error("Figma access token is required");
  const response = await fetch("https://api.figma.com/v1/me", {
    headers: {
      "x-figma-token": token.trim()
    }
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Figma token verification failed: ${response.status} ${details.slice(0, 240)}`);
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
