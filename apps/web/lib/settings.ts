export type OpenAiKeySource = "runtime" | "env" | "none";
export type LlmKeySource = "runtime" | "env" | "none";
export type LlmProvider = "openai" | "gemini";
export type FigmaTokenSource = "runtime" | "env" | "none";
export type SupabaseSettingsSource = "runtime" | "env" | "none";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getWebRuntimePath } from "./runtime-path";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_LLM_PROVIDER: LlmProvider = "openai";
let runtimeSettingsPathOverride = process.env.APP_SETTINGS_PATH;

type RuntimeSettings = {
  apiKey?: string;
  baseUrl?: string;
  figmaAccessToken?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiModel?: string;
  llmProvider?: LlmProvider;
  model?: string;
  supabaseServiceRoleKey?: string;
  supabaseSyncEnabled?: boolean;
  supabaseUrl?: string;
};

const runtimeSettings = getSharedRuntimeSettings();
let settingsLoaded = false;

function getSharedRuntimeSettings(): RuntimeSettings {
  const globalKey = "__eu_translation_settings__";
  const globalStore = globalThis as typeof globalThis & Record<string, RuntimeSettings | undefined>;
  globalStore[globalKey] ??= {};
  return globalStore[globalKey];
}

function loadRuntimeSettings(): RuntimeSettings {
  if (settingsLoaded) return runtimeSettings;
  settingsLoaded = true;

  const settingsPath = getRuntimeSettingsPath();
  const legacyPath = getLegacyRuntimeSettingsPath();
  const sourcePath = existsSync(settingsPath) ? settingsPath : existsSync(legacyPath) ? legacyPath : undefined;
  if (!sourcePath) return runtimeSettings;

  const parsed = readRuntimeSettingsFile(sourcePath);
  if (parsed) {
    try {
      applyRuntimeSettings(parsed);
      if (sourcePath === legacyPath && settingsPath !== legacyPath) saveRuntimeSettings();
    } catch {
      // Invalid saved local settings should behave the same as no saved runtime settings.
    }
  }
  return runtimeSettings;
}

function readRuntimeSettingsFile(path: string): RuntimeSettings | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RuntimeSettings;
  } catch {
    // Missing or unreadable local settings should behave the same as no saved runtime key.
    return undefined;
  }
}

function applyRuntimeSettings(parsed: RuntimeSettings): void {
  runtimeSettings.apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey : undefined;
  runtimeSettings.baseUrl = typeof parsed.baseUrl === "string" ? normalizeOpenAiBaseUrl(parsed.baseUrl) : undefined;
  runtimeSettings.figmaAccessToken = typeof parsed.figmaAccessToken === "string" ? parsed.figmaAccessToken : undefined;
  runtimeSettings.geminiApiKey = typeof parsed.geminiApiKey === "string" ? parsed.geminiApiKey : undefined;
  runtimeSettings.geminiBaseUrl = typeof parsed.geminiBaseUrl === "string" ? normalizeGeminiBaseUrl(parsed.geminiBaseUrl) : undefined;
  runtimeSettings.geminiModel = typeof parsed.geminiModel === "string" ? normalizeGeminiModel(parsed.geminiModel) : undefined;
  runtimeSettings.llmProvider = normalizeLlmProvider(parsed.llmProvider);
  runtimeSettings.model = typeof parsed.model === "string" ? normalizeOpenAiModel(parsed.model) : undefined;
  runtimeSettings.supabaseServiceRoleKey = typeof parsed.supabaseServiceRoleKey === "string" ? parsed.supabaseServiceRoleKey : undefined;
  runtimeSettings.supabaseSyncEnabled = typeof parsed.supabaseSyncEnabled === "boolean" ? parsed.supabaseSyncEnabled : undefined;
  runtimeSettings.supabaseUrl = typeof parsed.supabaseUrl === "string" ? normalizeSupabaseUrl(parsed.supabaseUrl) : undefined;
}

function saveRuntimeSettings(): void {
  const settingsPath = getRuntimeSettingsPath();
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(runtimeSettings, null, 2), { mode: 0o600 });
}

function getRuntimeSettingsPath(): string {
  return getWebRuntimePath("settings.json", runtimeSettingsPathOverride);
}

function getLegacyRuntimeSettingsPath(): string {
  return getWebRuntimePath("openai-settings.json", process.env.OPENAI_SETTINGS_PATH);
}

export function getRuntimeOpenAiApiKey(): string | undefined {
  return loadRuntimeSettings().apiKey;
}

export function getRuntimeGeminiApiKey(): string | undefined {
  return loadRuntimeSettings().geminiApiKey;
}

export function getRuntimeGeminiBaseUrl(): string | undefined {
  return loadRuntimeSettings().geminiBaseUrl;
}

export function getRuntimeLlmProvider(): LlmProvider | undefined {
  return loadRuntimeSettings().llmProvider;
}

export function getRuntimeOpenAiBaseUrl(): string | undefined {
  return loadRuntimeSettings().baseUrl;
}

export function getRuntimeFigmaAccessToken(): string | undefined {
  return loadRuntimeSettings().figmaAccessToken;
}

export function getRuntimeSupabaseServiceRoleKey(): string | undefined {
  return loadRuntimeSettings().supabaseServiceRoleKey;
}

export function getRuntimeSupabaseUrl(): string | undefined {
  return loadRuntimeSettings().supabaseUrl;
}

export function getRuntimeSupabaseSyncEnabled(): boolean | undefined {
  return loadRuntimeSettings().supabaseSyncEnabled;
}

export function getOpenAiBaseUrl(): string {
  return normalizeOpenAiBaseUrl(getRuntimeOpenAiBaseUrl() || process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL);
}

export function getOpenAiModel(): string {
  return normalizeOpenAiModel(loadRuntimeSettings().model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
}

export function getGeminiModel(): string {
  return normalizeGeminiModel(loadRuntimeSettings().geminiModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
}

export function getGeminiBaseUrl(): string {
  return normalizeGeminiBaseUrl(getRuntimeGeminiBaseUrl() || process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL);
}

export function getLlmProvider(): LlmProvider {
  const runtimeProvider = getRuntimeLlmProvider();
  if (runtimeProvider) return runtimeProvider;
  const envProvider = process.env.LLM_PROVIDER;
  if (envProvider === "gemini" || envProvider === "openai") return envProvider;
  return DEFAULT_LLM_PROVIDER;
}

export function getActiveLlmApiKey(): string | undefined {
  if (getLlmProvider() === "gemini") {
    return getRuntimeGeminiApiKey() || process.env.GEMINI_API_KEY;
  }
  return getRuntimeOpenAiApiKey() || process.env.OPENAI_API_KEY;
}

export function getActiveLlmModel(): string {
  return getLlmProvider() === "gemini" ? getGeminiModel() : getOpenAiModel();
}

export function hasLlmApiKey(): boolean {
  return Boolean(getActiveLlmApiKey());
}

export function setRuntimeOpenAiApiKey(apiKey: string): void {
  loadRuntimeSettings();
  const normalized = apiKey.trim();
  if (!isValidOpenAiApiKey(normalized)) {
    throw new Error("API key is required");
  }
  runtimeSettings.apiKey = normalized;
  saveRuntimeSettings();
}

export function setRuntimeOpenAiBaseUrl(baseUrl: string): void {
  loadRuntimeSettings();
  runtimeSettings.baseUrl = normalizeOpenAiBaseUrl(baseUrl || DEFAULT_OPENAI_BASE_URL);
  saveRuntimeSettings();
}

export function setRuntimeOpenAiModel(model: string): void {
  loadRuntimeSettings();
  runtimeSettings.model = normalizeOpenAiModel(model || DEFAULT_OPENAI_MODEL);
  saveRuntimeSettings();
}

export function setRuntimeGeminiApiKey(apiKey: string): void {
  loadRuntimeSettings();
  const normalized = apiKey.trim();
  if (!isValidApiKey(normalized)) {
    throw new Error("API key is required");
  }
  runtimeSettings.geminiApiKey = normalized;
  saveRuntimeSettings();
}

export function setRuntimeGeminiBaseUrl(baseUrl: string): void {
  loadRuntimeSettings();
  runtimeSettings.geminiBaseUrl = normalizeGeminiBaseUrl(baseUrl || DEFAULT_GEMINI_BASE_URL);
  saveRuntimeSettings();
}

export function setRuntimeGeminiModel(model: string): void {
  loadRuntimeSettings();
  runtimeSettings.geminiModel = normalizeGeminiModel(model || DEFAULT_GEMINI_MODEL);
  saveRuntimeSettings();
}

export function setRuntimeLlmProvider(provider: LlmProvider): void {
  loadRuntimeSettings();
  runtimeSettings.llmProvider = normalizeLlmProvider(provider) ?? DEFAULT_LLM_PROVIDER;
  saveRuntimeSettings();
}

export function setRuntimeFigmaAccessToken(token: string): void {
  loadRuntimeSettings();
  const normalized = token.trim();
  if (!normalized) {
    throw new Error("Figma access token is required");
  }
  runtimeSettings.figmaAccessToken = normalized;
  saveRuntimeSettings();
}

export function setRuntimeSupabaseSettings(url: string, serviceRoleKey: string): void {
  loadRuntimeSettings();
  const normalizedUrl = normalizeSupabaseUrl(url);
  const normalizedKey = serviceRoleKey.trim();
  if (!normalizedKey) {
    throw new Error("Supabase service role key is required");
  }
  runtimeSettings.supabaseUrl = normalizedUrl;
  runtimeSettings.supabaseServiceRoleKey = normalizedKey;
  runtimeSettings.supabaseSyncEnabled = true;
  saveRuntimeSettings();
}

export function clearRuntimeOpenAiApiKey(): void {
  loadRuntimeSettings();
  runtimeSettings.apiKey = undefined;
  saveRuntimeSettings();
}

export function clearRuntimeGeminiApiKey(): void {
  loadRuntimeSettings();
  runtimeSettings.geminiApiKey = undefined;
  saveRuntimeSettings();
}

export function clearActiveLlmApiKey(): void {
  if (getLlmProvider() === "gemini") {
    clearRuntimeGeminiApiKey();
    return;
  }
  clearRuntimeOpenAiApiKey();
}

export function clearRuntimeFigmaAccessToken(): void {
  loadRuntimeSettings();
  runtimeSettings.figmaAccessToken = undefined;
  saveRuntimeSettings();
}

export function clearRuntimeSupabaseSettings(): void {
  loadRuntimeSettings();
  runtimeSettings.supabaseUrl = undefined;
  runtimeSettings.supabaseServiceRoleKey = undefined;
  runtimeSettings.supabaseSyncEnabled = undefined;
  saveRuntimeSettings();
}

export function resetRuntimeSettingsForTest(settingsPath?: string): void {
  runtimeSettingsPathOverride = settingsPath;
  settingsLoaded = false;
  for (const key of Object.keys(runtimeSettings) as Array<keyof RuntimeSettings>) {
    runtimeSettings[key] = undefined;
  }
}

export function getRuntimeSettingsPathForTest(): string {
  return getRuntimeSettingsPath();
}

export function getFigmaAccessToken(): string | undefined {
  return getRuntimeFigmaAccessToken() || process.env.FIGMA_ACCESS_TOKEN;
}

export function getSupabaseSettings(): {
  serviceRoleKey?: string;
  syncEnabled: boolean;
  url?: string;
} {
  const runtimeUrl = getRuntimeSupabaseUrl();
  const runtimeKey = getRuntimeSupabaseServiceRoleKey();
  const hasRuntimeSettings = Boolean(runtimeUrl && runtimeKey);
  const envEnabled = process.env.SUPABASE_SYNC_ENABLED === "true";
  return {
    serviceRoleKey: runtimeKey || process.env.SUPABASE_SERVICE_ROLE_KEY,
    syncEnabled: hasRuntimeSettings ? getRuntimeSupabaseSyncEnabled() !== false : envEnabled,
    url: runtimeUrl || process.env.SUPABASE_URL
  };
}

export function getFigmaTokenStatus(envToken = process.env.FIGMA_ACCESS_TOKEN): {
  configured: boolean;
  maskedToken?: string;
  source: FigmaTokenSource;
} {
  const runtimeToken = getRuntimeFigmaAccessToken();
  const token = runtimeToken || envToken;
  if (!token) return { configured: false, source: "none" };
  return {
    configured: true,
    maskedToken: maskSecret(token),
    source: runtimeToken ? "runtime" : "env"
  };
}

export function getSupabaseSettingsStatus(
  envUrl = process.env.SUPABASE_URL,
  envKey = process.env.SUPABASE_SERVICE_ROLE_KEY
): {
  configured: boolean;
  maskedKey?: string;
  source: SupabaseSettingsSource;
  syncEnabled: boolean;
  url?: string;
} {
  const runtimeUrl = getRuntimeSupabaseUrl();
  const runtimeKey = getRuntimeSupabaseServiceRoleKey();
  const hasRuntimeSettings = Boolean(runtimeUrl && runtimeKey);
  const url = runtimeUrl || envUrl;
  const key = runtimeKey || envKey;
  if (!url || !key) {
    return {
      configured: false,
      source: "none",
      syncEnabled: getRuntimeSupabaseSyncEnabled() ?? process.env.SUPABASE_SYNC_ENABLED === "true",
      url
    };
  }

  return {
    configured: true,
    maskedKey: maskSecret(key),
    source: hasRuntimeSettings ? "runtime" : "env",
    syncEnabled: hasRuntimeSettings ? getRuntimeSupabaseSyncEnabled() !== false : process.env.SUPABASE_SYNC_ENABLED === "true",
    url: normalizeSupabaseUrl(url)
  };
}

export function getOpenAiKeyStatus(envKey = process.env.OPENAI_API_KEY): {
  baseUrl: string;
  configured: boolean;
  maskedKey?: string;
  model: string;
  source: OpenAiKeySource;
} {
  const runtimeKey = getRuntimeOpenAiApiKey();
  const key = runtimeKey || envKey;
  if (!key) return { baseUrl: getOpenAiBaseUrl(), configured: false, model: getOpenAiModel(), source: "none" };
  return {
    baseUrl: getOpenAiBaseUrl(),
    configured: true,
    maskedKey: maskOpenAiApiKey(key),
    model: getOpenAiModel(),
    source: runtimeKey ? "runtime" : "env"
  };
}

export function getGeminiKeyStatus(envKey = process.env.GEMINI_API_KEY): {
  baseUrl: string;
  configured: boolean;
  maskedKey?: string;
  model: string;
  source: LlmKeySource;
} {
  const runtimeKey = getRuntimeGeminiApiKey();
  const key = runtimeKey || envKey;
  if (!key) return { baseUrl: getGeminiBaseUrl(), configured: false, model: getGeminiModel(), source: "none" };
  return {
    baseUrl: getGeminiBaseUrl(),
    configured: true,
    maskedKey: maskSecret(key),
    model: getGeminiModel(),
    source: runtimeKey ? "runtime" : "env"
  };
}

export function getLlmSettingsStatus(
  envOpenAiKey = process.env.OPENAI_API_KEY,
  envGeminiKey = process.env.GEMINI_API_KEY
): {
  baseUrl?: string;
  configured: boolean;
  gemini: ReturnType<typeof getGeminiKeyStatus>;
  maskedGeminiKey?: string;
  maskedOpenAiKey?: string;
  maskedKey?: string;
  model: string;
  openai: ReturnType<typeof getOpenAiKeyStatus>;
  provider: LlmProvider;
  source: LlmKeySource;
} {
  const provider = getLlmProvider();
  const openai = getOpenAiKeyStatus(envOpenAiKey);
  const gemini = getGeminiKeyStatus(envGeminiKey);
  const active = provider === "gemini" ? gemini : openai;

  return {
    baseUrl: provider === "openai" ? openai.baseUrl : gemini.baseUrl,
    configured: active.configured,
    gemini,
    maskedGeminiKey: gemini.maskedKey,
    maskedKey: active.maskedKey,
    maskedOpenAiKey: openai.maskedKey,
    model: active.model,
    openai,
    provider,
    source: active.source
  };
}

export function isValidOpenAiApiKey(apiKey: string): boolean {
  return isValidApiKey(apiKey);
}

export function isValidApiKey(apiKey: string): boolean {
  return apiKey.trim().length > 0;
}

export function maskOpenAiApiKey(apiKey: string): string {
  return maskSecret(apiKey);
}

export function maskSecret(secret: string): string {
  const normalized = secret.trim();
  if (normalized.length <= 12) return "sk-...";
  return `${normalized.slice(0, 7)}...${normalized.slice(-4)}`;
}

export function normalizeOpenAiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim() || DEFAULT_OPENAI_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("OpenAI API URL must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("OpenAI API URL must use http or https");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeOpenAiModel(model: string): string {
  const normalized = model.trim() || DEFAULT_OPENAI_MODEL;
  if (/\s/.test(normalized)) {
    throw new Error("OpenAI model must not contain spaces. Use a model id like gpt-5.5.");
  }
  return normalized;
}

export function normalizeGeminiModel(model: string): string {
  const normalized = model.trim() || DEFAULT_GEMINI_MODEL;
  if (/\s/.test(normalized)) {
    throw new Error("Gemini model must not contain spaces. Use a model id like gemini-2.5-flash.");
  }
  return normalized;
}

export function normalizeGeminiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim() || DEFAULT_GEMINI_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Gemini API URL must be a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Gemini API URL must use http or https");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeLlmProvider(provider: unknown): LlmProvider | undefined {
  if (provider === "openai" || provider === "gemini") return provider;
  return undefined;
}

export function normalizeSupabaseUrl(url: string): string {
  const normalized = url.trim();
  if (!normalized) throw new Error("Supabase URL is required");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Supabase URL must be a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Supabase URL must use http or https");
  }
  return parsed.toString().replace(/\/$/, "");
}
