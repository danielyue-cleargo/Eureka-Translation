import assert from "node:assert/strict";
import test from "node:test";
import { cloudSyncBadgeLabel, cloudSyncNotice } from "./cloud-sync-status";

test("cloud sync notice distinguishes off, unlinked, failed, and connected states", () => {
  assert.deepEqual(cloudSyncNotice({ configured: false, connected: false, enabled: false }), {
    message: "Cloud sync is off",
    tone: "info"
  });
  assert.deepEqual(cloudSyncNotice({ configured: false, connected: false, enabled: true }), {
    message: "Supabase is not linked",
    tone: "info"
  });
  assert.deepEqual(cloudSyncNotice({ configured: true, connected: false, enabled: true, error: "Supabase 401" }), {
    message: "Cloud sync failed: Supabase 401",
    tone: "error"
  });
  assert.deepEqual(cloudSyncNotice({ configured: true, connected: true, enabled: true }), {
    message: "Library synced with Supabase",
    tone: "success"
  });
});

test("cloud sync badge exposes failed sync errors", () => {
  assert.equal(
    cloudSyncBadgeLabel({ configured: true, connected: false, enabled: true, error: "Supabase 404: table missing" }),
    "Sync Failed: Supabase 404: table missing"
  );
});
