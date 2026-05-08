import assert from "node:assert/strict";
import test from "node:test";
import type { Product } from "@eu-translation/shared";
import * as XLSX from "xlsx";
import { formatProductPrice, isAccessoryProductName, parseProductWorkbook, parsePrice } from "./products";
import type { ProductSyncState } from "./store";
import { planProductVersionedSync, productSyncHash } from "./supabase-sync";

test("parses product workbook and normalizes numeric prices", () => {
  const preview = parseProductWorkbook(makeWorkbook([
    ["Eureka J15", "HK$1,999.50", "$1,499"],
    ["Eureka J20", "2999", "2499"]
  ]));

  assert.equal(preview.errors.length, 0);
  assert.equal(preview.duplicates.length, 0);
  assert.deepEqual(
    preview.products.map((product) => ({
      productName: product.productName,
      rrp: product.rrp,
      discountedPrice: product.discountedPrice
    })),
    [
      { productName: "Eureka J15", rrp: 1999.5, discountedPrice: 1499 },
      { productName: "Eureka J20", rrp: 2999, discountedPrice: 2499 }
    ]
  );
});

test("product workbook reports invalid rows and duplicate names", () => {
  const existing = [makeProduct("product_1", "Eureka J15", 1999, 1499)];
  const preview = parseProductWorkbook(makeWorkbook([
    ["Eureka J15", "HK$1,899", "HK$1,399"],
    ["Eureka J16", "bad", "1299"],
    ["", "999", "899"],
    ["Eureka J17", "999", ""]
  ]), existing);

  assert.deepEqual(preview.duplicates, ["Eureka J15"]);
  assert.deepEqual(
    preview.errors.map((error) => ({ rowNumber: error.rowNumber, message: error.message })),
    [
      { rowNumber: 3, message: "Product Name is required." }
    ]
  );
  assert.equal(preview.products.find((product) => product.productName === "Eureka J16")?.rrp, 0);
  assert.equal(preview.products.find((product) => product.productName === "Eureka J17")?.discountedPrice, 0);
});

test("product workbook skips accessory rows from product duplicate checks", () => {
  const existing = [makeProduct("product_1", "Eureka J15", 1999, 1499)];
  const preview = parseProductWorkbook(makeWorkbook([
    ["eureka-j15-pro-ultra-hepa", "99", "79"],
    ["eureka-j15-pro-ultra-hepa", "99", "79"],
    ["floorshine880-accessory-kit", "129", "99"],
    ["eureka-j12-rollerburste", "89", "69"],
    ["eureka-j12-staubsaugerbeutel-3", "15.99", "13.99"],
    ["eureka-j12-mopp-4", "25.99", "23.99"],
    ["j20-seitenburste-j20-sb", "49", "39"],
    ["Eureka J15", "1999", "1499"]
  ]), existing);

  assert.deepEqual(preview.duplicates, ["Eureka J15"]);
  assert.deepEqual(preview.products.map((product) => product.productName), ["Eureka J15"]);
});

test("campaign workbook requires products from default price book", () => {
  const existing = [makeProduct("product_1", "Eureka J15", 1999, 1499)];
  const preview = parseProductWorkbook(makeWorkbook([
    ["Eureka J15", "1899", "1399"],
    ["Eureka J20", "2999", "2499"]
  ]), existing, { campaignMode: true });

  assert.deepEqual(preview.errors, [
    {
      message: "Product must exist in the default price book before adding a campaign price.",
      rowNumber: 2
    }
  ]);
  assert.deepEqual(preview.products.map((product) => product.productName), ["Eureka J15"]);
  assert.equal(preview.products[0]?.discountedPrice, 1399);
});

test("campaign workbook reports duplicate existing campaign overrides", () => {
  const existing = [makeProduct("product_1", "Eureka J15", 1999, 1499)];
  const preview = parseProductWorkbook(makeWorkbook([
    ["Eureka J15", "1899", "1399"],
    ["Eureka J15", "1899", "1299"]
  ]), existing, {
    campaignMode: true,
    existingCampaignProductNames: ["Eureka J15"]
  });

  assert.deepEqual(preview.duplicates, ["Eureka J15"]);
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.products.length, 2);
});

test("accessory detection does not classify translated robot vacuum names as accessories", () => {
  assert.equal(isAccessoryProductName("Eureka J12 Ultra Saugroboter"), false);
  assert.equal(isAccessoryProductName("eureka-j12-staubsaugerbeutel-3"), true);
  assert.equal(isAccessoryProductName("eureka-j12-mopp-4"), true);
});

test("parsePrice strips currency symbols and falls back to zero", () => {
  assert.equal(parsePrice("€2,499.00"), 2499);
  assert.equal(parsePrice("HK$ 1,299"), 1299);
  assert.equal(parsePrice("abc"), 0);
  assert.equal(parsePrice(""), 0);
});

test("formatProductPrice displays EU decimal comma format", () => {
  assert.equal(formatProductPrice(2499.5), "2.499,50");
  assert.equal(formatProductPrice(1299), "1.299");
});

test("product sync detects newer cloud conflict and skip pulls cloud product", () => {
  const baseline = makeProduct("product_1", "Eureka J15", 1999, 1499);
  const local = makeProduct("product_1", "Eureka J15", 1899, 1399);
  const syncState = makeProductSyncState(baseline, 1);
  const cloudRows = [
    {
      id: "product_1",
      project_id: "internal_library",
      product_name: "Eureka J15",
      rrp: 1799,
      discounted_price: 1299,
      updated_at: "2026-01-02T00:00:00.000Z",
      version: 2
    }
  ];

  const conflictPlan = planProductVersionedSync([local], cloudRows, syncState);
  assert.equal(conflictPlan.conflicts.length, 1);
  assert.equal(conflictPlan.pushes.length, 0);

  const skipPlan = planProductVersionedSync([local], cloudRows, syncState, [{ action: "skip", productId: "product_1" }]);
  assert.equal(skipPlan.conflicts.length, 0);
  assert.equal(skipPlan.nextProducts.get("product_1")?.rrp, 1799);
  assert.equal(skipPlan.nextSyncState.products.product_1?.version, 2);
});

test("product sync queues non-conflicting local update", () => {
  const baseline = makeProduct("product_1", "Eureka J15", 1999, 1499);
  const local = makeProduct("product_1", "Eureka J15", 1899, 1399);
  const syncState = makeProductSyncState(baseline, 1);
  const plan = planProductVersionedSync([local], [
    {
      id: "product_1",
      project_id: "internal_library",
      product_name: "Eureka J15",
      rrp: 1999,
      discounted_price: 1499,
      updated_at: "2026-01-01T00:00:00.000Z",
      version: 1
    }
  ], syncState);

  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.pushes.length, 1);
  assert.equal(plan.pushes[0]?.expectedVersion, 1);
});

function makeWorkbook(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Products");
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return output;
}

function makeProduct(id: string, productName: string, rrp: number, discountedPrice: number): Product {
  return {
    discountedPrice,
    id,
    priceDifference: rrp - discountedPrice,
    productName,
    projectId: "internal_library",
    rrp,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function makeProductSyncState(product: Product, version: number): ProductSyncState {
  return {
    deletedProducts: {},
    products: {
      [product.id]: {
        hash: productSyncHash(product),
        version
      }
    }
  };
}
