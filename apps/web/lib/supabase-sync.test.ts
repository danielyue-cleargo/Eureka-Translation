import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Term } from "@eu-translation/shared";
import type { LibrarySyncState } from "./store";
import { clearRuntimeSupabaseSettings, resetRuntimeSettingsForTest } from "./settings";
import { getSupabaseSyncStatus, mergeLocalAndCloudTerms, planVersionedSync, syncLibrary, termSyncHash } from "./supabase-sync";

resetRuntimeSettingsForTest(join(mkdtempSync(join(tmpdir(), "eu-web-supabase-test-settings-")), "settings.json"));

test("supabase sync is disabled unless explicitly enabled", async () => {
  const previousEnabled = process.env.SUPABASE_SYNC_ENABLED;
  clearRuntimeSupabaseSettings();
  delete process.env.SUPABASE_SYNC_ENABLED;

  const sync = await syncLibrary("test_disabled_sync");

  assert.equal(sync.enabled, false);
  assert.equal(sync.connected, false);
  assert.equal(getSupabaseSyncStatus().enabled, false);

  if (previousEnabled === undefined) delete process.env.SUPABASE_SYNC_ENABLED;
  else process.env.SUPABASE_SYNC_ENABLED = previousEnabled;
});

test("local and cloud merge uses updated_at last-write-wins", () => {
  const local = makeTerm("term_1", "Local text", "2026-01-01T00:00:00.000Z");
  const merged = mergeLocalAndCloudTerms([local], [
    {
      id: "term_1",
      project_id: "internal_library",
      canonical: "Cloud text",
      type: "feature",
      folder_id: "features",
      translations: { DE: "Cloud DE" },
      evidence: [],
      tags: ["cloud"],
      confidence: 0.9,
      status: "approved",
      updated_at: "2026-01-02T00:00:00.000Z"
    }
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.canonical, "Cloud text");
  assert.deepEqual(merged[0]?.tags, ["cloud"]);
});

test("cloud soft delete removes older local term but not newer local edits", () => {
  const oldLocal = makeTerm("term_1", "Old local", "2026-01-01T00:00:00.000Z");
  const newLocal = makeTerm("term_2", "New local", "2026-01-03T00:00:00.000Z");

  const merged = mergeLocalAndCloudTerms([oldLocal, newLocal], [
    {
      id: "term_1",
      project_id: "internal_library",
      canonical: "Deleted",
      type: "feature",
      folder_id: "features",
      status: "approved",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: "2026-01-02T00:00:00.000Z"
    },
    {
      id: "term_2",
      project_id: "internal_library",
      canonical: "Deleted but older",
      type: "feature",
      folder_id: "features",
      status: "approved",
      updated_at: "2026-01-01T00:00:00.000Z",
      deleted_at: "2026-01-02T00:00:00.000Z"
    }
  ]);

  assert.deepEqual(merged.map((term) => term.id), ["term_2"]);
});

test("newer cloud version creates conflict instead of overwriting teammate update", () => {
  const baseline = makeTerm("term_1", "Original", "2026-01-01T00:00:00.000Z");
  const local = makeTerm("term_1", "My local edit", "2026-01-03T00:00:00.000Z");
  const syncState = makeSyncState(baseline, 1);

  const plan = planVersionedSync([local], [
    {
      id: "term_1",
      project_id: "internal_library",
      canonical: "Teammate edit",
      type: "feature",
      folder_id: "features",
      status: "approved",
      updated_at: "2026-01-02T00:00:00.000Z",
      version: 2
    }
  ], syncState);

  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.pushes.length, 0);
  assert.equal(plan.nextTerms.get("term_1")?.canonical, "My local edit");
});

test("skip conflict pulls cloud term into local sync plan", () => {
  const baseline = makeTerm("term_1", "Original", "2026-01-01T00:00:00.000Z");
  const local = makeTerm("term_1", "My local edit", "2026-01-03T00:00:00.000Z");
  const syncState = makeSyncState(baseline, 1);

  const plan = planVersionedSync([local], [
    {
      id: "term_1",
      project_id: "internal_library",
      canonical: "Teammate edit",
      type: "feature",
      folder_id: "features",
      status: "approved",
      updated_at: "2026-01-02T00:00:00.000Z",
      version: 2
    }
  ], syncState, [{ action: "skip", termId: "term_1" }]);

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.nextTerms.get("term_1")?.canonical, "Teammate edit");
  assert.equal(plan.nextSyncState.terms.term_1?.version, 2);
});

test("overwrite conflict queues local push against newer cloud version", () => {
  const baseline = makeTerm("term_1", "Original", "2026-01-01T00:00:00.000Z");
  const local = makeTerm("term_1", "My local edit", "2026-01-03T00:00:00.000Z");
  const syncState = makeSyncState(baseline, 1);

  const plan = planVersionedSync([local], [
    {
      id: "term_1",
      project_id: "internal_library",
      canonical: "Teammate edit",
      type: "feature",
      folder_id: "features",
      status: "approved",
      updated_at: "2026-01-02T00:00:00.000Z",
      version: 2
    }
  ], syncState, [{ action: "overwrite", termId: "term_1" }]);

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.pushes.length, 1);
  assert.equal(plan.pushes[0]?.expectedVersion, 2);
});

function makeTerm(id: string, canonical: string, updatedAt: string): Term {
  return {
    id,
    projectId: "internal_library",
    canonical,
    type: "feature",
    folderId: "features",
    translations: {},
    evidence: [],
    tags: [],
    confidence: 0.9,
    status: "approved",
    updatedAt
  };
}

function makeSyncState(term: Term, version: number): LibrarySyncState {
  return {
    deletedTerms: {},
    terms: {
      [term.id]: {
        hash: termSyncHash(term),
        version
      }
    }
  };
}
