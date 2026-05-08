export const locales = ["DE", "FR", "IT", "ES"] as const;
export type Locale = (typeof locales)[number];

export const termTypes = [
  "product_name",
  "feature",
  "feature_naming",
  "specification",
  "specification_title",
  "accessory"
] as const;
export type TermType = (typeof termTypes)[number];

export const libraryFolders = [
  { id: "product_names", label: "Product Names", termTypes: ["product_name"] },
  { id: "features", label: "Features", termTypes: ["feature"] },
  { id: "feature_naming", label: "Specific Feature Naming", termTypes: ["feature_naming"] },
  { id: "specifications", label: "Specifications", termTypes: ["specification"] },
  { id: "specification_titles", label: "Specification Titles", termTypes: ["specification_title"] },
  { id: "accessories", label: "Accessories", termTypes: ["accessory"] }
] as const;
export type LibraryFolderId = (typeof libraryFolders)[number]["id"];

export const warningTypes = [
  "missing_font",
  "text_overflow",
  "untranslated_text",
  "spec_changed",
  "term_conflict",
  "low_confidence",
  "locked_or_hidden_layer"
] as const;
export type WarningType = (typeof warningTypes)[number];

export type LocalizedText<T = string> = Record<Locale, T>;

export interface TermEvidence {
  id: string;
  locale?: Locale;
  sourceId: string;
  url?: string;
  fileName?: string;
  page?: number;
  snippet: string;
}

export interface Term {
  id: string;
  projectId: string;
  canonical: string;
  type: TermType;
  folderId: LibraryFolderId;
  translations: Partial<LocalizedText>;
  evidence: TermEvidence[];
  tags?: string[];
  confidence: number;
  status: "draft" | "approved" | "rejected";
  reviewer?: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  projectId: string;
  productName: string;
  rrp: number;
  discountedPrice: number;
  priceDifference: number;
  updatedAt: string;
  campaignId?: string;
  campaignName?: string;
  defaultDiscountedPrice?: number;
  hasCampaignPrice?: boolean;
}

export interface Campaign {
  id: string;
  projectId: string;
  name: string;
  updatedAt: string;
}

export interface CampaignProductPrice {
  id: string;
  projectId: string;
  campaignId: string;
  productId: string;
  discountedPrice: number;
  updatedAt: string;
}

export interface FigmaTextNode {
  id: string;
  name: string;
  characters: string;
  visible: boolean;
  locked: boolean;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fontName?: string | { family: string; style: string } | "mixed";
  parentPath: string[];
}

export interface FigmaFrameSnapshot {
  fileKey?: string;
  nodeId: string;
  frameName: string;
  textNodes: FigmaTextNode[];
  capturedAt: string;
}

export interface TranslationWarning {
  id: string;
  type: WarningType;
  severity: "info" | "warning" | "error";
  nodeId?: string;
  locale?: Locale;
  message: string;
}

export interface NodeTranslation {
  nodeId: string;
  source: string;
  translations: Partial<LocalizedText>;
  matchedTermIds: string[];
  confidence: number;
  warnings: TranslationWarning[];
}

export interface TranslationJob {
  id: string;
  projectId: string;
  status: "draft" | "review_required" | "approved" | "applied";
  targetLocales?: Locale[];
  sourceFrame: FigmaFrameSnapshot;
  nodeTranslations: NodeTranslation[];
  warnings: TranslationWarning[];
  createdAt: string;
  approvedAt?: string;
  appliedAt?: string;
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function assertLocalizedText(value: unknown): asserts value is LocalizedText {
  if (!value || typeof value !== "object") {
    throw new Error("Localized text must be an object");
  }
  for (const locale of locales) {
    if (typeof (value as Record<string, unknown>)[locale] !== "string") {
      throw new Error(`Missing ${locale} translation`);
    }
  }
}

export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function folderForTermType(type: TermType): LibraryFolderId {
  const folder = libraryFolders.find((candidate) =>
    (candidate.termTypes as readonly string[]).includes(type)
  );
  return folder?.id ?? "features";
}
