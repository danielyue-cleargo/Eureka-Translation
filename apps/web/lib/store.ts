import type { Product, Term, TranslationJob } from "@eu-translation/shared";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getWebRuntimePath } from "./runtime-path";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface SourceRecord {
  id: string;
  projectId: string;
  type: "url" | "pdf" | "word";
  url?: string;
  fileName?: string;
  openaiFileId?: string;
  vectorStoreId?: string;
  createdAt: string;
}

export interface TermSyncMetadata {
  hash: string;
  version: number;
}

export interface DeletedTermSyncMetadata extends TermSyncMetadata {
  deletedAt: string;
  term: Term;
}

export interface LibrarySyncState {
  deletedTerms: Record<string, DeletedTermSyncMetadata>;
  terms: Record<string, TermSyncMetadata>;
}

export interface ProductSyncMetadata {
  hash: string;
  version: number;
}

export interface DeletedProductSyncMetadata extends ProductSyncMetadata {
  deletedAt: string;
  product: Product;
}

export interface ProductSyncState {
  deletedProducts: Record<string, DeletedProductSyncMetadata>;
  products: Record<string, ProductSyncMetadata>;
}

const STORE_PATH = getWebRuntimePath("store.json", process.env.APP_STORE_PATH);

type StoredData = {
  productSync?: Record<string, ProductSyncState>;
  products?: Record<string, Product[]>;
  projects: Project[];
  sync?: Record<string, LibrarySyncState>;
  terms: Record<string, Term[]>;
  sources: Record<string, SourceRecord[]>;
  jobs: TranslationJob[];
};

const projects = new Map<string, Project>();
const products = new Map<string, Product[]>();
const terms = new Map<string, Term[]>();
const sources = new Map<string, SourceRecord[]>();
const jobs = new Map<string, TranslationJob>();
const syncStates = new Map<string, LibrarySyncState>();
const productSyncStates = new Map<string, ProductSyncState>();
let storeLoaded = false;

export const DEFAULT_PROJECT_ID = "internal_library";

function loadStore(): void {
  if (storeLoaded) return;
  storeLoaded = true;
  try {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf8")) as Partial<StoredData>;
    for (const project of data.projects ?? []) projects.set(project.id, project);
    for (const [projectId, projectProducts] of Object.entries(data.products ?? {})) products.set(projectId, normalizeStoredProducts(projectProducts));
    for (const [projectId, projectTerms] of Object.entries(data.terms ?? {})) terms.set(projectId, normalizeStoredTerms(projectTerms));
    for (const [projectId, syncState] of Object.entries(data.sync ?? {})) syncStates.set(projectId, normalizeSyncState(syncState));
    for (const [projectId, syncState] of Object.entries(data.productSync ?? {})) productSyncStates.set(projectId, normalizeProductSyncState(syncState));
    for (const [projectId, projectSources] of Object.entries(data.sources ?? {})) sources.set(projectId, projectSources);
    for (const job of data.jobs ?? []) jobs.set(job.id, job);
  } catch {
    // Missing local store means the app starts with an empty library.
  }
}

function saveStore(): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const data: StoredData = {
    products: Object.fromEntries(products.entries()),
    productSync: Object.fromEntries(productSyncStates.entries()),
    projects: [...projects.values()],
    sync: Object.fromEntries(syncStates.entries()),
    terms: Object.fromEntries(terms.entries()),
    sources: Object.fromEntries(sources.entries()),
    jobs: [...jobs.values()]
  };
  writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export const store = {
  listProjects(): Project[] {
    loadStore();
    return [...projects.values()];
  },
  upsertProject(project: Project): Project {
    loadStore();
    projects.set(project.id, project);
    saveStore();
    return project;
  },
  listTerms(projectId: string): Term[] {
    loadStore();
    return normalizeStoredTerms(terms.get(projectId) ?? []);
  },
  replaceTerms(projectId: string, nextTerms: Term[]): Term[] {
    loadStore();
    const normalized = normalizeStoredTerms(nextTerms);
    terms.set(projectId, normalized);
    saveStore();
    return normalized;
  },
  getLibrarySyncState(projectId: string): LibrarySyncState {
    loadStore();
    return cloneSyncState(syncStates.get(projectId) ?? emptySyncState());
  },
  replaceLibrarySyncState(projectId: string, nextSyncState: LibrarySyncState): LibrarySyncState {
    loadStore();
    const normalized = normalizeSyncState(nextSyncState);
    syncStates.set(projectId, normalized);
    saveStore();
    return cloneSyncState(normalized);
  },
  listProducts(projectId: string): Product[] {
    loadStore();
    return normalizeStoredProducts(products.get(projectId) ?? []);
  },
  replaceProducts(projectId: string, nextProducts: Product[]): Product[] {
    loadStore();
    const normalized = normalizeStoredProducts(nextProducts);
    products.set(projectId, normalized);
    saveStore();
    return normalized;
  },
  getProductSyncState(projectId: string): ProductSyncState {
    loadStore();
    return cloneProductSyncState(productSyncStates.get(projectId) ?? emptyProductSyncState());
  },
  replaceProductSyncState(projectId: string, nextSyncState: ProductSyncState): ProductSyncState {
    loadStore();
    const normalized = normalizeProductSyncState(nextSyncState);
    productSyncStates.set(projectId, normalized);
    saveStore();
    return cloneProductSyncState(normalized);
  },
  upsertProducts(projectId: string, nextProducts: Product[], override = false): Product[] {
    loadStore();
    const byName = new Map((products.get(projectId) ?? []).map((product) => [normalizeProductNameKey(product.productName), product]));
    const byId = new Map((products.get(projectId) ?? []).map((product) => [product.id, product]));
    for (const product of normalizeStoredProducts(nextProducts)) {
      const key = normalizeProductNameKey(product.productName);
      const existing = byName.get(key);
      if (existing && !override) continue;
      const saved = existing && override ? { ...product, id: existing.id, projectId: existing.projectId, updatedAt: new Date().toISOString() } : product;
      if (existing) byId.delete(existing.id);
      byId.set(saved.id, saved);
      byName.set(key, saved);
    }
    const saved = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    products.set(projectId, saved);
    saveStore();
    return saved;
  },
  updateProduct(projectId: string, productId: string, patch: Partial<Product>): Product[] {
    loadStore();
    const current = products.get(projectId) ?? [];
    const next = normalizeStoredProducts(
      current.map((product) =>
        product.id === productId
          ? {
              ...product,
              ...patch,
              id: product.id,
              projectId: product.projectId,
              updatedAt: new Date().toISOString()
            }
          : product
      )
    );
    products.set(projectId, next);
    saveStore();
    return next;
  },
  deleteProduct(projectId: string, productId: string): Product[] {
    loadStore();
    const next = (products.get(projectId) ?? []).filter((product) => product.id !== productId);
    products.set(projectId, next);
    saveStore();
    return next;
  },
  addTerms(projectId: string, nextTerms: Term[]): Term[] {
    loadStore();
    const current = terms.get(projectId) ?? [];
    const merged = normalizeStoredTerms([...current, ...nextTerms]);
    terms.set(projectId, merged);
    saveStore();
    return merged;
  },
  updateTerm(projectId: string, termId: string, patch: Partial<Term>): Term[] {
    loadStore();
    const current = terms.get(projectId) ?? [];
    const next = current.map((term) =>
      term.id === termId
        ? {
            ...term,
            ...patch,
            id: term.id,
            projectId: term.projectId,
            translations: patch.translations ?? term.translations,
            evidence: patch.evidence ?? term.evidence,
            updatedAt: new Date().toISOString()
          }
        : term
    );
    terms.set(projectId, next);
    saveStore();
    return next;
  },
  deleteTerm(projectId: string, termId: string): Term[] {
    loadStore();
    const next = (terms.get(projectId) ?? []).filter((term) => term.id !== termId);
    terms.set(projectId, next);
    saveStore();
    return next;
  },
  addSource(source: SourceRecord): SourceRecord {
    loadStore();
    const current = sources.get(source.projectId) ?? [];
    sources.set(source.projectId, [source, ...current]);
    saveStore();
    return source;
  },
  createJob(job: TranslationJob): TranslationJob {
    loadStore();
    jobs.set(job.id, job);
    saveStore();
    return job;
  },
  getJob(jobId: string): TranslationJob | undefined {
    loadStore();
    return jobs.get(jobId);
  }
};

function normalizeStoredTerms(nextTerms: Term[]): Term[] {
  return nextTerms.map((term) => {
    if ((term.type as string) !== "description" && (term.folderId as string) !== "descriptions") return term;
    return {
      ...term,
      type: "feature",
      folderId: "features"
    };
  });
}

function normalizeStoredProducts(nextProducts: Product[]): Product[] {
  return nextProducts
    .map((product): Product | null => {
      const productName = String(product.productName ?? "").trim().replace(/\s+/g, " ");
      const rrp = Number(product.rrp);
      const discountedPrice = Number(product.discountedPrice);
      if (!product.id || !product.projectId || !productName || !Number.isFinite(rrp) || !Number.isFinite(discountedPrice)) return null;
      return {
        id: product.id,
        projectId: product.projectId,
        productName,
        rrp,
        discountedPrice,
        priceDifference: calculateProductPriceDifference(rrp, discountedPrice),
        updatedAt: product.updatedAt || new Date().toISOString()
      };
    })
    .filter((product): product is Product => Boolean(product));
}

function normalizeProductNameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function calculateProductPriceDifference(rrp: number, discountedPrice: number): number {
  return Number((rrp - discountedPrice).toFixed(2));
}

function emptySyncState(): LibrarySyncState {
  return { deletedTerms: {}, terms: {} };
}

function emptyProductSyncState(): ProductSyncState {
  return { deletedProducts: {}, products: {} };
}

function normalizeSyncState(value: Partial<LibrarySyncState> | undefined): LibrarySyncState {
  const normalized = emptySyncState();
  for (const [termId, metadata] of Object.entries(value?.terms ?? {})) {
    if (!metadata || typeof metadata.hash !== "string" || typeof metadata.version !== "number") continue;
    normalized.terms[termId] = {
      hash: metadata.hash,
      version: metadata.version
    };
  }
  for (const [termId, metadata] of Object.entries(value?.deletedTerms ?? {})) {
    if (
      !metadata ||
      typeof metadata.hash !== "string" ||
      typeof metadata.version !== "number" ||
      typeof metadata.deletedAt !== "string" ||
      !metadata.term
    ) {
      continue;
    }
    normalized.deletedTerms[termId] = {
      deletedAt: metadata.deletedAt,
      hash: metadata.hash,
      term: metadata.term,
      version: metadata.version
    };
  }
  return normalized;
}

function normalizeProductSyncState(value: Partial<ProductSyncState> | undefined): ProductSyncState {
  const normalized = emptyProductSyncState();
  for (const [productId, metadata] of Object.entries(value?.products ?? {})) {
    if (!metadata || typeof metadata.hash !== "string" || typeof metadata.version !== "number") continue;
    normalized.products[productId] = {
      hash: metadata.hash,
      version: metadata.version
    };
  }
  for (const [productId, metadata] of Object.entries(value?.deletedProducts ?? {})) {
    if (
      !metadata ||
      typeof metadata.hash !== "string" ||
      typeof metadata.version !== "number" ||
      typeof metadata.deletedAt !== "string" ||
      !metadata.product
    ) {
      continue;
    }
    normalized.deletedProducts[productId] = {
      deletedAt: metadata.deletedAt,
      hash: metadata.hash,
      product: metadata.product,
      version: metadata.version
    };
  }
  return normalized;
}

function cloneSyncState(value: LibrarySyncState): LibrarySyncState {
  return JSON.parse(JSON.stringify(value)) as LibrarySyncState;
}

function cloneProductSyncState(value: ProductSyncState): ProductSyncState {
  return JSON.parse(JSON.stringify(value)) as ProductSyncState;
}
