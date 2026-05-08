export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
}

export function parseFigmaUrl(input: string): ParsedFigmaUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid Figma URL");
  }

  if (!/(^|\.)figma\.com$/.test(url.hostname)) {
    throw new Error("URL must be from figma.com");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const designIndex = parts.findIndex((part) => part === "design" || part === "file");
  if (designIndex === -1 || !parts[designIndex + 1]) {
    throw new Error("Figma file key was not found");
  }

  const nodeParam = url.searchParams.get("node-id") ?? undefined;
  return {
    fileKey: parts[designIndex + 1],
    nodeId: nodeParam?.replace("-", ":")
  };
}

export function estimateTextOverflow(source: string, translated: string): boolean {
  if (!source.trim()) return false;
  return translated.length > Math.max(source.length * 1.35, source.length + 18);
}
