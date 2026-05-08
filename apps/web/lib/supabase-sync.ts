import type { Locale, Product, Term, TermEvidence } from "@eu-translation/shared";
import { libraryFolders, locales, termTypes } from "@eu-translation/shared";
import { createHash } from "node:crypto";
import { getSupabaseSettings } from "./settings";
import type { DeletedTermSyncMetadata, LibrarySyncState, ProductSyncState } from "./store";
import { DEFAULT_PROJECT_ID, store } from "./store";

type SyncStatus = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  lastSyncedAt?: string;
  error?: string;
};

type SyncResult = SyncStatus & {
  conflicts?: SyncConflict[];
  conflictCount?: number;
  pulledCount?: number;
  pushedCount?: number;
  skippedDeleteCount?: number;
  terms: Term[];
};

type ProductSyncResult = SyncStatus & {
  conflictCount?: number;
  conflicts?: ProductSyncConflict[];
  products: Product[];
  pulledCount?: number;
  pushedCount?: number;
};

export type SyncConflictAction = "overwrite" | "skip";

export type SyncConflictResolution = {
  action: SyncConflictAction;
  termId: string;
};

export type SyncConflict = {
  cloudTerm?: Term;
  cloudVersion: number;
  localTerm?: Term;
  localVersion: number;
  termId: string;
  type: "delete" | "update";
};

export type ProductSyncConflict = {
  cloudProduct?: Product;
  cloudVersion: number;
  localProduct?: Product;
  localVersion: number;
  productId: string;
  type: "delete" | "update";
};

type CloudTermRow = {
  id: string;
  project_id: string;
  canonical: string;
  type: string;
  folder_id: string;
  translations?: unknown;
  evidence?: unknown;
  tags?: unknown;
  confidence?: number | string | null;
  status?: string | null;
  reviewer?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  synced_at?: string | null;
  version?: number | string | null;
};

type CloudProductRow = {
  id: string;
  project_id: string;
  product_name: string;
  rrp: number | string;
  discounted_price: number | string;
  price_difference?: number | string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  synced_at?: string | null;
  version?: number | string | null;
};

const SUPABASE_REST_PATH = "/rest/v1";
let lastStatus: SyncStatus = {
  enabled: false,
  configured: false,
  connected: false
};

export function isSupabaseSyncEnabled(): boolean {
  return getSupabaseConfig().enabled;
}

export function getSupabaseSyncStatus(): SyncStatus {
  const config = getSupabaseConfig();
  return {
    ...lastStatus,
    configured: config.configured,
    enabled: config.enabled
  };
}

export async function syncLibrary(
  projectId = DEFAULT_PROJECT_ID,
  options: { deletedTerms?: Term[]; resolutions?: SyncConflictResolution[] } = {}
): Promise<SyncResult> {
  const localTerms = store.listTerms(projectId);
  const config = getSupabaseConfig();

  if (!config.enabled) {
    lastStatus = {
      configured: config.configured,
      connected: false,
      enabled: false
    };
    return { ...lastStatus, terms: localTerms };
  }

  if (!config.configured) {
    const status = {
      configured: false,
      connected: false,
      enabled: true,
      error: "Supabase sync is enabled but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
    };
    lastStatus = status;
    return { ...status, terms: localTerms };
  }

  try {
    await upsertProject(config, projectId);
    const cloudRows = await fetchCloudTerms(config, projectId);
    const syncState = addDeletedTermsToSyncState(store.getLibrarySyncState(projectId), options.deletedTerms ?? []);
    if (options.deletedTerms?.length) store.replaceLibrarySyncState(projectId, syncState);
    const plan = planVersionedSync(localTerms, cloudRows, syncState, options.resolutions ?? []);
    const pushedRows: CloudTermRow[] = [];

    for (const change of plan.pushes) {
      const row = await pushTermChange(config, change.term, change.expectedVersion, change.overwrite);
      pushedRows.push(row);
      const pushedTerm = cloudRowToTerm(row);
      if (pushedTerm) {
        plan.nextTerms.set(pushedTerm.id, pushedTerm);
        plan.nextSyncState.terms[pushedTerm.id] = {
          hash: termSyncHash(pushedTerm),
          version: readCloudVersion(row)
        };
      }
    }

    for (const deletion of plan.deletes) {
      const row = await pushTermDelete(config, deletion.term, deletion.expectedVersion, deletion.overwrite);
      pushedRows.push(row);
      delete plan.nextSyncState.deletedTerms[deletion.term.id];
      delete plan.nextSyncState.terms[deletion.term.id];
      plan.nextTerms.delete(deletion.term.id);
    }

    const saved = store.replaceTerms(
      projectId,
      [...plan.nextTerms.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    );
    store.replaceLibrarySyncState(projectId, plan.nextSyncState);

    const syncedAt = new Date().toISOString();
    lastStatus = {
      configured: true,
      connected: true,
      enabled: true,
      lastSyncedAt: syncedAt
    };
    return {
      ...lastStatus,
      conflictCount: plan.conflicts.length,
      conflicts: plan.conflicts,
      pulledCount: plan.pulledCount,
      pushedCount: pushedRows.length,
      skippedDeleteCount: plan.skippedDeleteCount,
      terms: saved
    };
  } catch (error) {
    lastStatus = {
      configured: config.configured,
      connected: false,
      enabled: true,
      error: error instanceof Error ? error.message : "Supabase sync failed",
      lastSyncedAt: lastStatus.lastSyncedAt
    };
    return { ...lastStatus, terms: localTerms };
  }
}

export async function syncProducts(
  projectId = DEFAULT_PROJECT_ID,
  options: { deletedProducts?: Product[]; resolutions?: Array<{ action: SyncConflictAction; productId: string }> } = {}
): Promise<ProductSyncResult> {
  const localProducts = store.listProducts(projectId);
  const config = getSupabaseConfig();

  if (!config.enabled) {
    lastStatus = { configured: config.configured, connected: false, enabled: false };
    return { ...lastStatus, products: localProducts };
  }

  if (!config.configured) {
    const status = {
      configured: false,
      connected: false,
      enabled: true,
      error: "Supabase sync is enabled but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing."
    };
    lastStatus = status;
    return { ...status, products: localProducts };
  }

  try {
    await upsertProject(config, projectId);
    const cloudRows = await fetchCloudProducts(config, projectId);
    const syncState = addDeletedProductsToSyncState(store.getProductSyncState(projectId), options.deletedProducts ?? []);
    if (options.deletedProducts?.length) store.replaceProductSyncState(projectId, syncState);
    const plan = planProductVersionedSync(localProducts, cloudRows, syncState, options.resolutions ?? []);
    const pushedRows: CloudProductRow[] = [];

    for (const change of plan.pushes) {
      const row = await pushProductChange(config, change.product, change.expectedVersion, change.overwrite);
      pushedRows.push(row);
      const pushedProduct = cloudRowToProduct(row);
      if (pushedProduct) {
        plan.nextProducts.set(pushedProduct.id, pushedProduct);
        plan.nextSyncState.products[pushedProduct.id] = {
          hash: productSyncHash(pushedProduct),
          version: readCloudVersion(row)
        };
      }
    }

    for (const deletion of plan.deletes) {
      await pushProductDelete(config, deletion.product, deletion.expectedVersion, deletion.overwrite);
      delete plan.nextSyncState.deletedProducts[deletion.product.id];
      delete plan.nextSyncState.products[deletion.product.id];
      plan.nextProducts.delete(deletion.product.id);
    }

    const saved = store.replaceProducts(projectId, [...plan.nextProducts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    store.replaceProductSyncState(projectId, plan.nextSyncState);

    const syncedAt = new Date().toISOString();
    lastStatus = { configured: true, connected: true, enabled: true, lastSyncedAt: syncedAt };
    return {
      ...lastStatus,
      conflictCount: plan.conflicts.length,
      conflicts: plan.conflicts,
      products: saved,
      pulledCount: plan.pulledCount,
      pushedCount: pushedRows.length
    };
  } catch (error) {
    lastStatus = {
      configured: config.configured,
      connected: false,
      enabled: true,
      error: error instanceof Error ? error.message : "Supabase sync failed",
      lastSyncedAt: lastStatus.lastSyncedAt
    };
    return { ...lastStatus, products: localProducts };
  }
}

export function mergeLocalAndCloudTerms(localTerms: Term[], cloudRows: CloudTermRow[]): Term[] {
  const byId = new Map<string, Term>();
  const deletedById = new Map<string, string>();

  for (const term of localTerms) {
    byId.set(term.id, normalizeTerm(term));
  }

  for (const row of cloudRows) {
    if (row.deleted_at) {
      deletedById.set(row.id, row.deleted_at);
      continue;
    }

    const cloudTerm = cloudRowToTerm(row);
    if (!cloudTerm) continue;

    const localTerm = byId.get(cloudTerm.id);
    if (!localTerm || isAfter(cloudTerm.updatedAt, localTerm.updatedAt)) {
      byId.set(cloudTerm.id, cloudTerm);
    }
  }

  for (const [termId, deletedAt] of deletedById) {
    const localTerm = byId.get(termId);
    if (!localTerm || isAfter(deletedAt, localTerm.updatedAt)) {
      byId.delete(termId);
    }
  }

  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

type PlannedPush = {
  expectedVersion: number;
  overwrite: boolean;
  term: Term;
};

type PlannedDelete = {
  expectedVersion: number;
  overwrite: boolean;
  term: Term;
};

type VersionedSyncPlan = {
  conflicts: SyncConflict[];
  deletes: PlannedDelete[];
  nextSyncState: LibrarySyncState;
  nextTerms: Map<string, Term>;
  pulledCount: number;
  pushes: PlannedPush[];
  skippedDeleteCount: number;
};

type ProductPlannedPush = {
  expectedVersion: number;
  overwrite: boolean;
  product: Product;
};

type ProductVersionedSyncPlan = {
  conflicts: ProductSyncConflict[];
  deletes: ProductPlannedPush[];
  nextProducts: Map<string, Product>;
  nextSyncState: ProductSyncState;
  pulledCount: number;
  pushes: ProductPlannedPush[];
};

export function planVersionedSync(
  localTerms: Term[],
  cloudRows: CloudTermRow[],
  syncState: LibrarySyncState,
  resolutions: SyncConflictResolution[] = []
): VersionedSyncPlan {
  const cloudById = new Map(cloudRows.map((row) => [row.id, row]));
  const resolutionById = new Map(resolutions.map((resolution) => [resolution.termId, resolution.action]));
  const nextTerms = new Map(localTerms.map((term) => [term.id, normalizeTerm(term)]));
  const nextSyncState: LibrarySyncState = JSON.parse(JSON.stringify(syncState)) as LibrarySyncState;
  const conflicts: SyncConflict[] = [];
  const pushes: PlannedPush[] = [];
  const deletes: PlannedDelete[] = [];
  let pulledCount = 0;
  let skippedDeleteCount = 0;

  for (const row of cloudRows) {
    const cloudVersion = readCloudVersion(row);
    const localTerm = nextTerms.get(row.id);
    const metadata = syncState.terms[row.id];
    const localVersion = metadata?.version ?? 0;
    const isLocalDirty = Boolean(localTerm && (!metadata || termSyncHash(localTerm) !== metadata.hash));
    const resolution = resolutionById.get(row.id);

    if (row.deleted_at) {
      if (localTerm && isLocalDirty && metadata && cloudVersion > metadata.version && !resolution) {
        conflicts.push({
          cloudVersion,
          localTerm,
          localVersion,
          termId: row.id,
          type: "update"
        });
        continue;
      }
      if (localTerm && resolution === "overwrite") {
        pushes.push({ expectedVersion: cloudVersion, overwrite: true, term: localTerm });
        continue;
      }
      if (!localTerm || !metadata || cloudVersion >= metadata.version || resolution === "skip") {
        nextTerms.delete(row.id);
        delete nextSyncState.terms[row.id];
        pulledCount += localTerm ? 1 : 0;
      }
      continue;
    }

    const cloudTerm = cloudRowToTerm(row);
    if (!cloudTerm) continue;

    if (!localTerm) {
      nextTerms.set(cloudTerm.id, cloudTerm);
      nextSyncState.terms[cloudTerm.id] = {
        hash: termSyncHash(cloudTerm),
        version: cloudVersion
      };
      pulledCount += 1;
      continue;
    }

    if (isLocalDirty && metadata && cloudVersion > metadata.version && !resolution) {
      conflicts.push({
        cloudTerm,
        cloudVersion,
        localTerm,
        localVersion,
        termId: row.id,
        type: "update"
      });
      continue;
    }

    if (isLocalDirty && resolution === "skip") {
      nextTerms.set(cloudTerm.id, cloudTerm);
      nextSyncState.terms[cloudTerm.id] = {
        hash: termSyncHash(cloudTerm),
        version: cloudVersion
      };
      pulledCount += 1;
      continue;
    }

    if (isLocalDirty) {
      pushes.push({ expectedVersion: resolution === "overwrite" ? cloudVersion : metadata?.version ?? cloudVersion, overwrite: resolution === "overwrite", term: localTerm });
      continue;
    }

    if (!metadata || cloudVersion > metadata.version || isAfter(cloudTerm.updatedAt, localTerm.updatedAt)) {
      nextTerms.set(cloudTerm.id, cloudTerm);
      nextSyncState.terms[cloudTerm.id] = {
        hash: termSyncHash(cloudTerm),
        version: cloudVersion
      };
      pulledCount += 1;
    }
  }

  for (const localTerm of localTerms) {
    if (cloudById.has(localTerm.id)) continue;
    const metadata = syncState.terms[localTerm.id];
    const isLocalDirty = !metadata || termSyncHash(localTerm) !== metadata.hash;
    if (!isLocalDirty) continue;
    pushes.push({ expectedVersion: 0, overwrite: false, term: localTerm });
  }

  for (const tombstone of Object.values(syncState.deletedTerms)) {
    const row = cloudById.get(tombstone.term.id);
    if (!row || row.deleted_at) {
      delete nextSyncState.deletedTerms[tombstone.term.id];
      delete nextSyncState.terms[tombstone.term.id];
      continue;
    }

    const cloudTerm = cloudRowToTerm(row);
    const cloudVersion = readCloudVersion(row);
    const resolution = resolutionById.get(tombstone.term.id);
    if (cloudVersion > tombstone.version && !resolution) {
      conflicts.push({
        cloudTerm: cloudTerm ?? undefined,
        cloudVersion,
        localTerm: tombstone.term,
        localVersion: tombstone.version,
        termId: tombstone.term.id,
        type: "delete"
      });
      continue;
    }

    if (resolution === "skip") {
      if (cloudTerm) {
        nextTerms.set(cloudTerm.id, cloudTerm);
        nextSyncState.terms[cloudTerm.id] = {
          hash: termSyncHash(cloudTerm),
          version: cloudVersion
        };
      }
      delete nextSyncState.deletedTerms[tombstone.term.id];
      skippedDeleteCount += 1;
      continue;
    }

    deletes.push({ expectedVersion: cloudVersion, overwrite: resolution === "overwrite", term: tombstone.term });
  }

  return { conflicts, deletes, nextSyncState, nextTerms, pulledCount, pushes, skippedDeleteCount };
}

export function planProductVersionedSync(
  localProducts: Product[],
  cloudRows: CloudProductRow[],
  syncState: ProductSyncState,
  resolutions: Array<{ action: SyncConflictAction; productId: string }> = []
): ProductVersionedSyncPlan {
  const cloudById = new Map(cloudRows.map((row) => [row.id, row]));
  const resolutionById = new Map(resolutions.map((resolution) => [resolution.productId, resolution.action]));
  const nextProducts = new Map(localProducts.map((product) => [product.id, normalizeProduct(product)]));
  const nextSyncState: ProductSyncState = JSON.parse(JSON.stringify(syncState)) as ProductSyncState;
  const conflicts: ProductSyncConflict[] = [];
  const pushes: ProductPlannedPush[] = [];
  const deletes: ProductPlannedPush[] = [];
  let pulledCount = 0;

  for (const row of cloudRows) {
    const cloudVersion = readCloudVersion(row);
    const localProduct = nextProducts.get(row.id);
    const metadata = syncState.products[row.id];
    const isLocalDirty = Boolean(localProduct && (!metadata || productSyncHash(localProduct) !== metadata.hash));
    const resolution = resolutionById.get(row.id);

    if (row.deleted_at) {
      if (localProduct && isLocalDirty && metadata && cloudVersion > metadata.version && !resolution) {
        conflicts.push({ cloudVersion, localProduct, localVersion: metadata.version, productId: row.id, type: "update" });
        continue;
      }
      if (localProduct && resolution === "overwrite") {
        pushes.push({ expectedVersion: cloudVersion, overwrite: true, product: localProduct });
        continue;
      }
      nextProducts.delete(row.id);
      delete nextSyncState.products[row.id];
      pulledCount += localProduct ? 1 : 0;
      continue;
    }

    const cloudProduct = cloudRowToProduct(row);
    if (!cloudProduct) continue;

    if (!localProduct) {
      nextProducts.set(cloudProduct.id, cloudProduct);
      nextSyncState.products[cloudProduct.id] = { hash: productSyncHash(cloudProduct), version: cloudVersion };
      pulledCount += 1;
      continue;
    }

    if (isLocalDirty && metadata && cloudVersion > metadata.version && !resolution) {
      conflicts.push({ cloudProduct, cloudVersion, localProduct, localVersion: metadata.version, productId: row.id, type: "update" });
      continue;
    }

    if (isLocalDirty && resolution === "skip") {
      nextProducts.set(cloudProduct.id, cloudProduct);
      nextSyncState.products[cloudProduct.id] = { hash: productSyncHash(cloudProduct), version: cloudVersion };
      pulledCount += 1;
      continue;
    }

    if (isLocalDirty) {
      pushes.push({ expectedVersion: resolution === "overwrite" ? cloudVersion : metadata?.version ?? cloudVersion, overwrite: resolution === "overwrite", product: localProduct });
      continue;
    }

    if (!metadata || cloudVersion > metadata.version || isAfter(cloudProduct.updatedAt, localProduct.updatedAt)) {
      nextProducts.set(cloudProduct.id, cloudProduct);
      nextSyncState.products[cloudProduct.id] = { hash: productSyncHash(cloudProduct), version: cloudVersion };
      pulledCount += 1;
    }
  }

  for (const localProduct of localProducts) {
    if (cloudById.has(localProduct.id)) continue;
    const metadata = syncState.products[localProduct.id];
    const isLocalDirty = !metadata || productSyncHash(localProduct) !== metadata.hash;
    if (isLocalDirty) pushes.push({ expectedVersion: 0, overwrite: false, product: localProduct });
  }

  for (const tombstone of Object.values(syncState.deletedProducts)) {
    const row = cloudById.get(tombstone.product.id);
    if (!row || row.deleted_at) {
      delete nextSyncState.deletedProducts[tombstone.product.id];
      delete nextSyncState.products[tombstone.product.id];
      continue;
    }
    const cloudProduct = cloudRowToProduct(row);
    const cloudVersion = readCloudVersion(row);
    const resolution = resolutionById.get(tombstone.product.id);
    if (cloudVersion > tombstone.version && !resolution) {
      conflicts.push({ cloudProduct: cloudProduct ?? undefined, cloudVersion, localProduct: tombstone.product, localVersion: tombstone.version, productId: tombstone.product.id, type: "delete" });
      continue;
    }
    if (resolution === "skip") {
      if (cloudProduct) {
        nextProducts.set(cloudProduct.id, cloudProduct);
        nextSyncState.products[cloudProduct.id] = { hash: productSyncHash(cloudProduct), version: cloudVersion };
      }
      delete nextSyncState.deletedProducts[tombstone.product.id];
      continue;
    }
    deletes.push({ expectedVersion: cloudVersion, overwrite: resolution === "overwrite", product: tombstone.product });
  }

  return { conflicts, deletes, nextProducts, nextSyncState, pulledCount, pushes };
}

function getSupabaseConfig() {
  const settings = getSupabaseSettings();
  const url = settings.url?.replace(/\/+$/, "") ?? "";
  const serviceRoleKey = settings.serviceRoleKey ?? "";
  const enabled = settings.syncEnabled;

  return {
    configured: Boolean(url && serviceRoleKey),
    enabled,
    serviceRoleKey,
    url
  };
}

async function upsertProject(config: ReturnType<typeof getSupabaseConfig>, projectId: string) {
  await supabaseRequest(config, "projects", {
    body: JSON.stringify([{ id: projectId, name: projectId === DEFAULT_PROJECT_ID ? "Internal Library" : projectId }]),
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    method: "POST"
  });
}

async function fetchCloudTerms(config: ReturnType<typeof getSupabaseConfig>, projectId: string): Promise<CloudTermRow[]> {
  return supabaseRequest<CloudTermRow[]>(
    config,
    `terms?project_id=eq.${encodeURIComponent(projectId)}&select=*`
  );
}

async function fetchCloudProducts(config: ReturnType<typeof getSupabaseConfig>, projectId: string): Promise<CloudProductRow[]> {
  return supabaseRequest<CloudProductRow[]>(
    config,
    `products?project_id=eq.${encodeURIComponent(projectId)}&select=*`
  );
}

async function pushTermChange(config: ReturnType<typeof getSupabaseConfig>, term: Term, expectedVersion: number, overwrite: boolean): Promise<CloudTermRow> {
  const nextVersion = Math.max(1, expectedVersion + 1);
  const row = termToCloudRow(term, null, expectedVersion > 0 ? nextVersion : 1);
  if (expectedVersion <= 0) {
    const rows = await supabaseRequest<CloudTermRow[]>(config, "terms", {
      body: JSON.stringify([row]),
      headers: { Prefer: "return=representation" },
      method: "POST"
    });
    return readSingleMutationRow(rows, term.id);
  }

  const rows = await supabaseRequest<CloudTermRow[]>(
    config,
    `terms?id=eq.${encodeURIComponent(term.id)}${overwrite ? "" : `&version=eq.${expectedVersion}`}`,
    {
      body: JSON.stringify(row),
      headers: { Prefer: "return=representation" },
      method: "PATCH"
    }
  );
  return readSingleMutationRow(rows, term.id);
}

async function pushTermDelete(config: ReturnType<typeof getSupabaseConfig>, term: Term, expectedVersion: number, overwrite: boolean): Promise<CloudTermRow> {
  const row = termToCloudRow({ ...term, updatedAt: new Date().toISOString() }, new Date().toISOString(), expectedVersion + 1);
  const rows = await supabaseRequest<CloudTermRow[]>(
    config,
    `terms?id=eq.${encodeURIComponent(term.id)}${overwrite ? "" : `&version=eq.${expectedVersion}`}`,
    {
      body: JSON.stringify(row),
      headers: { Prefer: "return=representation" },
      method: "PATCH"
    }
  );
  return readSingleMutationRow(rows, term.id);
}

async function pushProductChange(config: ReturnType<typeof getSupabaseConfig>, product: Product, expectedVersion: number, overwrite: boolean): Promise<CloudProductRow> {
  const nextVersion = Math.max(1, expectedVersion + 1);
  const row = productToCloudRow(product, null, expectedVersion > 0 ? nextVersion : 1);
  if (expectedVersion <= 0) {
    const rows = await supabaseRequest<CloudProductRow[]>(config, "products", {
      body: JSON.stringify([row]),
      headers: { Prefer: "return=representation" },
      method: "POST"
    });
    return readSingleProductMutationRow(rows, product.id);
  }

  const rows = await supabaseRequest<CloudProductRow[]>(
    config,
    `products?id=eq.${encodeURIComponent(product.id)}${overwrite ? "" : `&version=eq.${expectedVersion}`}`,
    {
      body: JSON.stringify(row),
      headers: { Prefer: "return=representation" },
      method: "PATCH"
    }
  );
  return readSingleProductMutationRow(rows, product.id);
}

async function pushProductDelete(config: ReturnType<typeof getSupabaseConfig>, product: Product, expectedVersion: number, overwrite: boolean): Promise<CloudProductRow> {
  const row = productToCloudRow({ ...product, updatedAt: new Date().toISOString() }, new Date().toISOString(), expectedVersion + 1);
  const rows = await supabaseRequest<CloudProductRow[]>(
    config,
    `products?id=eq.${encodeURIComponent(product.id)}${overwrite ? "" : `&version=eq.${expectedVersion}`}`,
    {
      body: JSON.stringify(row),
      headers: { Prefer: "return=representation" },
      method: "PATCH"
    }
  );
  return readSingleProductMutationRow(rows, product.id);
}

async function supabaseRequest<T = unknown>(
  config: ReturnType<typeof getSupabaseConfig>,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${config.url}${SUPABASE_REST_PATH}/${path}`, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase ${response.status}: ${message || response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function termToCloudRow(term: Term, deletedAt: string | null = null, version?: number): CloudTermRow {
  return {
    id: term.id,
    project_id: term.projectId,
    canonical: term.canonical,
    type: term.type,
    folder_id: term.folderId,
    translations: term.translations ?? {},
    evidence: term.evidence ?? [],
    tags: term.tags ?? [],
    confidence: term.confidence,
    status: term.status,
    reviewer: term.reviewer ?? null,
    updated_at: term.updatedAt,
    deleted_at: deletedAt,
    synced_at: new Date().toISOString(),
    ...(version ? { version } : {})
  };
}

function cloudRowToTerm(row: CloudTermRow): Term | null {
  if (!row.id || !row.project_id || !row.canonical) return null;
  const type = termTypes.includes(row.type as any) ? (row.type as Term["type"]) : "feature";
  const folderId = libraryFolders.some((folder) => folder.id === row.folder_id) ? (row.folder_id as Term["folderId"]) : "features";

  return normalizeTerm({
    id: row.id,
    projectId: row.project_id,
    canonical: row.canonical,
    type,
    folderId,
    translations: readTranslations(row.translations),
    evidence: readEvidence(row.evidence),
    tags: readTags(row.tags),
    confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence ?? 0),
    status: row.status === "draft" || row.status === "rejected" ? row.status : "approved",
    reviewer: row.reviewer ?? undefined,
    updatedAt: row.updated_at ?? new Date().toISOString()
  });
}

function productToCloudRow(product: Product, deletedAt: string | null = null, version?: number): CloudProductRow {
  return {
    id: product.id,
    project_id: product.projectId,
    product_name: product.productName,
    rrp: product.rrp,
    discounted_price: product.discountedPrice,
    price_difference: product.priceDifference,
    updated_at: product.updatedAt,
    deleted_at: deletedAt,
    synced_at: new Date().toISOString(),
    ...(version ? { version } : {})
  };
}

function cloudRowToProduct(row: CloudProductRow): Product | null {
  if (!row.id || !row.project_id || !row.product_name) return null;
  const rrp = Number(row.rrp);
  const discountedPrice = Number(row.discounted_price);
  if (!Number.isFinite(rrp) || !Number.isFinite(discountedPrice)) return null;
  const priceDifference = Number(row.price_difference ?? Number((rrp - discountedPrice).toFixed(2)));
  return normalizeProduct({
    id: row.id,
    projectId: row.project_id,
    productName: row.product_name,
    rrp,
    discountedPrice,
    priceDifference: Number.isFinite(priceDifference) ? priceDifference : Number((rrp - discountedPrice).toFixed(2)),
    updatedAt: row.updated_at ?? new Date().toISOString()
  });
}

function normalizeProduct(product: Product): Product {
  return {
    id: product.id,
    projectId: product.projectId,
    productName: product.productName.trim().replace(/\s+/g, " "),
    rrp: Number(product.rrp),
    discountedPrice: Number(product.discountedPrice),
    priceDifference: Number.isFinite(Number(product.priceDifference)) ? Number(product.priceDifference) : Number((Number(product.rrp) - Number(product.discountedPrice)).toFixed(2)),
    updatedAt: product.updatedAt
  };
}

function normalizeTerm(term: Term): Term {
  if ((term.type as string) !== "description" && (term.folderId as string) !== "descriptions") return term;
  return {
    ...term,
    folderId: "features",
    type: "feature"
  };
}

function readTranslations(value: unknown): Term["translations"] {
  if (!value || typeof value !== "object") return {};
  const translations: Term["translations"] = {};
  for (const locale of locales) {
    const candidate = (value as Record<string, unknown>)[locale];
    if (typeof candidate === "string") translations[locale] = candidate;
  }
  return translations;
}

function readEvidence(value: unknown): TermEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate): TermEvidence | null => {
      if (!candidate || typeof candidate !== "object") return null;
      const row = candidate as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const sourceId = typeof row.sourceId === "string" ? row.sourceId : "";
      const snippet = typeof row.snippet === "string" ? row.snippet : "";
      if (!id || !sourceId || !snippet) return null;
      const locale = typeof row.locale === "string" && locales.includes(row.locale as Locale) ? (row.locale as Locale) : undefined;
      return {
        id,
        sourceId,
        snippet,
        ...(locale ? { locale } : {}),
        ...(typeof row.url === "string" ? { url: row.url } : {}),
        ...(typeof row.fileName === "string" ? { fileName: row.fileName } : {}),
        ...(typeof row.page === "number" ? { page: row.page } : {})
      };
    })
    .filter((evidence): evidence is TermEvidence => Boolean(evidence));
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((tag) => String(tag ?? "").trim()).filter(Boolean))];
}

function addDeletedTermsToSyncState(syncState: LibrarySyncState, deletedTerms: Term[]): LibrarySyncState {
  const nextSyncState = JSON.parse(JSON.stringify(syncState)) as LibrarySyncState;
  for (const term of deletedTerms) {
    const metadata = syncState.terms[term.id] ?? { hash: termSyncHash(term), version: 0 };
    nextSyncState.deletedTerms[term.id] = {
      deletedAt: new Date().toISOString(),
      hash: metadata.hash,
      term,
      version: metadata.version
    };
    delete nextSyncState.terms[term.id];
  }
  return nextSyncState;
}

function addDeletedProductsToSyncState(syncState: ProductSyncState, deletedProducts: Product[]): ProductSyncState {
  const nextSyncState = JSON.parse(JSON.stringify(syncState)) as ProductSyncState;
  for (const product of deletedProducts) {
    const metadata = syncState.products[product.id] ?? { hash: productSyncHash(product), version: 0 };
    nextSyncState.deletedProducts[product.id] = {
      deletedAt: new Date().toISOString(),
      hash: metadata.hash,
      product,
      version: metadata.version
    };
    delete nextSyncState.products[product.id];
  }
  return nextSyncState;
}

function readSingleMutationRow(rows: CloudTermRow[], termId: string): CloudTermRow {
  const row = rows[0];
  if (!row) {
    throw new Error(`Supabase version conflict for ${termId}. Pull latest Library data and try again.`);
  }
  return row;
}

function readSingleProductMutationRow(rows: CloudProductRow[], productId: string): CloudProductRow {
  const row = rows[0];
  if (!row) {
    throw new Error(`Supabase version conflict for ${productId}. Pull latest Products data and try again.`);
  }
  return row;
}

function readCloudVersion(row: { version?: number | string | null }): number {
  const version = typeof row.version === "number" ? row.version : Number(row.version ?? 1);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

export function termSyncHash(term: Term): string {
  const payload = {
    canonical: term.canonical,
    confidence: term.confidence,
    evidence: [...(term.evidence ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    folderId: term.folderId,
    projectId: term.projectId,
    reviewer: term.reviewer ?? null,
    status: term.status,
    tags: [...(term.tags ?? [])].sort((a, b) => a.localeCompare(b)),
    translations: Object.fromEntries(Object.entries(term.translations ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    type: term.type
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function productSyncHash(product: Product): string {
  const payload = {
    discountedPrice: product.discountedPrice,
    productName: product.productName,
    projectId: product.projectId,
    rrp: product.rrp
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isAfter(candidate: string, baseline: string): boolean {
  return new Date(candidate).getTime() > new Date(baseline).getTime();
}
