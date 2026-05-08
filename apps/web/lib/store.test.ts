import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Campaign, Product } from "@eu-translation/shared";

test("campaign product prices persist only explicit overrides and fall back to defaults", async () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "campaign-price-store-"));
  process.env.APP_STORE_PATH = join(runtimeDir, "store.json");

  try {
    const { store } = await import("./store");
    const projectId = "campaign_fallback_test";
    const campaignId = "campaign_spring";
    const now = "2026-01-01T00:00:00.000Z";
    const defaultProducts: Product[] = [
      makeProduct("product_j15", "Eureka J15", 1999, 1499, projectId, now),
      makeProduct("product_j20", "Eureka J20", 2999, 2499, projectId, now)
    ];
    const campaign: Campaign = {
      id: campaignId,
      name: "Spring Campaign",
      projectId,
      updatedAt: now
    };

    store.replaceProducts(projectId, defaultProducts);
    store.replaceCampaigns(projectId, [campaign]);

    store.upsertCampaignProductPrices(projectId, campaignId, [{ productName: "Eureka J15", discountedPrice: 1399 }]);

    const savedOverrides = store.listCampaignProductPrices(projectId).filter((price) => price.campaignId === campaignId);
    assert.equal(savedOverrides.length, 1);
    assert.equal(savedOverrides[0]?.productId, "product_j15");
    assert.equal(savedOverrides[0]?.discountedPrice, 1399);

    const effectiveProducts = store.listEffectiveProducts(projectId, campaignId);
    const overrideProduct = effectiveProducts.find((product) => product.id === "product_j15");
    const fallbackProduct = effectiveProducts.find((product) => product.id === "product_j20");

    assert.equal(overrideProduct?.hasCampaignPrice, true);
    assert.equal(overrideProduct?.rrp, 1999);
    assert.equal(overrideProduct?.defaultDiscountedPrice, 1499);
    assert.equal(overrideProduct?.discountedPrice, 1399);
    assert.equal(overrideProduct?.priceDifference, 600);

    assert.equal(fallbackProduct?.hasCampaignPrice, false);
    assert.equal(fallbackProduct?.rrp, 2999);
    assert.equal(fallbackProduct?.defaultDiscountedPrice, 2499);
    assert.equal(fallbackProduct?.discountedPrice, 2499);
    assert.equal(fallbackProduct?.priceDifference, 500);

    store.deleteCampaignProductPrice(projectId, campaignId, "product_j15");

    const pricesAfterDelete = store.listCampaignProductPrices(projectId).filter((price) => price.campaignId === campaignId);
    const productsAfterDelete = store.listEffectiveProducts(projectId, campaignId);
    const returnedFallback = productsAfterDelete.find((product) => product.id === "product_j15");

    assert.equal(pricesAfterDelete.length, 0);
    assert.equal(returnedFallback?.hasCampaignPrice, false);
    assert.equal(returnedFallback?.discountedPrice, 1499);
    assert.equal(returnedFallback?.defaultDiscountedPrice, 1499);
    assert.equal(returnedFallback?.priceDifference, 500);
  } finally {
    rmSync(runtimeDir, { force: true, recursive: true });
    delete process.env.APP_STORE_PATH;
  }
});

function makeProduct(id: string, productName: string, rrp: number, discountedPrice: number, projectId: string, updatedAt: string): Product {
  return {
    discountedPrice,
    id,
    priceDifference: rrp - discountedPrice,
    productName,
    projectId,
    rrp,
    updatedAt
  };
}
