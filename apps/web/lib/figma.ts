import { parseFigmaUrl, type FigmaFrameSnapshot, type FigmaTextNode } from "@eu-translation/shared";
import { getFigmaAccessToken } from "./settings";

type FigmaRestNode = {
  id: string;
  name?: string;
  type?: string;
  characters?: string;
  visible?: boolean;
  locked?: boolean;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  children?: FigmaRestNode[];
};

export async function fetchFigmaFrameSnapshot(figmaUrl: string): Promise<FigmaFrameSnapshot> {
  const parsed = parseFigmaUrl(figmaUrl);
  if (!parsed.nodeId) {
    throw new Error("Figma frame link must include a node-id. Copy a link to the exact frame.");
  }

  const token = getFigmaAccessToken();
  if (!token) {
    throw new Error("Figma access token is required. Add FIGMA_ACCESS_TOKEN or save a runtime Figma token in Setting.");
  }

  const response = await fetch(
    `https://api.figma.com/v1/files/${encodeURIComponent(parsed.fileKey)}/nodes?ids=${encodeURIComponent(parsed.nodeId)}`,
    {
      headers: {
        "x-figma-token": token
      }
    }
  );
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Figma API returned a non-JSON response. Check the Figma API status and token.");
  }

  if (!response.ok) {
    throw new Error(`Figma API failed: ${response.status} ${String(data.err || data.message || text).slice(0, 240)}`);
  }

  const document = data.nodes?.[parsed.nodeId]?.document;
  if (!document) {
    throw new Error("Selected Figma frame was not found. Check the link and token access.");
  }

  const frame = frameSnapshotFromFigmaNode(document, parsed.fileKey);
  if (frame.textNodes.filter((node) => node.characters.trim()).length === 0) {
    throw new Error("Selected Figma frame does not contain translatable text layers.");
  }
  return frame;
}

export function frameSnapshotFromFigmaNode(node: FigmaRestNode, fileKey?: string): FigmaFrameSnapshot {
  return {
    fileKey,
    nodeId: node.id,
    frameName: node.name || "Selected frame",
    textNodes: collectFigmaTextNodes(node),
    capturedAt: new Date().toISOString()
  };
}

function collectFigmaTextNodes(root: FigmaRestNode, path: string[] = []): FigmaTextNode[] {
  const nextPath = [...path, root.name || root.type || root.id];
  if (root.type === "TEXT") {
    return [
      {
        id: root.id,
        name: root.name || "Text",
        characters: root.characters || "",
        visible: root.visible !== false,
        locked: root.locked === true,
        absoluteBoundingBox: root.absoluteBoundingBox,
        parentPath: path
      }
    ];
  }

  return (root.children ?? []).flatMap((child) => collectFigmaTextNodes(child, nextPath));
}
