import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import {
  clearActiveLlmApiKey,
  clearRuntimeGeminiApiKey,
  clearRuntimeOpenAiApiKey,
  clearRuntimeFigmaAccessToken,
  clearRuntimeSupabaseSettings,
  getActiveLlmApiKey,
  getFigmaTokenStatus,
  getGeminiKeyStatus,
  getGeminiModel,
  getLlmProvider,
  getLlmSettingsStatus,
  getOpenAiBaseUrl,
  getOpenAiKeyStatus,
  getOpenAiModel,
  getRuntimeSettingsPathForTest,
  hasLlmApiKey,
  getSupabaseSettings,
  getSupabaseSettingsStatus,
  maskOpenAiApiKey,
  normalizeGeminiBaseUrl,
  normalizeGeminiModel,
  normalizeOpenAiBaseUrl,
  normalizeOpenAiModel,
  normalizeSupabaseUrl,
  resetRuntimeSettingsForTest,
  setRuntimeFigmaAccessToken,
  setRuntimeGeminiApiKey,
  setRuntimeGeminiBaseUrl,
  setRuntimeGeminiModel,
  setRuntimeLlmProvider,
  setRuntimeOpenAiBaseUrl,
  setRuntimeOpenAiApiKey,
  setRuntimeOpenAiModel,
  setRuntimeSupabaseSettings
} from "./settings";

beforeEach(() => {
  resetRuntimeSettingsForTest(makeTempSettingsPath());
});

function makeTempSettingsPath(): string {
  return join(mkdtempSync(join(tmpdir(), "eu-web-settings-")), "settings.json");
}

test("masks OpenAI keys without exposing full value", () => {
  const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
  const masked = maskOpenAiApiKey(key);
  assert.equal(masked.startsWith("sk-proj"), true);
  assert.equal(masked.endsWith("3456"), true);
  assert.equal(masked.includes("abcdefghijklmnopqrstuvwxyz"), false);
});

test("runtime OpenAI key status never returns the raw key", () => {
  clearRuntimeOpenAiApiKey();
  setRuntimeOpenAiApiKey("custom-provider-key_1234567890abcdef");
  const status = getOpenAiKeyStatus();
  assert.equal(status.configured, true);
  assert.equal(status.source, "runtime");
  assert.notEqual(status.maskedKey, "custom-provider-key_1234567890abcdef");
  clearRuntimeOpenAiApiKey();
});

test("runtime settings persist to settings json and reload from disk", () => {
  setRuntimeOpenAiApiKey("custom-provider-key_1234567890abcdef");
  setRuntimeOpenAiBaseUrl("https://api.openai.com/v1/");
  setRuntimeOpenAiModel("gpt-5.5");
  setRuntimeFigmaAccessToken("figd_custom-token_1234567890abcdef");
  setRuntimeSupabaseSettings("https://example.supabase.co/", "service-role-key_1234567890abcdef");

  const settingsPath = getRuntimeSettingsPathForTest();
  const saved = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(saved.apiKey, "custom-provider-key_1234567890abcdef");
  assert.equal(saved.baseUrl, "https://api.openai.com/v1");
  assert.equal(saved.model, "gpt-5.5");
  assert.equal(saved.figmaAccessToken, "figd_custom-token_1234567890abcdef");
  assert.equal(saved.supabaseUrl, "https://example.supabase.co");
  assert.equal(saved.supabaseServiceRoleKey, "service-role-key_1234567890abcdef");
  assert.equal(saved.supabaseSyncEnabled, true);
  assert.equal((statSync(settingsPath).mode & 0o777).toString(8), "600");

  resetRuntimeSettingsForTest(settingsPath);
  assert.equal(getOpenAiKeyStatus().source, "runtime");
  assert.equal(getOpenAiBaseUrl(), "https://api.openai.com/v1");
  assert.equal(getOpenAiModel(), "gpt-5.5");
  assert.equal(getFigmaTokenStatus().source, "runtime");
  assert.equal(getSupabaseSettings().url, "https://example.supabase.co");
});

test("clearing one runtime setting preserves other saved settings", () => {
  setRuntimeOpenAiApiKey("custom-provider-key_1234567890abcdef");
  setRuntimeFigmaAccessToken("figd_custom-token_1234567890abcdef");

  resetRuntimeSettingsForTest(getRuntimeSettingsPathForTest());
  clearRuntimeOpenAiApiKey();

  assert.equal(getOpenAiKeyStatus().source, "none");
  assert.equal(getFigmaTokenStatus().source, "runtime");
  const saved = JSON.parse(readFileSync(getRuntimeSettingsPathForTest(), "utf8"));
  assert.equal(saved.apiKey, undefined);
  assert.equal(saved.figmaAccessToken, "figd_custom-token_1234567890abcdef");
});

test("legacy openai-settings json migrates to settings json", () => {
  const previousLegacyPath = process.env.OPENAI_SETTINGS_PATH;
  const runtimePath = makeTempSettingsPath();
  const legacyPath = join(mkdtempSync(join(tmpdir(), "eu-web-legacy-settings-")), "openai-settings.json");
  process.env.OPENAI_SETTINGS_PATH = legacyPath;
  resetRuntimeSettingsForTest(runtimePath);
  try {
    writeFileSync(
      legacyPath,
      JSON.stringify({
        apiKey: "legacy-provider-key_1234567890abcdef",
        baseUrl: "https://legacy.example.com/v1",
        model: "legacy-model",
        figmaAccessToken: "figd_legacy-token_1234567890abcdef",
        supabaseServiceRoleKey: "legacy-service-role-key_1234567890abcdef",
        supabaseSyncEnabled: true,
        supabaseUrl: "https://legacy.supabase.co"
      })
    );

    assert.equal(getOpenAiKeyStatus().source, "runtime");
    assert.equal(getOpenAiBaseUrl(), "https://legacy.example.com/v1");
    assert.equal(getOpenAiModel(), "legacy-model");
    assert.equal(getFigmaTokenStatus().source, "runtime");
    assert.equal(getSupabaseSettings().url, "https://legacy.supabase.co");
    assert.equal(existsSync(runtimePath), true);
  } finally {
    if (previousLegacyPath === undefined) delete process.env.OPENAI_SETTINGS_PATH;
    else process.env.OPENAI_SETTINGS_PATH = previousLegacyPath;
  }
});

test("env OpenAI key is used when runtime key is absent", () => {
  clearRuntimeOpenAiApiKey();
  const status = getOpenAiKeyStatus("sk-env_1234567890abcdef");
  assert.equal(status.configured, true);
  assert.equal(status.source, "env");
});

test("runtime Figma token status never returns the raw token", () => {
  clearRuntimeFigmaAccessToken();
  setRuntimeFigmaAccessToken("figd_custom-token_1234567890abcdef");
  const status = getFigmaTokenStatus();
  assert.equal(status.configured, true);
  assert.equal(status.source, "runtime");
  assert.notEqual(status.maskedToken, "figd_custom-token_1234567890abcdef");
  clearRuntimeFigmaAccessToken();
});

test("env Figma token is used when runtime token is absent", () => {
  clearRuntimeFigmaAccessToken();
  const status = getFigmaTokenStatus("figd_env-token_1234567890abcdef");
  assert.equal(status.configured, true);
  assert.equal(status.source, "env");
});

test("normalizes and stores runtime OpenAI base URL", () => {
  setRuntimeOpenAiBaseUrl("https://api.openai.com/v1/");
  assert.equal(getOpenAiBaseUrl(), "https://api.openai.com/v1");
  assert.equal(normalizeOpenAiBaseUrl("https://example.com/openai/"), "https://example.com/openai");
});

test("normalizes and stores runtime OpenAI model", () => {
  setRuntimeOpenAiModel("gpt-5.5");
  assert.equal(getOpenAiModel(), "gpt-5.5");
  assert.equal(normalizeOpenAiModel(" gpt-5.5 "), "gpt-5.5");
  assert.throws(() => normalizeOpenAiModel("gpt 5.5"), /must not contain spaces/);
});

test("runtime Supabase settings are preferred over env and masked in status", () => {
  clearRuntimeSupabaseSettings();
  setRuntimeSupabaseSettings("https://example.supabase.co/", "service-role-key_1234567890abcdef");

  const settings = getSupabaseSettings();
  const status = getSupabaseSettingsStatus("https://env.supabase.co", "env-key_1234567890abcdef");

  assert.equal(settings.url, "https://example.supabase.co");
  assert.equal(settings.serviceRoleKey, "service-role-key_1234567890abcdef");
  assert.equal(settings.syncEnabled, true);
  assert.equal(status.configured, true);
  assert.equal(status.source, "runtime");
  assert.notEqual(status.maskedKey, "service-role-key_1234567890abcdef");

  clearRuntimeSupabaseSettings();
});

test("normalizes Supabase URL", () => {
  assert.equal(normalizeSupabaseUrl("https://example.supabase.co/"), "https://example.supabase.co");
  assert.throws(() => normalizeSupabaseUrl("not a url"), /valid URL/);
});

test("persists llm provider and gemini settings", () => {
  setRuntimeOpenAiApiKey("custom-provider-key_1234567890abcdef");
  setRuntimeGeminiApiKey("gemini-key_1234567890abcdef");
  setRuntimeGeminiModel("gemini-2.5-flash");
  setRuntimeLlmProvider("gemini");

  const saved = JSON.parse(readFileSync(getRuntimeSettingsPathForTest(), "utf8"));
  assert.equal(saved.llmProvider, "gemini");
  assert.equal(saved.geminiApiKey, "gemini-key_1234567890abcdef");
  assert.equal(saved.geminiModel, "gemini-2.5-flash");
  assert.equal(saved.apiKey, "custom-provider-key_1234567890abcdef");

  resetRuntimeSettingsForTest(getRuntimeSettingsPathForTest());
  assert.equal(getLlmProvider(), "gemini");
  assert.equal(getGeminiModel(), "gemini-2.5-flash");
  assert.equal(getActiveLlmApiKey(), "gemini-key_1234567890abcdef");
  assert.equal(hasLlmApiKey(), true);
});

test("llm settings status reflects active provider", () => {
  setRuntimeOpenAiApiKey("custom-provider-key_1234567890abcdef");
  setRuntimeGeminiApiKey("gemini-key_1234567890abcdef");
  setRuntimeLlmProvider("gemini");

  const status = getLlmSettingsStatus();
  assert.equal(status.provider, "gemini");
  assert.equal(status.configured, true);
  assert.equal(status.source, "runtime");
  assert.equal(status.openai.configured, true);
  assert.equal(status.gemini.configured, true);

  setRuntimeLlmProvider("openai");
  const openAiStatus = getLlmSettingsStatus();
  assert.equal(openAiStatus.provider, "openai");
  assert.equal(openAiStatus.configured, true);
});

test("clearing active llm key preserves the other provider key", () => {
  setRuntimeOpenAiApiKey("custom-provider-key_1234567890abcdef");
  setRuntimeGeminiApiKey("gemini-key_1234567890abcdef");
  setRuntimeLlmProvider("gemini");

  clearActiveLlmApiKey();
  assert.equal(getGeminiKeyStatus().configured, false);
  assert.equal(getOpenAiKeyStatus().configured, true);
});

test("env gemini key is used when runtime key is absent and provider is gemini", () => {
  clearRuntimeGeminiApiKey();
  setRuntimeLlmProvider("gemini");
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "gemini-env-key_1234567890abcdef";
  try {
    const status = getLlmSettingsStatus(undefined, process.env.GEMINI_API_KEY);
    assert.equal(status.provider, "gemini");
    assert.equal(status.configured, true);
    assert.equal(status.source, "env");
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

test("normalizes gemini model", () => {
  setRuntimeGeminiModel("gemini-2.5-flash");
  assert.equal(getGeminiModel(), "gemini-2.5-flash");
  assert.equal(normalizeGeminiModel(" gemini-2.5-flash "), "gemini-2.5-flash");
  assert.throws(() => normalizeGeminiModel("gemini 2.5"), /must not contain spaces/);
});

test("normalizes and stores runtime gemini base url", () => {
  setRuntimeGeminiBaseUrl("https://generativelanguage.googleapis.com/v1beta/");
  assert.equal(normalizeGeminiBaseUrl("https://proxy.example.com/v1beta/"), "https://proxy.example.com/v1beta");
  const saved = JSON.parse(readFileSync(getRuntimeSettingsPathForTest(), "utf8"));
  assert.equal(saved.geminiBaseUrl, "https://generativelanguage.googleapis.com/v1beta");
});
