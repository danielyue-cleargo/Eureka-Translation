import type { Product } from "@eu-translation/shared";

const PRICE_MATCH_THRESHOLD = 0.68;
const COMPACT_SKU_PRICE_MATCH_THRESHOLD = 0.54;
const PRICE_TOLERANCE = 0.01;

export type RawTextNode = {
  absoluteBoundingBox?: RectLike;
  id: string;
  name: string;
  path: string[];
  text: string;
  textDecoration: string;
  visible: boolean;
};

export type PriceFieldKind = "discounted" | "rrp" | "off";

export type PriceFieldDetection = {
  kind: PriceFieldKind;
  sourceNodeId: string;
  sourceText: string;
  value: number;
};

export type PriceCluster = {
  fields: PriceFieldDetection[];
  nameNodeId: string;
  nameText: string;
  regularPriceNodeIds: string[];
};

export type PriceSyncPlan = {
  items: string[];
  replacementsBySourceNodeId: Map<string, string>;
  summary: {
    matched: number;
    overwritten: number;
    review: number;
  };
};

type RectLike = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type ParsedPrice = {
  hasCurrency: boolean;
  value: number;
};

export function buildPriceSyncPlanFromNodes(nodes: RawTextNode[], products: Product[]): PriceSyncPlan {
  const clusters = detectPriceClusters(nodes.filter((node) => node.visible));
  const replacementsBySourceNodeId = new Map<string, string>();
  const items: string[] = [];
  let matched = 0;
  let overwritten = 0;
  let review = 0;

  for (const cluster of clusters) {
    const match = matchProduct(cluster.nameText, products);
    if (!match) {
      if (isIgnorableColorLabel(cluster.nameText)) continue;
      if (!shouldReviewUnmatchedName(cluster.nameText)) continue;
      review += 1;
      items.push(`Review: "${cluster.nameText}" no safe product match`);
      continue;
    }
    matched += 1;
    const expectedValues: Record<PriceFieldKind, number> = {
      discounted: match.product.discountedPrice,
      rrp: match.product.rrp,
      off: Number((match.product.rrp - match.product.discountedPrice).toFixed(2))
    };

    const changes: string[] = [];
    for (const field of cluster.fields) {
      const expected = expectedValues[field.kind];
      if (Math.abs(field.value - expected) <= PRICE_TOLERANCE) continue;
      const nextText = formatPriceLike(field.sourceText, expected);
      if (!nextText || nextText === field.sourceText) continue;
      replacementsBySourceNodeId.set(field.sourceNodeId, nextText);
      overwritten += 1;
      changes.push(`${field.kind}: ${field.sourceText} -> ${nextText}`);
    }

    if (changes.length) {
      items.push(`Overwrite: "${cluster.nameText}" => ${match.product.productName} (${changes.join(", ")})`);
    } else {
      items.push(`OK: "${cluster.nameText}" => ${match.product.productName}`);
    }
  }

  if (clusters.length === 0) {
    items.push("No product price clusters detected.");
  }

  return { items, replacementsBySourceNodeId, summary: { matched, overwritten, review } };
}

export function detectPriceClusters(nodes: RawTextNode[]): PriceCluster[] {
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
  const rowsByNameNodeId = new Map<string, { node: RawTextNode; offNearby: boolean; parsed: ParsedPrice }[]>();

  for (const row of regularPriceCandidates) {
    const nearestName = nearestSameCardName(row.node, nameNodes) ?? singleNameFallback(row.node, nameNodes);
    if (!nearestName) continue;
    const rows = rowsByNameNodeId.get(nearestName.id) ?? [];
    rows.push(row);
    rowsByNameNodeId.set(nearestName.id, rows);
  }

  const clusters: PriceCluster[] = [];
  const nameNodeById = new Map(nameNodes.map((node) => [node.id, node]));
  for (const nameNode of nameNodes) {
    const attached = rowsByNameNodeId.get(nameNode.id) ?? [];
    if (attached.length === 0) continue;

    const peerValues = attached.map((row) => row.parsed.value);
    const detections = attached.map((row): PriceFieldDetection => ({
      kind: classifyPriceKind(row.node, row.parsed, row.offNearby, peerValues),
      sourceNodeId: row.node.id,
      sourceText: row.node.text,
      value: row.parsed.value
    }));

    clusters.push({
      fields: dedupeAndFinalizeFields(detections),
      nameNodeId: nameNode.id,
      nameText: normalizeWhitespace(nameNode.text),
      regularPriceNodeIds: attached.map((row) => row.node.id)
    });
  }

  for (const offRow of offCandidates) {
    if (clusters.length === 0) break;
    const bestCluster = nearestOffBadgeCluster(offRow.node, clusters, nameNodeById, regularPriceCandidates);
    if (!bestCluster) continue;
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

function nearestOffBadgeCluster(
  offNode: RawTextNode,
  clusters: PriceCluster[],
  nameNodeById: Map<string, RawTextNode>,
  regularPriceCandidates: Array<{ node: RawTextNode; offNearby: boolean; parsed: ParsedPrice }>
): PriceCluster | null {
  const offCenter = centerOf(offNode.absoluteBoundingBox);
  if (!offCenter) return null;

  let best: { cluster: PriceCluster; score: number } | null = null;
  for (const cluster of clusters) {
    const clusterNameNode = nameNodeById.get(cluster.nameNodeId);
    if (!clusterNameNode) continue;
    const nameCenter = centerOf(clusterNameNode.absoluteBoundingBox);
    if (!nameCenter) continue;

    const priceNodesForCluster = cluster.regularPriceNodeIds
      .map((id) => regularPriceCandidates.find((candidate) => candidate.node.id === id)?.node)
      .filter((node): node is RawTextNode => Boolean(node));
    const cardBounds = boundsForNodes([clusterNameNode, ...priceNodesForCluster]);
    if (!cardBounds) continue;

    const horizontalDistance = distanceToHorizontalRange(offCenter.x, cardBounds);
    const verticalToName = nameCenter.y - offCenter.y;
    if (horizontalDistance > 220) continue;
    if (verticalToName < -80 || verticalToName > 420) continue;

    // OFF badges sit above the product title; score primarily by column alignment,
    // then by the nearest title below the badge to avoid stealing from the row above.
    const score = horizontalDistance * 3 + Math.abs(verticalToName - 190);
    if (!best || score < best.score) best = { cluster, score };
  }

  if (best) return best.cluster;

  let fallback: { cluster: PriceCluster; distance: number } | null = null;
  for (const cluster of clusters) {
    const clusterNameNode = nameNodeById.get(cluster.nameNodeId);
    if (!clusterNameNode) continue;
    const priceNodesForCluster = cluster.regularPriceNodeIds
      .map((id) => regularPriceCandidates.find((candidate) => candidate.node.id === id)?.node)
      .filter((node): node is RawTextNode => Boolean(node));
    const distance = distanceToClusterGeometry(offNode, [clusterNameNode, ...priceNodesForCluster]);
    if (distance > 1200) continue;
    if (!fallback || distance < fallback.distance) fallback = { cluster, distance };
  }
  return fallback?.cluster ?? null;
}

function boundsForNodes(nodes: RawTextNode[]): RectLike | null {
  const boxes = nodes.map((node) => node.absoluteBoundingBox).filter((box): box is RectLike => Boolean(box));
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { height: maxY - minY, width: maxX - minX, x: minX, y: minY };
}

function distanceToHorizontalRange(x: number, bounds: RectLike): number {
  if (x < bounds.x) return bounds.x - x;
  const maxX = bounds.x + bounds.width;
  if (x > maxX) return x - maxX;
  return 0;
}

function nearestSameCardName(priceNode: RawTextNode, nameNodes: RawTextNode[]): RawTextNode | null {
  let best: { distance: number; nameNode: RawTextNode } | null = null;
  for (const nameNode of nameNodes) {
    if (!isLikelySameCard(nameNode, priceNode)) continue;
    const distance = spatialDistance(nameNode, priceNode);
    if (!Number.isFinite(distance)) continue;
    if (!best || distance < best.distance) best = { distance, nameNode };
  }
  return best?.nameNode ?? null;
}

function singleNameFallback(priceNode: RawTextNode, nameNodes: RawTextNode[]): RawTextNode | null {
  if (nameNodes.length !== 1) return null;
  const nameNode = nameNodes[0];
  if (!nameNode) return null;
  const distance = spatialDistance(nameNode, priceNode);
  if (Number.isFinite(distance)) return distance <= 900 ? nameNode : null;
  return sharedPathPrefixLength(nameNode.path, priceNode.path) >= 1 ? nameNode : null;
}

function distanceToClusterGeometry(node: RawTextNode, clusterNodes: RawTextNode[]): number {
  const nodeCenter = centerOf(node.absoluteBoundingBox);
  if (!nodeCenter || clusterNodes.length === 0) return Number.POSITIVE_INFINITY;
  const boxes = clusterNodes.map((clusterNode) => clusterNode.absoluteBoundingBox).filter((box): box is RectLike => Boolean(box));
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
  if (/[A-Za-z]/.test(raw)) return false;
  const compact = raw.replace(/\s+/g, "");
  const hasCurrency = /[€$£¥]/.test(compact);
  const hasDecimal = /[.,]\d{1,2}$/.test(compact);
  const digitCount = (compact.match(/\d/g) ?? []).length;
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
  const nameCenter = centerOf(nameNode.absoluteBoundingBox);
  const priceCenter = centerOf(priceNode.absoluteBoundingBox);
  if (!nameCenter || !priceCenter) return false;
  const verticalOffset = priceCenter.y - nameCenter.y;
  if (verticalOffset < -40 || verticalOffset > 260) return false;
  return spatialDistance(nameNode, priceNode) <= 460;
}

function sharedPathPrefixLength(a: string[], b: string[]): number {
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

function centerOf(box?: RectLike): { x: number; y: number } | null {
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
    if (parts.length > 1) expanded.add(stripColorCodeSuffix(parts.join("")));
  }

  for (let i = 0; i < baseTokens.length - 1; i += 1) {
    const current = baseTokens[i] ?? "";
    const next = baseTokens[i + 1] ?? "";
    if (!current || !next) continue;
    const merged = stripColorCodeSuffix(`${current}${next}`);
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
  return token.replace(/(?:bk|wh|black|white)$/i, "");
}

export function matchProduct(nameText: string, products: Product[]): { product: Product; score: number } | null {
  const query = normalizeNameForMatch(nameText);
  const queryTokens = nameTokens(nameText);
  if (!query || queryTokens.length === 0) return null;
  const querySeriesSignature = jSeriesModelSignature(nameText);

  let best: { compactSkuMatch: boolean; product: Product; score: number } | null = null;
  for (const product of products) {
    if (isAccessoryLikeName(product.productName)) continue;
    const candidate = normalizeNameForMatch(product.productName);
    const candidateTokens = nameTokens(product.productName);
    if (!candidate || candidateTokens.length === 0) continue;
    const candidateSeriesSignature = jSeriesModelSignature(product.productName);
    if (querySeriesSignature && candidateSeriesSignature && querySeriesSignature !== candidateSeriesSignature) continue;

    const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
    const subsetRatio = overlap / queryTokens.length;
    const sharedModelTokens = queryTokens.filter((token) => /\d/.test(token) && candidateTokens.includes(token));
    const hasModelToken = sharedModelTokens.length > 0;
    const hasStrongModelToken = sharedModelTokens.some((token) => token.length >= 6);

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
    const seriesBoost = querySeriesSignature && candidateSeriesSignature === querySeriesSignature ? 0.25 : 0;
    const score = jaccard + substringBoost + subsetRatio * 0.25 + modelBoost + compactSkuBoost + seriesBoost;
    if (!best || score > best.score) best = { compactSkuMatch: passesCompactSkuGate, product, score };
  }
  const threshold = best?.compactSkuMatch ? COMPACT_SKU_PRICE_MATCH_THRESHOLD : PRICE_MATCH_THRESHOLD;
  if (!best || best.score < threshold) return null;
  return best;
}

function jSeriesModelSignature(value: string): string | null {
  const normalized = normalizeNameForMatch(value);
  const match = normalized.match(/\bj\s*(\d+)\s+(?:(max|pro|evo)\s+)?ultra\b/);
  if (!match) return null;
  return [`j${match[1]}`, match[2], "ultra"].filter(Boolean).join("-");
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
