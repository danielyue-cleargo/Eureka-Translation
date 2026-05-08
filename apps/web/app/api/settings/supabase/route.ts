import { NextResponse } from "next/server";
import {
  clearRuntimeSupabaseSettings,
  getRuntimeSupabaseServiceRoleKey,
  getSupabaseSettings,
  getSupabaseSettingsStatus,
  normalizeSupabaseUrl,
  setRuntimeSupabaseSettings
} from "@/lib/settings";

export async function GET(request: Request) {
  const status = getSupabaseSettingsStatus();
  const { searchParams } = new URL(request.url);
  if (searchParams.get("verify") !== "1") return NextResponse.json(status);

  const settings = getSupabaseSettings();
  if (!status.configured || !settings.url || !settings.serviceRoleKey) {
    return NextResponse.json({ ...status, connected: false });
  }

  try {
    await verifySupabaseConnection(settings.url, settings.serviceRoleKey);
    return NextResponse.json({ ...status, connected: true });
  } catch (error) {
    return NextResponse.json({
      ...status,
      connected: false,
      error: error instanceof Error ? error.message : "Supabase connection failed"
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const url = normalizeSupabaseUrl(String(body.url || ""));
    const submittedKey = String(body.serviceRoleKey || "");
    const currentKey = getRuntimeSupabaseServiceRoleKey();
    const currentStatus = getSupabaseSettingsStatus();
    const serviceRoleKey = currentKey && submittedKey === currentStatus.maskedKey ? currentKey : submittedKey;
    await verifySupabaseConnection(url, serviceRoleKey);
    setRuntimeSupabaseSettings(url, serviceRoleKey);
    return NextResponse.json(getSupabaseSettingsStatus());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 400 });
  }
}

export async function DELETE() {
  clearRuntimeSupabaseSettings();
  return NextResponse.json(getSupabaseSettingsStatus());
}

async function verifySupabaseConnection(url: string, serviceRoleKey: string): Promise<void> {
  if (!serviceRoleKey.trim()) throw new Error("Supabase service role key is required");
  const response = await fetch(`${url}/rest/v1/projects?select=id&limit=1`, {
    headers: {
      apikey: serviceRoleKey.trim(),
      authorization: `Bearer ${serviceRoleKey.trim()}`
    }
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase verification failed: ${response.status} ${details.slice(0, 240)}`);
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
