import { locales, type FigmaFrameSnapshot, type FigmaTextNode, type Locale, type Product, type TranslationJob } from "@eu-translation/shared";
import { buildPriceSyncPlanFromNodes } from "./price-sync";

const DEFAULT_WEB_APP_PORT = 3000;
const WEB_APP_PORT_STORAGE_KEY = "eu-layout-translator-web-app-port";
const DEFAULT_PROJECT_ID = "internal_library";
const PRICE_MATCH_THRESHOLD = 0.68;
const COMPACT_SKU_PRICE_MATCH_THRESHOLD = 0.54;
const PRICE_TOLERANCE = 0.01;

figma.showUI(__html__, { width: 380, height: 420, themeColors: true });
void sendSavedWebAppPort().catch((error) => {
  figma.ui.postMessage({ type: "error", message: formatPluginError(error) });
});

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === "save-web-app-port") {
      const port = readWebAppPort(message.port);
      await figma.clientStorage.setAsync(WEB_APP_PORT_STORAGE_KEY, port);
      figma.ui.postMessage({ type: "web-app-port-saved", port });
      return;
    }

    if (message.type === "generate-apply-selection") {
      const targetLocales = readTargetLocales(message.targetLocales);
      const translateToNewFrame = message.translateToNewFrame !== false;
      if (!translateToNewFrame && targetLocales.length !== 1) {
        throw new Error("Select one target language when translating in current frame.");
      }
      postProgress({ message: "Reading selected frame", percent: 8 });
      const selectedFrameNode = getSelectedFrameNode();
      const frame = captureFrameSnapshot(selectedFrameNode);
      const estimatedSeconds = estimateRuntimeSeconds(frame.textNodes.length, targetLocales.length, translateToNewFrame);
      postProgress({
        detail: `${frame.textNodes.length} text layers, ${targetLocales.length} target language${targetLocales.length === 1 ? "" : "s"}`,
        estimatedSeconds,
        message: "Reading selected frame",
        percent: 14
      });
      const port = readWebAppPort(message.port);
      await figma.clientStorage.setAsync(WEB_APP_PORT_STORAGE_KEY, port);
      const webAppUrl = webAppUrlForPort(port);
      postProgress({ estimatedSeconds, message: "Checking localhost Library", percent: 24 });
      postProgress({ estimatedSeconds, message: "Translating missing wording", percent: 34 });
      const { job, summary } = await createTranslationJob({
        frame,
        targetLocales,
        webAppUrl
      });
      postProgress({ estimatedSeconds, message: translateToNewFrame ? "Creating translated frames" : "Updating current frame", percent: 72 });
      const result = await applyTranslationJob(job, { translateToNewFrame });
      postProgress({ estimatedSeconds, message: "Finalizing translated frame", percent: 96 });
      figma.ui.postMessage({ type: "job-applied", result });
      if (summary) {
        const actionSummary = translateToNewFrame ? `Created ${result.createdFrames.length} frames` : "Updated current frame";
        postStatus(`${actionSummary}. ${summary.nodesWithLibraryMatches}/${summary.totalTextNodes} nodes used Library terms, ${summary.nodesTranslatedByAi} used AI, ${summary.warnings} warnings.`);
      }
      figma.notify(translateToNewFrame ? `Created ${result.createdFrames.length} localized frames` : "Updated current frame");
      return;
    }

    if (message.type === "sync-product-prices") {
      postProgress({ message: "Reading selected frame", percent: 8 });
      const selectedFrameNode = getSelectedFrameNode();
      const textNodeCount = collectTextNodes(selectedFrameNode).length;
      const estimatedSeconds = Math.max(6, Math.min(60, Math.ceil(textNodeCount * 0.12 + 6)));
      postProgress({ message: "Loading product price book", percent: 26, estimatedSeconds });
      const port = readWebAppPort(message.port);
      await figma.clientStorage.setAsync(WEB_APP_PORT_STORAGE_KEY, port);
      const webAppUrl = webAppUrlForPort(port);
      const products = await fetchProducts(webAppUrl, DEFAULT_PROJECT_ID);
      postProgress({ message: "Matching and preparing overwrite plan", percent: 56, estimatedSeconds });
      const priceSyncPlan = buildPriceSyncPlan(selectedFrameNode, products);
      figma.ui.postMessage({ type: "price-check-result", result: planToUiResult(priceSyncPlan) });
      const warnings = await applyPriceSyncToCurrentFrame(selectedFrameNode, priceSyncPlan.replacementsBySourceNodeId);
      postProgress({ message: "Finalizing price synchronization", percent: 96, estimatedSeconds });
      figma.ui.postMessage({
        type: "price-sync-applied",
        overwritten: priceSyncPlan.summary.overwritten,
        warnings
      });
      figma.notify(`Synchronized ${priceSyncPlan.summary.overwritten} price field(s)`);
      return;
    }
  } catch (error) {
    const messageText = formatPluginError(error);
    figma.ui.postMessage({ type: "error", message: messageText });
    figma.notify(messageText, { error: true });
  }
};

type PriceFieldKind = "discounted" | "rrp" | "off";

type PriceFieldDetection = {
  kind: PriceFieldKind;
  sourceNodeId: string;
  sourceText: string;
  value: number;
};

type PriceCluster = {
  fields: PriceFieldDetection[];
  nameNodeId: string;
  nameText: string;
  regularPriceNodeIds: string[];
};

type PriceSyncPlan = {
  items: string[];
  replacementsBySourceNodeId: Map<string, string>;
  summary: {
    matched: number;
    overwritten: number;
    review: number;
  };
};

type UiPriceSyncResult = {
  items: string[];
  summary: PriceSyncPlan["summary"];
};

type RawTextNode = {
  absoluteBoundingBox?: Rect;
  id: string;
  name: string;
  path: string[];
  text: string;
  textDecoration: TextDecoration | "mixed";
  visible: boolean;
};

async function sendSavedWebAppPort(): Promise<void> {
  const savedPort = await figma.clientStorage.getAsync(WEB_APP_PORT_STORAGE_KEY);
  const port = isValidWebAppPort(savedPort) ? savedPort : DEFAULT_WEB_APP_PORT;
  figma.ui.postMessage({ type: "web-app-port-loaded", port });
}

async function fetchProducts(webAppUrl: string, projectId: string): Promise<Product[]> {
  let response: Response;
  try {
    response = await fetch(`${webAppUrl}/api/products?projectId=${encodeURIComponent(projectId)}`, { method: "GET" });
  } catch {
    throw new Error(`Cannot load products from ${webAppUrl}.`);
  }
  const data = await readJsonResponse(response, webAppUrl);
  if (!response.ok) throw new Error(data.error || "Loading products failed");
  return Array.isArray(data.products) ? (data.products as Product[]) : [];
}

function planToUiResult(plan: PriceSyncPlan): UiPriceSyncResult {
  return { items: plan.items, summary: plan.summary };
}

function postStatus(message: string): void {
  figma.ui.postMessage({ type: "status", message });
}

function postProgress(input: { detail?: string; estimatedSeconds?: number; message: string; percent: number }): void {
  figma.ui.postMessage({
    type: "progress",
    detail: input.detail,
    estimatedSeconds: input.estimatedSeconds,
    message: input.message,
    percent: Math.max(0, Math.min(100, Math.round(input.percent)))
  });
}

function estimateRuntimeSeconds(textNodeCount: number, targetLocaleCount: number, translateToNewFrame: boolean): number {
  const translationUnits = Math.max(1, textNodeCount) * Math.max(1, targetLocaleCount);
  const apiSeconds = 8 + translationUnits * 0.22;
  const applySeconds = translateToNewFrame ? targetLocaleCount * 1.8 + textNodeCount * targetLocaleCount * 0.04 : 1.5 + textNodeCount * 0.04;
  return Math.ceil(Math.min(180, Math.max(12, apiSeconds + applySeconds)));
}

async function createTranslationJob(input: {
  frame: FigmaFrameSnapshot;
  targetLocales: Locale[];
  webAppUrl: string;
}): Promise<{ job: TranslationJob; summary?: TranslationSummary }> {
  postStatus(`Connecting to ${input.webAppUrl}`);
  let response: Response;
  try {
    response = await fetch(`${input.webAppUrl}/api/translation-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        frame: input.frame,
        targetLocales: input.targetLocales
      })
    });
  } catch {
    throw new Error(`Cannot complete request to ${input.webAppUrl}. The server may be stopped or blocked by CORS.`);
  }

  const data = await readJsonResponse(response, input.webAppUrl);
  if (!response.ok) throw new Error(data.error || "Figma translation failed");
  return { job: data.job as TranslationJob, summary: data.summary as TranslationSummary | undefined };
}

async function readJsonResponse(response: Response, webAppUrl: string): Promise<any> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("Translation API returned an empty response.");
  }

  if (trimmed.startsWith("<")) {
    throw new Error(`Translation API returned HTML instead of JSON. Check that the web app is running on ${webAppUrl}.`);
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Translation API returned invalid JSON. Check that the web app is running on ${webAppUrl}.`);
  }
}

function formatPluginError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    return JSON.stringify(error) || "Plugin action failed";
  } catch {
    return String(error) || "Plugin action failed";
  }
}

type TranslationSummary = {
  totalTextNodes: number;
  nodesWithLibraryMatches: number;
  nodesTranslatedByAi: number;
  warnings: number;
};

type TextNodeEntry = {
  node: TextNode;
  path: string[];
  signature: string;
};

function readWebAppPort(value: unknown): number {
  const port = Number(value || DEFAULT_WEB_APP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Enter a valid localhost port.");
  }
  return port;
}

function isValidWebAppPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function webAppUrlForPort(port: number): string {
  return `http://localhost:${port}`;
}

function readTargetLocales(value: unknown): Locale[] {
  const selected = Array.isArray(value)
    ? value.filter((locale): locale is Locale => (locales as readonly string[]).includes(String(locale)))
    : [...locales];
  if (selected.length === 0) throw new Error("Select at least one language.");
  return [...new Set(selected)];
}

function getSelectedFrameNode(): SceneNode & ChildrenMixin {
  if (figma.currentPage.selection.length === 0) {
    throw new Error("Select one frame first.");
  }
  if (figma.currentPage.selection.length > 1) {
    throw new Error("Select only one frame.");
  }

  const selected = figma.currentPage.selection[0];
  if (!selected || !("children" in selected)) {
    throw new Error("Select one frame, section, group, or component before capturing.");
  }
  return selected as SceneNode & ChildrenMixin;
}

function captureFrameSnapshot(selected: SceneNode): FigmaFrameSnapshot {
  return {
    nodeId: selected.id,
    frameName: selected.name,
    textNodes: collectTextNodes(selected),
    capturedAt: new Date().toISOString()
  };
}

function collectTextNodes(root: SceneNode, path: string[] = []): FigmaTextNode[] {
  if (!root.visible) return [];
  const nextPath = [...path, root.name];
  if (root.type === "TEXT") {
    return [
      {
        id: root.id,
        name: root.name,
        characters: root.characters,
        visible: root.visible,
        locked: root.locked,
        absoluteBoundingBox: root.absoluteBoundingBox
          ? {
              x: root.absoluteBoundingBox.x,
              y: root.absoluteBoundingBox.y,
              width: root.absoluteBoundingBox.width,
              height: root.absoluteBoundingBox.height
            }
          : undefined,
        fontName: normalizeFontName(root.fontName),
        parentPath: path
      }
    ];
  }

  if ("children" in root) {
    return root.children.flatMap((child) => collectTextNodes(child, nextPath));
  }

  return [];
}

async function applyTranslationJob(
  job: TranslationJob,
  options: { translateToNewFrame: boolean } = { translateToNewFrame: true }
): Promise<{ createdFrames: string[]; warnings: string[] }> {
  const source = figma.getNodeById(job.sourceFrame.nodeId);
  if (!isCloneableSceneContainer(source)) {
    throw new Error("Source frame is not available in this Figma file. Select the original file before applying.");
  }

  const createdFrames: string[] = [];
  const warnings = job.warnings.map((warning) => `${warning.locale ? `${warning.locale}: ` : ""}${warning.message}`);
  const sourceTextEntries = collectTextSceneNodeEntries(source);
  const translationsByNodeId = new Map(job.nodeTranslations.map((node) => [node.nodeId, node]));
  const localeSpacing = source.width ? source.width + 120 : 900;
  const targetLocales = job.targetLocales?.length ? job.targetLocales : locales;

  if (!options.translateToNewFrame) {
    if (targetLocales.length !== 1) {
      throw new Error("Select one target language when translating in current frame.");
    }
    const locale = targetLocales[0] as Locale;
    const translatedCount = await applyLocaleTranslations({
      locale,
      originalTextEntries: sourceTextEntries,
      targetTextEntries: sourceTextEntries,
      translationsByNodeId,
      warnings,
      missingLayerMessage: (entry) => `${locale}: missing current text layer for ${textNodeLabel(entry)}`
    });
    postProgress({
      detail: `${locale}: translated ${translatedCount}/${sourceTextEntries.length} text layers in current frame`,
      message: "Updating current frame",
      percent: 92
    });
    return { createdFrames, warnings };
  }

  for (const [index, locale] of targetLocales.entries()) {
    const startPercent = 72 + Math.round((index / targetLocales.length) * 20);
    postProgress({ message: `Creating ${locale} frame`, percent: startPercent });
    const clone = source.clone();
    clone.name = `${source.name} ${locale}`;
    clone.x = source.x + localeSpacing * (index + 1);
    clone.y = source.y;
    source.parent?.appendChild(clone);

    const cloneTextEntries = collectTextSceneNodeEntries(clone);
    const translatedCount = await applyLocaleTranslations({
      locale: locale as Locale,
      originalTextEntries: sourceTextEntries,
      targetTextEntries: cloneTextEntries,
      translationsByNodeId,
      warnings,
      missingLayerMessage: (entry) => `${locale}: missing cloned text layer for ${textNodeLabel(entry)}`
    });

    createdFrames.push(clone.name);
    postProgress({
      detail: `${locale}: translated ${translatedCount}/${sourceTextEntries.length} text layers`,
      message: `Applied ${locale} translation`,
      percent: 72 + Math.round(((index + 1) / targetLocales.length) * 20)
    });
  }

  return { createdFrames, warnings };
}

async function applyLocaleTranslations(input: {
  locale: Locale;
  originalTextEntries: TextNodeEntry[];
  targetTextEntries: TextNodeEntry[];
  translationsByNodeId: Map<string, TranslationJob["nodeTranslations"][number]>;
  warnings: string[];
  missingLayerMessage: (entry: TextNodeEntry) => string;
}): Promise<number> {
  const targetEntriesBySignature = new Map(input.targetTextEntries.map((entry) => [entry.signature, entry]));
  let translatedCount = 0;
  for (let nodeIndex = 0; nodeIndex < input.originalTextEntries.length; nodeIndex += 1) {
    const originalEntry = input.originalTextEntries[nodeIndex];
    const originalNode = originalEntry?.node;
    if (!originalEntry || !originalNode) continue;
    const targetEntry = targetEntriesBySignature.get(originalEntry.signature) ?? input.targetTextEntries[nodeIndex];
    const targetNode = targetEntry?.node;
    if (!targetNode) {
      input.warnings.push(input.missingLayerMessage(originalEntry));
      continue;
    }
    if (!targetNode.visible || targetNode.locked) {
      input.warnings.push(`${input.locale}: skipped locked or hidden text layer ${textNodeLabel(targetEntry)}`);
      continue;
    }

    const nodeTranslation = input.translationsByNodeId.get(originalNode.id);
    const translated = nodeTranslation?.translations[input.locale];
    if (!translated) {
      input.warnings.push(`${input.locale}: no translation for ${textNodeLabel(originalEntry)}`);
      continue;
    }

    const fontWarnings = await loadTextNodeFonts(targetNode);
    input.warnings.push(...fontWarnings.map((warning) => `${input.locale}: ${textNodeLabel(targetEntry)} ${warning}`));
    if (fontWarnings.length > 0) continue;
    targetNode.characters = translated;
    translatedCount += 1;
  }
  return translatedCount;
}

async function applyPriceSyncToTarget(input: {
  label: string;
  originalTextEntries: TextNodeEntry[];
  replacementsBySourceNodeId: Map<string, string>;
  targetTextEntries: TextNodeEntry[];
  warnings: string[];
}): Promise<void> {
  const targetEntriesBySignature = new Map(input.targetTextEntries.map((entry) => [entry.signature, entry]));
  for (let nodeIndex = 0; nodeIndex < input.originalTextEntries.length; nodeIndex += 1) {
    const originalEntry = input.originalTextEntries[nodeIndex];
    if (!originalEntry) continue;
    const replacement = input.replacementsBySourceNodeId.get(originalEntry.node.id);
    if (!replacement) continue;
    const targetEntry = targetEntriesBySignature.get(originalEntry.signature) ?? input.targetTextEntries[nodeIndex];
    const targetNode = targetEntry?.node;
    if (!targetNode || !targetNode.visible || targetNode.locked) continue;
    const fontWarnings = await loadTextNodeFonts(targetNode);
    if (fontWarnings.length > 0) {
      input.warnings.push(...fontWarnings.map((warning) => `${input.label}: ${textNodeLabel(targetEntry)} ${warning}`));
      continue;
    }
    targetNode.characters = replacement;
  }
}

async function applyPriceSyncToCurrentFrame(source: SceneNode, replacementsBySourceNodeId: Map<string, string>): Promise<string[]> {
  const entries = collectTextSceneNodeEntries(source);
  const warnings: string[] = [];
  await applyPriceSyncToTarget({
    label: "Price Sync",
    originalTextEntries: entries,
    replacementsBySourceNodeId,
    targetTextEntries: entries,
    warnings
  });
  return warnings;
}

function collectTextSceneNodeEntries(root: SceneNode): TextNodeEntry[] {
  const textNodes = collectTextSceneNodes(root);
  const seen = new Map<string, number>();
  return textNodes.map(({ node, path }) => {
    const baseSignature = `${path.join("/")}\u0000${node.name}\u0000${node.characters}`;
    const occurrence = seen.get(baseSignature) ?? 0;
    seen.set(baseSignature, occurrence + 1);
    return {
      node,
      path,
      signature: `${baseSignature}\u0000${occurrence}`
    };
  });
}

function collectTextSceneNodes(root: SceneNode, path: string[] = [], isRoot = true): Array<{ node: TextNode; path: string[] }> {
  if (!root.visible) return [];
  const nextPath = isRoot ? path : [...path, root.name];
  if (root.type === "TEXT") return [{ node: root, path }];
  if ("children" in root) return root.children.flatMap((child) => collectTextSceneNodes(child, nextPath, false));
  return [];
}

function textNodeLabel(entry?: TextNodeEntry): string {
  return entry?.node.name ?? "unknown text layer";
}

function isCloneableSceneContainer(node: BaseNode | null): node is SceneNode & ChildrenMixin & LayoutMixin & { clone(): SceneNode & ChildrenMixin & LayoutMixin } {
  return Boolean(
    node &&
      node.type !== "PAGE" &&
      "clone" in node &&
      "children" in node &&
      "x" in node &&
      "y" in node &&
      "width" in node
  );
}

async function loadTextNodeFonts(node: TextNode): Promise<string[]> {
  const warnings: string[] = [];
  const fonts = new Map<string, FontName>();

  if (node.fontName !== figma.mixed) {
    fonts.set(fontKey(node.fontName), node.fontName);
  } else {
    for (let index = 0; index < node.characters.length; index += 1) {
      const fontName = node.getRangeFontName(index, index + 1);
      if (fontName !== figma.mixed) fonts.set(fontKey(fontName), fontName);
    }
  }

  for (const fontName of fonts.values()) {
    try {
      await figma.loadFontAsync(fontName);
    } catch {
      warnings.push(`missing font ${fontName.family} ${fontName.style}`);
    }
  }

  return warnings;
}

function normalizeFontName(fontName: PluginAPI["mixed"] | FontName): FigmaTextNode["fontName"] {
  if (fontName === figma.mixed) return "mixed";
  return { family: fontName.family, style: fontName.style };
}

function fontKey(fontName: FontName): string {
  return `${fontName.family}\u0000${fontName.style}`;
}

function buildPriceSyncPlan(source: SceneNode, products: Product[]): PriceSyncPlan {
  const entries = collectTextSceneNodeEntries(source);
  const nodes = entries
    .map<RawTextNode>((entry) => ({
      id: entry.node.id,
      name: entry.node.name,
      path: entry.path,
      text: entry.node.characters,
      visible: entry.node.visible,
      absoluteBoundingBox: entry.node.absoluteBoundingBox ?? undefined,
      textDecoration: entry.node.textDecoration === figma.mixed ? "mixed" : entry.node.textDecoration
    }))
    .filter((node) => node.visible);

  return buildPriceSyncPlanFromNodes(nodes, products);
}

function detectPriceClusters(nodes: RawTextNode[]): PriceCluster[] {
  const offLabelNodes = nodes.filter((node) => /\bOFF\b/i.test(node.text));
  const candidatePriceNodes = nodes
    .map((node) => {
      const parsed = parsePriceText(node.text);
      if (!parsed) return null;
      const offNearby = offLabelNodes.some((offNode) => spatialDistance(node, offNode) <= 90);
      return { node, offNearby, parsed };
    })
    .filter((row): row is { node: RawTextNode; offNearby: boolean; parsed: ParsedPrice } => Boolean(row));

  const regularPriceCandidates = candidatePriceNodes.filter((row) => !row.offNearby);
  const offCandidates = candidatePriceNodes.filter((row) => row.offNearby);
  const nameNodes = nodes.filter((node) => looksLikeProductName(node.text));
  const clusters: PriceCluster[] = [];
  const usedRegularNodeIds = new Set<string>();
  const nameNodeById = new Map(nameNodes.map((node) => [node.id, node]));

  for (const nameNode of nameNodes) {
    const attached = regularPriceCandidates
      .filter((row) => !usedRegularNodeIds.has(row.node.id))
      .filter((row) => isLikelySameCard(nameNode, row.node))
      .sort((a, b) => spatialDistance(nameNode, a.node) - spatialDistance(nameNode, b.node));
    if (attached.length === 0) continue;

    const peerValues = attached.map((row) => row.parsed.value);
    const detections = attached.map((row): PriceFieldDetection => ({
      kind: classifyPriceKind(row.node, row.parsed, row.offNearby, peerValues),
      sourceNodeId: row.node.id,
      sourceText: row.node.text,
      value: row.parsed.value
    }));

    for (const row of attached) usedRegularNodeIds.add(row.node.id);
    clusters.push({
      fields: dedupeAndFinalizeFields(detections),
      nameNodeId: nameNode.id,
      nameText: normalizeWhitespace(nameNode.text),
      regularPriceNodeIds: attached.map((row) => row.node.id)
    });
  }

  // OFF badges are sometimes placed in separate child layers/subframes.
  // Attach each OFF value to the nearest detected product cluster by card-level geometry.
  for (const offRow of offCandidates) {
    if (clusters.length === 0) break;
    let bestCluster: PriceCluster | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cluster of clusters) {
      const clusterNameNode = nameNodeById.get(cluster.nameNodeId);
      if (!clusterNameNode) continue;
      const priceNodesForCluster = cluster.regularPriceNodeIds
        .map((id) => regularPriceCandidates.find((candidate) => candidate.node.id === id)?.node)
        .filter((node): node is RawTextNode => Boolean(node));
      const d = distanceToClusterGeometry(offRow.node, [clusterNameNode, ...priceNodesForCluster]);
      if (d < bestDistance) {
        bestDistance = d;
        bestCluster = cluster;
      }
    }
    // Keep a safety radius so unrelated OFF badges are ignored.
    if (!bestCluster || bestDistance > 1200) continue;
    bestCluster.fields.push({
      kind: "off",
      sourceNodeId: offRow.node.id,
      sourceText: offRow.node.text,
      value: offRow.parsed.value
    });
    bestCluster.fields = dedupeAndFinalizeFields(bestCluster.fields);
  }

  return clusters;
}

function distanceToClusterGeometry(node: RawTextNode, clusterNodes: RawTextNode[]): number {
  const nodeCenter = centerOf(node.absoluteBoundingBox);
  if (!nodeCenter || clusterNodes.length === 0) return Number.POSITIVE_INFINITY;
  const boxes = clusterNodes.map((clusterNode) => clusterNode.absoluteBoundingBox).filter((box): box is Rect => Boolean(box));
  if (boxes.length === 0) return Number.POSITIVE_INFINITY;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  const clampedX = Math.max(minX, Math.min(nodeCenter.x, maxX));
  const clampedY = Math.max(minY, Math.min(nodeCenter.y, maxY));
  const dx = nodeCenter.x - clampedX;
  const dy = nodeCenter.y - clampedY;
  return Math.sqrt(dx * dx + dy * dy);
}

function dedupeAndFinalizeFields(fields: PriceFieldDetection[]): PriceFieldDetection[] {
  const byKind = new Map<PriceFieldKind, PriceFieldDetection>();
  for (const field of fields) {
    const existing = byKind.get(field.kind);
    if (!existing) {
      byKind.set(field.kind, field);
      continue;
    }
    if (field.kind === "discounted" && field.value < existing.value) byKind.set(field.kind, field);
    if ((field.kind === "rrp" || field.kind === "off") && field.value > existing.value) byKind.set(field.kind, field);
  }
  return [...byKind.values()];
}

type ParsedPrice = {
  hasCurrency: boolean;
  value: number;
};

function parsePriceText(text: string): ParsedPrice | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (!isPriceLikeText(raw)) return null;
  const token = raw.match(/[-+]?\d[\d.,]*/)?.[0];
  if (!token) return null;
  const value = parsePriceToken(token);
  if (!Number.isFinite(value)) return null;
  return { hasCurrency: /[€$£¥]/.test(raw), value };
}

function isPriceLikeText(raw: string): boolean {
  // Ignore wording lines entirely; price sync should only act on number-like text.
  if (/[A-Za-z]/.test(raw)) return false;

  const compact = raw.replace(/\s+/g, "");
  // Allow currency + number formats like:
  // €1099,00 | 1099,00 | 1,099.00 | 450
  const hasCurrency = /[€$£¥]/.test(compact);
  const hasDecimal = /[.,]\d{1,2}$/.test(compact);
  const digitCount = (compact.match(/\d/g) ?? []).length;

  // Accept if it looks explicitly like a price:
  // - has currency symbol, or
  // - has decimal cents, or
  // - has at least 3 digits (e.g. 450, 1099)
  if (hasCurrency) return true;
  if (hasDecimal) return true;
  return digitCount >= 3;
}

function parsePriceToken(token: string): number {
  const cleaned = token.trim();
  if (!cleaned) return NaN;
  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  const sepIndex = Math.max(lastDot, lastComma);
  if (sepIndex >= 0) {
    const decimals = cleaned.slice(sepIndex + 1);
    if (/^\d{1,2}$/.test(decimals)) {
      const intPart = cleaned.slice(0, sepIndex).replace(/[.,]/g, "");
      const withDot = `${intPart}.${decimals}`;
      const parsed = Number(withDot);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  const parsed = Number(cleaned.replace(/[.,]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function classifyPriceKind(node: RawTextNode, parsed: ParsedPrice, offNearby: boolean, peerValues: number[]): PriceFieldKind {
  if (offNearby || /\bOFF\b/i.test(node.text)) return "off";
  if (node.textDecoration === "STRIKETHROUGH") return "rrp";
  const min = Math.min(...peerValues);
  const max = Math.max(...peerValues);
  if (peerValues.length >= 2 && parsed.value === max && max !== min) return "rrp";
  return "discounted";
}

function looksLikeProductName(text: string): boolean {
  const value = normalizeWhitespace(text);
  if (!value) return false;
  if (/\bOFF\b/i.test(value)) return false;
  if (/[€$£¥]/.test(value)) return false;
  if (/^[-+\s\d.,]+$/.test(value)) return false;
  if (/[:()（）]/.test(value)) return false;
  if (value.length > 48) return false;
  if (value.split(/\s+/).length > 6) return false;
  if (isIgnorableColorLabel(value)) return false;
  if (isPromoOrCtaLabel(value)) return false;
  if (isSpecOrFeatureLabel(value)) return false;
  if (isAccessoryLikeName(value)) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/[.!?]/.test(value)) return false;
  if (!hasModelLikeToken(value)) return false;
  return value.length >= 4;
}

function isIgnorableColorLabel(value: string): boolean {
  const normalized = normalizeNameForMatch(value).trim();
  if (!normalized) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 2) return false;
  const colorTokens = new Set([
    "white",
    "black",
    "silver",
    "gray",
    "grey",
    "red",
    "blue",
    "green",
    "pink",
    "gold",
    "rose",
    "purple",
    "orange",
    "brown",
    "beige"
  ]);
  return tokens.every((token) => colorTokens.has(token));
}

function shouldReviewUnmatchedName(value: string): boolean {
  const text = normalizeWhitespace(value);
  if (!text) return false;
  // Skip promo / sentence-like copy; price sync should focus on product-like labels only.
  if (/[:()（）]/.test(text)) return false;
  if (text.length > 48) return false;
  if (text.split(/\s+/).length > 6) return false;
  if (/[.!?]/.test(text)) return false;
  if (isPromoOrCtaLabel(text)) return false;
  if (isSpecOrFeatureLabel(text)) return false;
  if (isAccessoryLikeName(text)) return false;
  if (!hasModelLikeToken(text)) return false;
  return true;
}

function isPromoOrCtaLabel(value: string): boolean {
  const normalized = normalizeNameForMatch(value);
  return /\b(gutscheincode|kopieren|rabatt|code|coupon|voucher|kaufen|buy|shop|cart)\b/.test(normalized);
}

function isSpecOrFeatureLabel(value: string): boolean {
  const normalized = normalizeNameForMatch(value);
  return /\b(pa|suction|power|mop|brush|technology|extendable|dual|anti|tangle|description|show|more)\b/.test(normalized);
}

function isAccessoryLikeName(value: string): boolean {
  const normalized = normalizeNameForMatch(value)
    .replace(/[()（）]/g, " ")
    .replace(/[_/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  const accessoryPatterns = [
    /\baccessor(?:y|ies)\b/,
    /\bkit\b/,
    /\bhepa\b/,
    /\bfilter\b/,
    /\bbrush\b/,
    /\bside-brush\b/,
    /\bsidebrush\b/,
    /\bzubehor(?:set|satz)?\b/,
    /\bersatzteile?\b/,
    /\bseitenburste\b/,
    /\bseitenb[ui]rste\b/,
    /\bhauptrollenburste\b/,
    /\bhauptburste\b/,
    /\brollerburste\b/,
    /\brollenburste\b/,
    /\bburste\b/,
    /\bschwamm\b/,
    /\bwisch(?:tucher|tiicher)\b/,
    /\bwischmopp\b/,
    /\bmopp\b/,
    /\bluftkanal(?:e)?\b/,
    /\breinigungslosung\b/,
    /\bbodenreinigungslosung\b/,
    /\bcleaning-solution\b/,
    /\broller\b/,
    /\bmain-brush\b/,
    /\bmop-pad\b/,
    /\bpad\b/,
    /\bstaub(?:sauger)?beutel\b/,
    /\bbeutel\b/,
    /\bdust-bag\b/,
    /\bbag\b/
  ];
  return accessoryPatterns.some((pattern) => pattern.test(normalized));
}

function hasModelLikeToken(value: string): boolean {
  const tokens = nameTokens(value);
  return tokens.some((token) => /\d/.test(token));
}

function isLikelySameCard(nameNode: RawTextNode, priceNode: RawTextNode): boolean {
  const sharedPath = commonPrefixLength(nameNode.path, priceNode.path);
  if (sharedPath >= 2) return true;
  return spatialDistance(nameNode, priceNode) <= 420;
}

function commonPrefixLength(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let count = 0;
  for (let i = 0; i < max; i += 1) {
    if (a[i] !== b[i]) break;
    count += 1;
  }
  return count;
}

function spatialDistance(a: RawTextNode, b: RawTextNode): number {
  const centerA = centerOf(a.absoluteBoundingBox);
  const centerB = centerOf(b.absoluteBoundingBox);
  if (!centerA || !centerB) return Number.POSITIVE_INFINITY;
  const dx = centerA.x - centerB.x;
  const dy = centerA.y - centerB.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function centerOf(box?: Rect): { x: number; y: number } | null {
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function normalizeWhitespace(value: string): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeNameForMatch(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

function nameTokens(value: string): string[] {
  const stopwords = new Set([
    "eureka",
    "robot",
    "roboterstaubsauger",
    "saugroboter",
    "staubsauger",
    "vacuum",
    "series",
    "the",
    "and",
    "with",
    // Color codes / color words should not split otherwise identical products.
    "bk",
    "wh",
    "black",
    "white"
  ]);
  const normalized = normalizeNameForMatch(value);
  const baseTokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  const expanded = new Set<string>();
  for (const token of baseTokens) {
    expanded.add(stripColorCodeSuffix(token));
    const parts = token.match(/[a-z]+|\d+/g) ?? [];
    for (const part of parts) expanded.add(part);
    if (parts.length > 1) expanded.add(parts.join(""));
  }

  // Bridge split-vs-combined model identifiers:
  // floorshine 880 <-> floorshine880
  for (let i = 0; i < baseTokens.length - 1; i += 1) {
    const current = baseTokens[i] ?? "";
    const next = baseTokens[i + 1] ?? "";
    if (!current || !next) continue;
    const merged = `${current}${next}`;
    if (/[a-z]/.test(merged) && /\d/.test(merged)) expanded.add(merged);
  }

  const compact = normalized.replace(/\s+/g, "");
  const compactWithoutColor = stripColorCodeSuffix(compact);
  if (/[a-z]/.test(compactWithoutColor) && /\d/.test(compactWithoutColor)) expanded.add(compactWithoutColor);

  return [...expanded]
    .filter((token) => token.length > 1)
    .filter((token) => !stopwords.has(token));
}

function stripColorCodeSuffix(token: string): string {
  return token.replace(/(?:bk|wh)$/i, "");
}

function matchProduct(nameText: string, products: Product[]): { product: Product; score: number } | null {
  const query = normalizeNameForMatch(nameText);
  const queryTokens = nameTokens(nameText);
  if (!query || queryTokens.length === 0) return null;

  let best: { compactSkuMatch: boolean; product: Product; score: number } | null = null;
  for (const product of products) {
    if (isAccessoryLikeName(product.productName)) continue;
    const candidate = normalizeNameForMatch(product.productName);
    const candidateTokens = nameTokens(product.productName);
    if (!candidate || candidateTokens.length === 0) continue;

    const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
    const subsetRatio = overlap / queryTokens.length;
    const sharedModelTokens = queryTokens.filter((token) => /\d/.test(token) && candidateTokens.includes(token));
    const hasModelToken = sharedModelTokens.length > 0;
    const hasStrongModelToken = sharedModelTokens.some((token) => token.length >= 6);

    // Default safe gate: strong token overlap + shared model token.
    // Alternative gate for aliases: allow lower overlap if there is a strong shared model token
    // like "floorshine880" (e.g. AT6 Ultra(FloorShine880) => Eureka FloorShine880).
    // Compact SKU gate: allow J12 Ultra -> J12-BK/J12-WH after color-token removal.
    const passesDefaultGate = subsetRatio >= 0.75 && hasModelToken;
    const passesAliasGate = subsetRatio >= 0.3 && hasStrongModelToken;
    const passesCompactSkuGate =
      hasModelToken &&
      candidateTokens.length <= 3 &&
      candidateTokens.every((token) => queryTokens.includes(token));
    if (!passesDefaultGate && !passesAliasGate && !passesCompactSkuGate) continue;

    const jaccard = overlap / new Set([...queryTokens, ...candidateTokens]).size;
    const substringBoost = candidate.includes(query) || query.includes(candidate) ? 0.2 : 0;
    const modelBoost = hasStrongModelToken ? 0.22 : hasModelToken ? 0.12 : 0;
    const compactSkuBoost = passesCompactSkuGate ? 0.18 : 0;
    const score = jaccard + substringBoost + subsetRatio * 0.25 + modelBoost + compactSkuBoost;
    if (!best || score > best.score) best = { compactSkuMatch: passesCompactSkuGate, product, score };
  }
  const threshold = best?.compactSkuMatch ? COMPACT_SKU_PRICE_MATCH_THRESHOLD : PRICE_MATCH_THRESHOLD;
  if (!best || best.score < threshold) return null;
  return best;
}

function formatPriceLike(sourceText: string, value: number): string {
  const raw = String(sourceText ?? "");
  const hasCurrency = /[€$£¥]/.test(raw);
  const trimmed = raw.trim();
  const decimalPart = trimmed.match(/[.,](\d{1,2})\b/);
  const decimals = decimalPart ? decimalPart[1].length : 0;
  const decimalSeparator = decimalPart ? (trimmed.includes(",") ? "," : ".") : "";
  const formattedCore = formatNumber(value, decimals, decimalSeparator);
  const symbol = hasCurrency ? extractCurrencySymbol(raw) : "";
  return `${symbol}${formattedCore}`;
}

function extractCurrencySymbol(value: string): string {
  const match = value.match(/[€$£¥]/);
  return match ? match[0] : "";
}

function formatNumber(value: number, decimals: number, decimalSeparator: "," | "." | ""): string {
  if (!decimalSeparator || decimals <= 0) return String(Math.round(value));
  const fixed = value.toFixed(decimals);
  return decimalSeparator === "." ? fixed : fixed.replace(".", ",");
}
