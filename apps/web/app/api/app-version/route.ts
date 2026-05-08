import { NextResponse } from "next/server";
import {
  getConfiguredGitHubRepo,
  getLocalGitHeadSha,
  interpretVersionSync,
  type AppVersionUiStatus
} from "@/lib/app-version";

const GITHUB_API = "https://api.github.com";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

type CachedPayload = {
  localSha: string | null;
  remoteSha: string | null;
  aheadBy: number | null;
  behindBy: number | null;
  uiStatus: AppVersionUiStatus;
  message?: string;
  fetchedAt: string;
};

let cache: { expires: number; body: CachedPayload } | null = null;

function githubHeaders(): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Eureka-Translation/1.0 (localhost version check)"
  };
}

async function fetchJson(url: string): Promise<{ ok: boolean; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: githubHeaders(), signal: controller.signal });
    const text = await response.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: response.ok, data };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
}

async function getRemoteMainSha(owner: string, repo: string): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/commits/main`;
  const { ok, data } = await fetchJson(url);
  if (!ok || !data?.sha || typeof data.sha !== "string") return null;
  const sha = String(data.sha).trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

async function getCompareAheadBehind(
  owner: string,
  repo: string,
  base: string,
  head: string
): Promise<{ aheadBy: number | null; behindBy: number | null; failed: boolean }> {
  const baseEnc = encodeURIComponent(base);
  const headEnc = encodeURIComponent(head);
  const url = `${GITHUB_API}/repos/${owner}/${repo}/compare/${baseEnc}...${headEnc}`;
  const { ok, data } = await fetchJson(url);
  if (!ok || !data) {
    return { aheadBy: null, behindBy: null, failed: true };
  }
  const ahead = typeof data.ahead_by === "number" ? data.ahead_by : null;
  const behind = typeof data.behind_by === "number" ? data.behind_by : null;
  if (ahead === null || behind === null) {
    return { aheadBy: null, behindBy: null, failed: true };
  }
  return { aheadBy: ahead, behindBy: behind, failed: false };
}

export async function GET() {
  const now = Date.now();
  if (cache && cache.expires > now) {
    return NextResponse.json(cache.body);
  }

  const localSha = getLocalGitHeadSha();
  const repoPath = getConfiguredGitHubRepo();
  const [owner, repo] = repoPath.split("/");

  const remoteSha = owner && repo ? await getRemoteMainSha(owner, repo) : null;

  let aheadBy: number | null = null;
  let behindBy: number | null = null;
  let compareFailed = false;

  if (localSha && remoteSha && localSha !== remoteSha) {
    const cmp = await getCompareAheadBehind(owner, repo, localSha, remoteSha);
    aheadBy = cmp.aheadBy;
    behindBy = cmp.behindBy;
    compareFailed = cmp.failed;
  } else if (localSha && remoteSha && localSha === remoteSha) {
    aheadBy = 0;
    behindBy = 0;
    compareFailed = false;
  }

  const interpreted = interpretVersionSync({
    localSha,
    remoteSha,
    aheadBy,
    behindBy,
    compareFailed: Boolean(localSha && remoteSha && localSha !== remoteSha && compareFailed)
  });

  const body = buildPayload(localSha, remoteSha, aheadBy, behindBy, interpreted);
  cache = { expires: now + CACHE_TTL_MS, body };
  return NextResponse.json(body);
}

function buildPayload(
  localSha: string | null,
  remoteSha: string | null,
  aheadBy: number | null,
  behindBy: number | null,
  interpreted: ReturnType<typeof interpretVersionSync>
): CachedPayload {
  return {
    localSha,
    remoteSha,
    aheadBy,
    behindBy,
    uiStatus: interpreted.status,
    message: interpreted.message,
    fetchedAt: new Date().toISOString()
  };
}
