import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { getWebRuntimePath } from "./runtime-path";

test("runtime files are stored under the web app runtime directory", () => {
  assert.equal(getWebRuntimePath("settings.json"), join(process.cwd(), ".runtime", "settings.json"));
});

test("explicit runtime path env override is preserved", () => {
  assert.equal(getWebRuntimePath("settings.json", "/tmp/custom-settings.json"), "/tmp/custom-settings.json");
});
