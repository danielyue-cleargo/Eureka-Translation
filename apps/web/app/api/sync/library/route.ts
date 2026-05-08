import { NextResponse } from "next/server";
import { DEFAULT_PROJECT_ID } from "@/lib/store";
import { getSupabaseSyncStatus, syncLibrary } from "@/lib/supabase-sync";

export async function GET() {
  return NextResponse.json({ sync: getSupabaseSyncStatus() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
    const sync = await syncLibrary(projectId, { resolutions });
    return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: withoutTerms(sync), terms: sync.terms });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 400 });
  }
}

function withoutTerms(sync: Awaited<ReturnType<typeof syncLibrary>>) {
  return {
    configured: sync.configured,
    connected: sync.connected,
    enabled: sync.enabled,
    error: sync.error,
    conflictCount: sync.conflictCount ?? 0,
    lastSyncedAt: sync.lastSyncedAt
  };
}
