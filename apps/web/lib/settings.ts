export type OpenAiKeySource = "runtime" | "env" | "none";
export type FigmaTokenSource = "runtime" | "env" | "none";
export type SupabaseSettingsSource = "runtime" | "env" | "none";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getWebRuntimePath } from "./runtime-path";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
let runtimeSettingsPathOverride = process.env.APP_SETTINGS_PATH;

type RuntimeSettings = {
  apiKey?: string;
  baseUrl?: string;
  figmaAccessToken?: string;
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

export function isValidOpenAiApiKey(apiKey: string): boolean {
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
