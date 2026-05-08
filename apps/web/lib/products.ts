import { createId, type Product } from "@eu-translation/shared";
import * as XLSX from "xlsx";
import { DEFAULT_PROJECT_ID } from "./store";

export type ProductUploadRow = {
  discountedPrice: number;
  priceDifference: number;
  productName: string;
  rrp: number;
  rowNumber: number;
};

export type ProductUploadError = {
  message: string;
  rowNumber: number;
};

export type ProductUploadPreview = {
  duplicates: string[];
  errors: ProductUploadError[];
  products: ProductUploadRow[];
};

export function parseProductWorkbook(
  buffer: ArrayBuffer,
  existingProducts: Product[] = [],
  options: { campaignMode?: boolean; existingCampaignProductNames?: string[] } = {}
): ProductUploadPreview {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { duplicates: [], errors: [{ message: "Workbook has no sheets.", rowNumber: 0 }], products: [] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { blankrows: false, header: 1, raw: false });
  const existingNames = new Set(existingProducts.map((product) => normalizeProductNameKey(product.productName)));
  const existingCampaignNames = new Set((options.existingCampaignProductNames ?? []).map((name) => normalizeProductNameKey(name)));
  const seenUploadNames = new Map<string, string>();
  const duplicates = new Set<string>();
  const errors: ProductUploadError[] = [];
  const products: ProductUploadRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const productName = normalizeProductName(row?.[0]);
    const rrp = parsePrice(row?.[1]);
    const discountedPrice = parsePrice(row?.[2]);

    if (!productName && row.every((cell) => !String(cell ?? "").trim())) return;
    if (!productName) {
      errors.push({ message: "Product Name is required.", rowNumber });
      return;
    }
    if (isAccessoryProductName(productName)) return;
    const key = normalizeProductNameKey(productName);
    if (options.campaignMode && !existingNames.has(key)) {
      errors.push({ message: "Product must exist in the default price book before adding a campaign price.", rowNumber });
      return;
    }
    if ((!options.campaignMode && existingNames.has(key)) || existingCampaignNames.has(key) || seenUploadNames.has(key)) duplicates.add(productName);
    seenUploadNames.set(key, productName);
    products.push({ discountedPrice, priceDifference: calculatePriceDifference(rrp, discountedPrice), productName, rowNumber, rrp });
  });

  return { duplicates: [...duplicates].sort((a, b) => a.localeCompare(b)), errors, products };
}

export function productRowsToProducts(rows: ProductUploadRow[], projectId = DEFAULT_PROJECT_ID): Product[] {
  const now = new Date().toISOString();
  return rows.map((row) => ({
    id: createId("product"),
    projectId,
    productName: row.productName,
    rrp: row.rrp,
    discountedPrice: row.discountedPrice,
    priceDifference: calculatePriceDifference(row.rrp, row.discountedPrice),
    updatedAt: now
  }));
}

export function calculatePriceDifference(rrp: number, discountedPrice: number): number {
  const nextRrp = Number.isFinite(rrp) ? rrp : 0;
  const nextDiscountedPrice = Number.isFinite(discountedPrice) ? discountedPrice : 0;
  return Number((nextRrp - nextDiscountedPrice).toFixed(2));
}

export function normalizeProductName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeProductNameKey(value: string): string {
  return normalizeProductName(value).toLocaleLowerCase();
}

export function isAccessoryProductName(value: string): boolean {
  const normalized = normalizeProductNameKey(value)
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
    /\bzubehor(?:set|satz)?\b/,
    /\bersatzteile?\b/,
    /\bseitenburste\b/,
    /\bseitenb[ui]rste\b/,
    /\bhauptrollenburste\b/,
    /\bhauptburste\b/,
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
    /\bsidebrush\b/,
    /\bmop-pad\b/,
    /\bpad\b/,
    /\brollerburste\b/,
    /\brollenburste\b/,
    /\bstaub(?:sauger)?beutel\b/,
    /\bbeutel\b/,
    /\bdust-bag\b/,
    /\bbag\b/
  ];

  return accessoryPatterns.some((pattern) => pattern.test(normalized));
}

export function parsePrice(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[,，\s]/g, "").replace(/[^0-9.+-]/g, "");
  if (!normalized || normalized === "." || normalized === "-" || normalized === "+") return 0;
  const price = Number(normalized);
  return Number.isFinite(price) ? price : 0;
}

export function formatProductPrice(value: number): string {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("de-DE", {
        maximumFractionDigits: 2,
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2
      }).format(value)
    : "0";
}
