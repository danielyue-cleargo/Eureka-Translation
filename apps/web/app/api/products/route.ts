import { NextResponse } from "next/server";
import type { Product } from "@eu-translation/shared";
import { createId } from "@eu-translation/shared";
import { calculatePriceDifference, normalizeProductName, parsePrice, productRowsToProducts, type ProductUploadRow } from "@/lib/products";
import { DEFAULT_PROJECT_ID, store } from "@/lib/store";
import { isSupabaseSyncEnabled, syncProducts } from "@/lib/supabase-sync";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type"
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") || DEFAULT_PROJECT_ID;
  if (isSupabaseSyncEnabled()) {
    const sync = await syncProducts(projectId);
    return jsonWithCors({ conflicts: sync.conflicts ?? [], products: sync.products, sync: syncStatusPayload(sync) });
  }
  return jsonWithCors({ products: store.listProducts(projectId) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const override = Boolean(body.override);
    const products = readProducts(body, projectId);
    if (products.length === 0) throw new Error("No products to save");
    const saved = store.upsertProducts(projectId, products, override);
    const sync = await syncAfterLocalChange(projectId, saved);
    return jsonWithCors({ conflicts: sync.conflicts ?? [], products: sync.products, savedCount: products.length, sync: sync.sync });
  } catch (error) {
    return jsonWithCors({ error: error instanceof Error ? error.message : "Save products failed" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const productId = String(body.productId || "").trim();
    if (!productId) throw new Error("Product id is required");
    const productName = normalizeProductName(body.productName);
    const rrp = parsePrice(body.rrp);
    const discountedPrice = parsePrice(body.discountedPrice);
    if (!productName) throw new Error("Product Name is required");
    const saved = store.updateProduct(projectId, productId, { discountedPrice, priceDifference: calculatePriceDifference(rrp, discountedPrice), productName, rrp });
    const sync = await syncAfterLocalChange(projectId, saved);
    return jsonWithCors({ conflicts: sync.conflicts ?? [], products: sync.products, sync: sync.sync });
  } catch (error) {
    return jsonWithCors({ error: error instanceof Error ? error.message : "Update product failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const productId = String(body.productId || "").trim();
    if (!productId) throw new Error("Product id is required");
    const current = store.listProducts(projectId);
    const deletedProducts = current
      .filter((product) => product.id === productId)
      .map((product) => ({ ...product, updatedAt: new Date().toISOString() }));
    const saved = store.deleteProduct(projectId, productId);
    const sync = await syncAfterLocalChange(projectId, saved, deletedProducts);
    return jsonWithCors({ conflicts: sync.conflicts ?? [], products: sync.products, sync: sync.sync });
  } catch (error) {
    return jsonWithCors({ error: error instanceof Error ? error.message : "Delete product failed" }, { status: 400 });
  }
}

function jsonWithCors(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...init?.headers
    }
  });
}

function readProducts(body: any, projectId: string): Product[] {
  if (Array.isArray(body.rows)) {
    const rows = body.rows
      .map((row: any, index: number): ProductUploadRow | null => {
        const productName = normalizeProductName(row.productName);
        const rrp = parsePrice(row.rrp);
        const discountedPrice = parsePrice(row.discountedPrice);
        if (!productName) return null;
        return { discountedPrice, priceDifference: calculatePriceDifference(rrp, discountedPrice), productName, rowNumber: Number(row.rowNumber ?? index + 1), rrp };
      })
      .filter((row: ProductUploadRow | null): row is ProductUploadRow => Boolean(row));
    return productRowsToProducts(rows, projectId);
  }

  const productName = normalizeProductName(body.productName);
  const rrp = parsePrice(body.rrp);
  const discountedPrice = parsePrice(body.discountedPrice);
  if (!productName) return [];
  return [
    {
      id: createId("product"),
      projectId,
      productName,
      rrp,
      discountedPrice,
      priceDifference: calculatePriceDifference(rrp, discountedPrice),
      updatedAt: new Date().toISOString()
    }
  ];
}

async function syncAfterLocalChange(projectId: string, fallbackProducts: Product[], deletedProducts: Product[] = []) {
  if (!isSupabaseSyncEnabled()) return { products: fallbackProducts };
  const sync = await syncProducts(projectId, { deletedProducts });
  return { conflicts: sync.conflicts, products: sync.products, sync: syncStatusPayload(sync) };
}

function syncStatusPayload(sync: Awaited<ReturnType<typeof syncProducts>>) {
  return {
    configured: sync.configured,
    connected: sync.connected,
    conflictCount: sync.conflictCount ?? 0,
    enabled: sync.enabled,
    error: sync.error,
    lastSyncedAt: sync.lastSyncedAt
  };
}
