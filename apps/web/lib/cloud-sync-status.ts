export type CloudSyncStatus = {
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  error?: string;
  lastSyncedAt?: string;
};

export type CloudSyncNotice = {
  message: string;
  tone: "info" | "success" | "error";
};

export function cloudSyncNotice(status?: CloudSyncStatus): CloudSyncNotice {
  if (!status) {
    return { message: "Cloud sync failed", tone: "error" };
  }
  if (status.connected) {
    return { message: "Library synced with Supabase", tone: "success" };
  }
  if (!status.enabled) {
    return { message: "Cloud sync is off", tone: "info" };
  }
  if (!status.configured) {
    return { message: "Supabase is not linked", tone: "info" };
  }
  return {
    message: `Cloud sync failed${status.error ? `: ${status.error}` : ""}`,
    tone: "error"
  };
}

export function cloudSyncBadgeLabel(status: CloudSyncStatus): string {
  if (!status.enabled) return "Cloud Sync Off";
  if (status.connected) return status.lastSyncedAt ? `Synced ${formatSyncTime(status.lastSyncedAt)}` : "Cloud Sync On";
  if (!status.configured) return "Sync Not Linked";
  return status.error ? `Sync Failed: ${status.error}` : "Sync Failed";
}

export function cloudSyncBadgeTone(status: CloudSyncStatus): "connected" | "failed" | "off" {
  if (!status.enabled) return "off";
  if (status.connected) return "connected";
  return "failed";
}

function formatSyncTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
