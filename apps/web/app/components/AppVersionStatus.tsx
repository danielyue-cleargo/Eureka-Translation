"use client";

import { useCallback, useEffect, useState } from "react";

type AppVersionPayload = {
  localSha: string | null;
  remoteSha: string | null;
  aheadBy: number | null;
  behindBy: number | null;
  uiStatus: "synced" | "behind" | "ahead" | "diverged" | "unknown";
  message?: string;
  fetchedAt?: string;
};

type NoticeTone = "info" | "success" | "error";
type NoticeAction = {
  label: string;
  onClick: () => void | Promise<void>;
};

const UPDATE_COMMAND = "git pull && npm install";

export function AppVersionStatus({
  onNotice
}: {
  onNotice?: (message: string, tone?: NoticeTone, action?: NoticeAction | null) => void;
}) {
  const [data, setData] = useState<AppVersionPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/app-version");
      const json = (await response.json()) as AppVersionPayload;
      setData(json);
    } catch {
      setData({
        localSha: null,
        remoteSha: null,
        aheadBy: null,
        behindBy: null,
        uiStatus: "unknown",
        message: "Could not reach version check."
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), 8 * 60 * 1000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const status = data?.uiStatus ?? "unknown";
  const label =
    loading ? "Checking version…" : status === "synced" ? "App up to date" : status === "behind" ? "Update available" : status === "ahead" ? "Ahead of GitHub" : status === "diverged" ? "Branch diverged" : "Version unknown";

  const dotClass = loading
    ? "checking"
    : status === "synced"
      ? "connected"
      : status === "behind"
        ? "version-warning"
        : status === "ahead"
          ? "version-ahead"
          : status === "diverged"
            ? "version-diverged"
            : "missing";

  const shortSha = data?.localSha ? data.localSha.slice(0, 7) : "—";

  async function copyUpdateCommand() {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      onNotice?.(`Copied "${UPDATE_COMMAND}". Restart the dev server after pulling.`, "success");
    } catch {
      onNotice?.("Copy failed. Run: git pull && npm install from the repo root, then npm run dev.", "info");
    }
  }

  function showUpdateCommand() {
    onNotice?.(`Run ${UPDATE_COMMAND} from the repo root, then restart the dev server.`, "info", {
      label: "Copy",
      onClick: copyUpdateCommand
    });
  }

  return (
    <div className="api-signal app-version-signal" title={data?.message || `${label} · local ${shortSha}`}>
      <span className={`signal-dot ${dotClass}`} aria-hidden="true" />
      <span className="app-version-label">{label}</span>
      {status === "behind" ? (
        <button className="app-version-update-button" onClick={showUpdateCommand} type="button">
          Update now
        </button>
      ) : null}
    </div>
  );
}
