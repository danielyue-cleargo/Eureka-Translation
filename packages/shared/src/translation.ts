import { locales, type Locale, type Term, type TranslationWarning } from "./schemas";

const SPEC_PATTERN = /\b\d+(?:[.,]\d+)?\s?(?:mm|cm|m|in|inch|inches|kg|g|ml|l|w|v|hz|pa|mah|gb|tb|%|°c|k|db(?:\(a\))?|minutes?|mins?|s|sec|seconds?)\b/gi;
const PRODUCT_ENTITY_MATCH_THRESHOLD = 0.54;

export function extractSpecs(text: string): string[] {
  return [...text.matchAll(SPEC_PATTERN)].map((match) => normalizeSpec(match[0]));
}

export function normalizeSpec(spec: string): string {
  return spec.toLowerCase().replace(/\s+/g, "").replace(",", ".");
}

export function findApprovedTermMatches(text: string, terms: Term[]): Term[] {
  const haystack = text.toLocaleLowerCase();
  const sourceIsAccessory = isAccessoryLikeName(text);
  if (looksLikeProductEntity(text) && !sourceIsAccessory) {
    const productMatches = terms
      .filter((term) => term.status === "approved" && term.type === "product_name")
      .map((term) => ({ score: productEntityMatchScore(text, term), term }))
      .filter((match) => match.score >= PRODUCT_ENTITY_MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    return productMatches.slice(0, 1).map((match) => match.term);
  }

  return terms.filter((term) => {
    if (term.status !== "approved") return false;
    if (sourceIsAccessory && term.type === "product_name") return false;
    if (!sourceIsAccessory && term.type === "accessory" && looksLikeProductEntity(text)) return false;
    return glossarySourceValues(term).some((value) => haystack.includes(value.toLocaleLowerCase()));
  });
}

export function splitFigmaTranslationTerms(terms: Term[]): { glossaryTerms: Term[]; specificationReferences: Term[] } {
  const approvedTerms = terms.filter((term) => term.status === "approved");
  return {
    glossaryTerms: approvedTerms.filter((term) => term.type !== "specification"),
    specificationReferences: approvedTerms.filter((term) => term.type === "specification")
  };
}

export function findExactApprovedSpecificationMatches(text: string, terms: Term[]): Term[] {
  const normalizedText = normalizeGlossaryText(text);
  return terms.filter((term) => {
    if (term.status !== "approved" || term.type !== "specification") return false;
    return glossarySourceValues(term).some((value) => normalizeGlossaryText(value) === normalizedText);
  });
}

export function isSpecificationLikeText(text: string): boolean {
  return extractSpecs(text).length > 0;
}

export function glossarySourceValues(term: Term): string[] {
  return [
    term.canonical,
    ...locales.map((locale) => term.translations[locale] ?? "")
  ]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value, index, values) => value.length > 0 && values.findIndex((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index);
}

function normalizeGlossaryText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function findGlossarySourceValue(source: string, term: Term): string | undefined {
  const normalizedSource = source.toLocaleLowerCase();
  const substringMatch = glossarySourceValues(term)
    .sort((a, b) => b.length - a.length)
    .find((value) => normalizedSource.includes(value.toLocaleLowerCase()));
  if (substringMatch) return substringMatch;
  if (term.type === "product_name" && looksLikeProductEntity(source) && !isAccessoryLikeName(source) && productEntityMatchScore(source, term) >= PRODUCT_ENTITY_MATCH_THRESHOLD) {
    return source.replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function productEntityMatchScore(source: string, term: Term): number {
  const queryTokens = nameTokens(source);
  if (queryTokens.length === 0) return 0;
  const querySeriesSignature = jSeriesModelSignature(source);
  let best = 0;
  for (const value of glossarySourceValues(term)) {
    if (isAccessoryLikeName(value)) continue;
    const candidateTokens = nameTokens(value);
    if (candidateTokens.length === 0) continue;
    const candidateSeriesSignature = jSeriesModelSignature(value);
    if (querySeriesSignature && candidateSeriesSignature && querySeriesSignature !== candidateSeriesSignature) continue;

    const overlap = queryTokens.filter((token) => candidateTokens.includes(token)).length;
    const sharedModelTokens = queryTokens.filter((token) => /\d/.test(token) && candidateTokens.includes(token));
    if (sharedModelTokens.length === 0) continue;

    const subsetRatio = overlap / queryTokens.length;
    const candidateCoverage = overlap / candidateTokens.length;
    const jaccard = overlap / new Set([...queryTokens, ...candidateTokens]).size;
    const compactSkuBoost = candidateTokens.length <= 3 && candidateTokens.every((token) => queryTokens.includes(token)) ? 0.18 : 0;
    const seriesBoost = querySeriesSignature && candidateSeriesSignature === querySeriesSignature ? 0.25 : 0;
    const score = jaccard + subsetRatio * 0.2 + candidateCoverage * 0.3 + compactSkuBoost + seriesBoost;
    best = Math.max(best, score);
  }
  return best;
}

function looksLikeProductEntity(value: string): boolean {
  const tokens = nameTokens(value);
  return tokens.some((token) => /\d/.test(token));
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

function jSeriesModelSignature(value: string): string | null {
  const normalized = normalizeNameForMatch(value);
  const match = normalized.match(/\bj\s*(\d+)\s+(?:(max|pro|evo)\s+)?ultra\b/);
  if (!match) return null;
  return [`j${match[1]}`, match[2], "ultra"].filter(Boolean).join("-");
}

function normalizeNameForMatch(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

export function validateSpecPreservation(
  nodeId: string,
  source: string,
  translations: Partial<Record<Locale, string>>,
  targetLocales: readonly Locale[] = locales
): TranslationWarning[] {
  const sourceSpecs = extractSpecs(source);
  if (sourceSpecs.length === 0) return [];

  const warnings: TranslationWarning[] = [];
  for (const locale of targetLocales) {
    const translatedSpecs = new Set(extractSpecs(translations[locale] ?? ""));
    for (const spec of sourceSpecs) {
      if (!translatedSpecs.has(spec)) {
        warnings.push({
          id: `warn_${nodeId}_${locale}_${spec}`,
          type: "spec_changed",
          severity: "error",
          nodeId,
          locale,
          message: `Spec "${spec}" is missing or changed in ${locale}.`
        });
      }
    }
  }
  return warnings;
}
