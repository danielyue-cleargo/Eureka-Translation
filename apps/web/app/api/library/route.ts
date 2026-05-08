import { NextResponse } from "next/server";
import type { Term } from "@eu-translation/shared";
import { libraryFolders, termTypes } from "@eu-translation/shared";
import { DEFAULT_PROJECT_ID, store } from "@/lib/store";
import { isSupabaseSyncEnabled, syncLibrary } from "@/lib/supabase-sync";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") || DEFAULT_PROJECT_ID;
  if (isSupabaseSyncEnabled()) {
    const sync = await syncLibrary(projectId);
    return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: syncStatusPayload(sync), terms: sync.terms });
  }
  return NextResponse.json({ terms: store.listTerms(projectId) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const terms = Array.isArray(body.terms) ? (body.terms as Term[]) : [];
    if (terms.length === 0) throw new Error("No translation to save");

    const saved = store.addTerms(projectId, terms);
    const sync = await syncAfterLocalChange(projectId, saved);
    return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: sync.sync, terms: sync.terms, savedCount: terms.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const termId = String(body.termId || "");
    if (!termId) throw new Error("Translation id is required");
    const canonical = String(body.canonical || "").trim();
    const type = String(body.type || "");
    const folderId = String(body.folderId || "");
    if (!canonical) throw new Error("Translation text is required");
    if (!termTypes.includes(type as any)) throw new Error("Invalid category");
    if (!libraryFolders.some((folder) => folder.id === folderId)) throw new Error("Invalid folder");

    const translations = Object.fromEntries(
      Object.entries(body.translations ?? {}).map(([locale, value]) => [locale, String(value ?? "")])
    );
    const saved = store.updateTerm(projectId, termId, {
      canonical,
      type: type as Term["type"],
      folderId: folderId as Term["folderId"],
      translations
    });
    const sync = await syncAfterLocalChange(projectId, saved);
    return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: sync.sync, terms: sync.terms });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const action = String(body.action || "");
    const current = store.listTerms(projectId);

    if (action === "setReferenceEnabled") {
      const termId = String(body.termId || "").trim();
      if (!termId) throw new Error("Translation id is required");
      const enabled = Boolean(body.enabled);
      const saved = store.replaceTerms(
        projectId,
        current.map((term) =>
          term.id === termId
            ? {
                ...term,
                status: enabled ? "approved" : "rejected",
                updatedAt: new Date().toISOString()
              }
            : term
        )
      );
      const sync = await syncAfterLocalChange(projectId, saved);
      return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: sync.sync, terms: sync.terms });
    }

    if (action === "applyTag") {
      const tag = normalizeTag(body.tag);
      const termIds = readTermIds(body.termIds);
      if (!tag) throw new Error("Tag name is required");
      if (termIds.length === 0) throw new Error("Select at least one translation");

      const selected = new Set(termIds);
      const saved = store.replaceTerms(
        projectId,
        current.map((term) =>
          selected.has(term.id)
            ? {
                ...term,
                tags: [...new Set([...(term.tags ?? []), tag])],
                updatedAt: new Date().toISOString()
              }
            : term
        )
      );
      const sync = await syncAfterLocalChange(projectId, saved);
      return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: sync.sync, terms: sync.terms });
    }

    if (action === "renameTag") {
      const previousTag = normalizeTag(body.previousTag);
      const nextTag = normalizeTag(body.nextTag);
      if (!previousTag || !nextTag) throw new Error("Tag names are required");

      const saved = store.replaceTerms(
        projectId,
        current.map((term) => ({
          ...term,
          tags: normalizeTags((term.tags ?? []).map((tag) => (tag === previousTag ? nextTag : tag))),
          updatedAt: term.tags?.includes(previousTag) ? new Date().toISOString() : term.updatedAt
        }))
      );
      const sync = await syncAfterLocalChange(projectId, saved);
      return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: sync.sync, terms: sync.terms });
    }

    if (action === "deleteTag") {
      const tag = normalizeTag(body.tag);
      if (!tag) throw new Error("Tag name is required");

      const saved = store.replaceTerms(
        projectId,
        current.map((term) => ({
          ...term,
          tags: normalizeTags((term.tags ?? []).filter((candidate) => candidate !== tag)),
          updatedAt: term.tags?.includes(tag) ? new Date().toISOString() : term.updatedAt
        }))
      );
      const sync = await syncAfterLocalChange(projectId, saved);
      return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: sync.sync, terms: sync.terms });
    }

    throw new Error("Invalid tag action");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tag update failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const termIds = readTermIds(body.termIds);
    const termId = String(body.termId || "").trim();
    const idsToDelete = termIds.length > 0 ? termIds : termId ? [termId] : [];
    if (idsToDelete.length === 0) throw new Error("Translation id is required");
    const selected = new Set(idsToDelete);
    const current = store.listTerms(projectId);
    const deletedTerms = current
      .filter((term) => selected.has(term.id))
      .map((term) => ({ ...term, updatedAt: new Date().toISOString() }));
    const saved = store.replaceTerms(
      projectId,
      current.filter((term) => !selected.has(term.id))
    );
    const sync = await syncAfterLocalChange(projectId, saved, deletedTerms);
    return NextResponse.json({ conflicts: sync.conflicts ?? [], sync: sync.sync, terms: sync.terms });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Delete failed" }, { status: 400 });
  }
}

async function syncAfterLocalChange(projectId: string, fallbackTerms: Term[], deletedTerms: Term[] = []) {
  if (!isSupabaseSyncEnabled()) return { terms: fallbackTerms };
  const sync = await syncLibrary(projectId, { deletedTerms });
  return { conflicts: sync.conflicts, sync: syncStatusPayload(sync), terms: sync.terms };
}

function syncStatusPayload(sync: Awaited<ReturnType<typeof syncLibrary>>) {
  return {
    connected: sync.connected,
    enabled: sync.enabled,
    error: sync.error,
    configured: sync.configured,
    conflictCount: sync.conflictCount ?? 0,
    lastSyncedAt: sync.lastSyncedAt
  };
}

function normalizeTag(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

function readTermIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((termId) => String(termId ?? "").trim()).filter(Boolean))];
}
