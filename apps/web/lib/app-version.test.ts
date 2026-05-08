import assert from "node:assert/strict";
import test from "node:test";
import { interpretVersionSync } from "./app-version";

test("interpretVersionSync synced when shas match", () => {
  assert.deepEqual(interpretVersionSync({ localSha: "abc", remoteSha: "abc", aheadBy: 0, behindBy: 0 }), { status: "synced" });
});

test("interpretVersionSync behind when remote is ahead", () => {
  const r = interpretVersionSync({ localSha: "aaa", remoteSha: "bbb", aheadBy: 3, behindBy: 0 });
  assert.equal(r.status, "behind");
  assert.match(r.message ?? "", /3 commits on GitHub/);
});

test("interpretVersionSync ahead when only local ahead", () => {
  const r = interpretVersionSync({ localSha: "bbb", remoteSha: "aaa", aheadBy: 0, behindBy: 2 });
  assert.equal(r.status, "ahead");
  assert.match(r.message ?? "", /2 unpublished commits/);
});

test("interpretVersionSync diverged", () => {
  const r = interpretVersionSync({ localSha: "a", remoteSha: "b", aheadBy: 2, behindBy: 1 });
  assert.equal(r.status, "diverged");
});

test("interpretVersionSync unknown without local sha", () => {
  assert.equal(interpretVersionSync({ localSha: null, remoteSha: "x", aheadBy: 0, behindBy: 0 }).status, "unknown");
});

test("interpretVersionSync unknown when compare fails", () => {
  assert.equal(
    interpretVersionSync({ localSha: "a", remoteSha: "b", aheadBy: null, behindBy: null, compareFailed: true }).status,
    "unknown"
  );
});
