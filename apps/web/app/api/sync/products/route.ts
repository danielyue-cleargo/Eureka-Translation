import { NextResponse } from "next/server";
import { DEFAULT_PROJECT_ID } from "@/lib/store";
import { getSupabaseSyncStatus, syncProducts } from "@/lib/supabase-sync";

export async function GET() {
  return NextResponse.json({ sync: getSupabaseSyncStatus() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const resolutions = Array.isArray(body.resolutions) ? body.resolutions : [];
    const sync = await syncProducts(projectId, { resolutions });
    return NextResponse.json({ conflicts: sync.conflicts ?? [], products: sync.products, sync: withoutProducts(sync) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Product sync failed" }, { status: 400 });
  }
}

function withoutProducts(sync: Awaited<ReturnType<typeof syncProducts>>) {
  return {
    configured: sync.configured,
    connected: sync.connected,
    conflictCount: sync.conflictCount ?? 0,
    enabled: sync.enabled,
    error: sync.error,
    lastSyncedAt: sync.lastSyncedAt
  };
}
