import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getWebAppRoot } from "./runtime-path";

export type AppVersionUiStatus = "synced" | "behind" | "ahead" | "diverged" | "unknown";

const DEFAULT_REPO = "danielyue-cleargo/Eureka-Translation";

export function getConfiguredGitHubRepo(): string {
  const raw = String(process.env.GITHUB_REPO || "").trim();
  if (raw && /^[\w.-]+\/[\w.-]+$/.test(raw)) return raw;
  return DEFAULT_REPO;
}

/**
 * Walk upward from several candidate roots to find a directory containing `.git`.
 */
export function findGitRepositoryRoot(): string | null {
  const seen = new Set<string>();
  for (const seed of [process.cwd(), getWebAppRoot(), join(getWebAppRoot(), "..", "..")]) {
    let dir = seed;
    for (let depth = 0; depth < 12; depth += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);
      if (existsSync(join(dir, ".git"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

export function getLocalGitHeadSha(): string | null {
  const fromEnv =
    String(process.env.NEXT_PUBLIC_APP_GIT_SHA || "").trim() ||
    String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
  if (fromEnv.length >= 7) return fromEnv;

  const root = findGitRepositoryRoot();
  if (!root) return null;
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function interpretVersionSync(input: {
  localSha: string | null;
  remoteSha: string | null;
  aheadBy: number | null;
  behindBy: number | null;
  compareFailed?: boolean;
}): { status: AppVersionUiStatus; message?: string } {
  const { localSha, remoteSha, aheadBy, behindBy, compareFailed } = input;
  if (!localSha) {
    return {
      status: "unknown",
      message: "Local git commit unavailable. Use a git clone or set NEXT_PUBLIC_APP_GIT_SHA."
    };
  }
  if (!remoteSha) {
    return { status: "unknown", message: "Could not load latest commit from GitHub." };
  }
  if (localSha === remoteSha) {
    return { status: "synced" };
  }
  if (compareFailed || aheadBy === null || behindBy === null) {
    return { status: "unknown", message: "Could not compare local and GitHub commits." };
  }
  if (aheadBy > 0 && behindBy > 0) {
    return { status: "diverged", message: `Branches diverged (${behindBy} local / ${aheadBy} on GitHub).` };
  }
  if (aheadBy > 0) {
    return { status: "behind", message: aheadBy === 1 ? "1 commit on GitHub." : `${aheadBy} commits on GitHub.` };
  }
  if (behindBy > 0) {
    return {
      status: "ahead",
      message: behindBy === 1 ? "1 unpublished commit (not on GitHub)." : `${behindBy} unpublished commits.`
    };
  }
  return { status: "unknown", message: "Version state unclear." };
}
