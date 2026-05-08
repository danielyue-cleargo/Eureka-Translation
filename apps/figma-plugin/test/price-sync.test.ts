import assert from "node:assert/strict";
import test from "node:test";
import type { Product } from "@eu-translation/shared";
import { buildPriceSyncPlanFromNodes, detectPriceClusters, matchProduct, type RawTextNode } from "../src/price-sync";

test("price sync keeps repeated J12 cards in separate clusters", () => {
  const nodes: RawTextNode[] = [
    productName("name_1", 36, 315),
    price("discounted_1", "€239,00", 36, 505),
    price("rrp_1", "€499,00", 36, 535, "STRIKETHROUGH"),
    price("off_1", "€260", 20, 40),
    label("off_label_1", "OFF", 40, 65),
    productName("name_2", 436, 315),
    price("discounted_2", "€1239,00", 436, 505),
    price("rrp_2", "€1499,00", 436, 535, "STRIKETHROUGH"),
    price("off_2", "€2260", 420, 40),
    label("off_label_2", "OFF", 440, 65)
  ];

  const clusters = detectPriceClusters(nodes);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.map((cluster) => cluster.regularPriceNodeIds), [
    ["discounted_1", "rrp_1"],
    ["discounted_2", "rrp_2"]
  ]);

  const plan = buildPriceSyncPlanFromNodes(nodes, [makeProduct("J12-BK", 499, 239)]);
  assert.equal(plan.summary.matched, 2);
  assert.equal(plan.summary.overwritten, 3);
  assert.equal(plan.replacementsBySourceNodeId.get("discounted_2"), "€239,00");
  assert.equal(plan.replacementsBySourceNodeId.get("rrp_2"), "€499,00");
  assert.equal(plan.replacementsBySourceNodeId.get("off_2"), "€260");
  assert.equal(plan.replacementsBySourceNodeId.has("discounted_1"), false);
});

test("price sync treats color words as product variants", () => {
  const product = makeProduct("J15 Ultra White", 799.99, 299);
  const match = matchProduct("Eureka J15 Ultra Roboterstaubsauger", [
    makeProduct("J15 Pro Ultra-BK", 849, 399),
    makeProduct("J15 Max Ultra-BK", 1199.99, 749.99),
    makeProduct("J15 Evo Ultra-BK", 599, 499),
    product
  ]);

  assert.equal(match?.product.productName, "J15 Ultra White");

  const plan = buildPriceSyncPlanFromNodes([
    node("name", "Eureka J15 Ultra Roboterstaubsauger", 549, 29, 420, 30),
    price("discounted", "€249,99", 549, 233),
    price("rrp", "€799,99", 631, 237, "STRIKETHROUGH"),
    price("off", "€550", 10, 31),
    label("off_label", "OFF", 20, 49)
  ], [product]);

  assert.equal(plan.summary.matched, 1);
  assert.equal(plan.replacementsBySourceNodeId.get("discounted"), "€299,00");
  assert.equal(plan.replacementsBySourceNodeId.get("off"), "€501");
});

test("price sync falls back for one selected product card with distant horizontal layout", () => {
  const product = makeProduct("J15 Ultra White", 799.99, 299);
  const plan = buildPriceSyncPlanFromNodes([
    node("name", "Eureka J15 Ultra Roboterstaubsauger", 900, 30, 420, 30),
    price("discounted", "€249,99", 549, 233),
    price("rrp", "€799,99", 631, 237, "STRIKETHROUGH"),
    price("off", "€550", 10, 31),
    label("off_label", "OFF", 20, 49)
  ], [product]);

  assert.equal(plan.summary.matched, 1);
  assert.equal(plan.replacementsBySourceNodeId.get("discounted"), "€299,00");
  assert.equal(plan.replacementsBySourceNodeId.get("off"), "€501");
});

test("price sync assigns second-row OFF badges to their own card", () => {
  const nodes: RawTextNode[] = [
    node("name_top", "Eureka J15 Ultra Roboterstaubsauger", 28, 240, 250, 58),
    price("discounted_top", "€299,00", 28, 390),
    price("rrp_top", "€799,99", 28, 420, "STRIKETHROUGH"),
    price("off_top", "€501", 16, 28),
    label("off_label_top", "OFF", 25, 50),
    node("name_bottom", "Eureka FloorShine880", 28, 705, 250, 58),
    price("discounted_bottom", "€449,00", 28, 855),
    price("rrp_bottom", "€679,00", 28, 885, "STRIKETHROUGH"),
    price("off_bottom", "€200", 16, 492),
    label("off_label_bottom", "OFF", 25, 514)
  ];

  const clusters = detectPriceClusters(nodes);
  const bottomCluster = clusters.find((cluster) => cluster.nameNodeId === "name_bottom");
  assert.equal(bottomCluster?.fields.find((field) => field.kind === "off")?.sourceNodeId, "off_bottom");

  const plan = buildPriceSyncPlanFromNodes(nodes, [
    makeProduct("J15 Ultra White", 799.99, 299),
    makeProduct("FloorShine880", 679, 449)
  ]);

  assert.equal(plan.summary.matched, 2);
  assert.equal(plan.replacementsBySourceNodeId.get("off_bottom"), "€230");
});

test("price sync uses effective campaign discount with default rrp", () => {
  const campaignProduct: Product = {
    ...makeProduct("J15 Ultra White", 799.99, 299),
    defaultDiscountedPrice: 499,
    hasCampaignPrice: true
  };
  const plan = buildPriceSyncPlanFromNodes([
    node("name", "Eureka J15 Ultra Roboterstaubsauger", 549, 29, 420, 30),
    price("discounted", "€499,00", 549, 233),
    price("rrp", "€799,99", 631, 237, "STRIKETHROUGH"),
    price("off", "€301", 10, 31),
    label("off_label", "OFF", 20, 49)
  ], [campaignProduct]);

  assert.equal(plan.summary.matched, 1);
  assert.equal(plan.replacementsBySourceNodeId.get("discounted"), "€299,00");
  assert.equal(plan.replacementsBySourceNodeId.get("off"), "€501");
});

test("price sync matches German accessory product names", () => {
  const products = [
    makeProduct("J15 Pro Ultra-BK", 849, 399),
    makeProduct("eureka-j15-pro-ultra-staubbeutel-3", 29.99, 19.99),
    makeProduct("eureka-j15-pro-ultra-zubehorset", 89.99, 59.99),
    makeProduct("eureka-j15-evo-ultra-hauptrollenburste", 49.99, 39.99)
  ];

  assert.equal(matchProduct("Eureka J15 Staubbeutel*3", products)?.product.productName, "eureka-j15-pro-ultra-staubbeutel-3");
  assert.equal(matchProduct("J15Pro Ultra Zubehörset", products)?.product.productName, "eureka-j15-pro-ultra-zubehorset");
  assert.equal(
    matchProduct("J15 Evo Ultra Hauptrollenbürste", products)?.product.productName,
    "eureka-j15-evo-ultra-hauptrollenburste"
  );
});

test("price sync does not match normal product cards to accessories", () => {
  const products = [
    makeProduct("eureka-j15-pro-ultra-staubbeutel-3", 29.99, 19.99),
    makeProduct("J15 Pro Ultra-BK", 849, 399)
  ];

  assert.equal(matchProduct("Eureka J15 Pro Ultra Roboterstaubsauger", products)?.product.productName, "J15 Pro Ultra-BK");
});

test("price sync can build replacements for accessory cards", () => {
  const plan = buildPriceSyncPlanFromNodes([
    node("name", "Eureka J15 Staubbeutel*3", 549, 29, 260, 30),
    price("discounted", "€29,99", 549, 233),
    price("rrp", "€39,99", 631, 237, "STRIKETHROUGH")
  ], [makeProduct("eureka-j15-pro-ultra-staubbeutel-3", 39.99, 19.99)]);

  assert.equal(plan.summary.matched, 1);
  assert.equal(plan.replacementsBySourceNodeId.get("discounted"), "€19,99");
});

function productName(id: string, x: number, y: number): RawTextNode {
  return node(id, "Eureka J12 Ultra Saugroboter", x, y, 250, 60);
}

function price(id: string, text: string, x: number, y: number, textDecoration = "NONE"): RawTextNode {
  return node(id, text, x, y, 90, 26, textDecoration);
}

function label(id: string, text: string, x: number, y: number): RawTextNode {
  return node(id, text, x, y, 40, 20);
}

function node(id: string, text: string, x: number, y: number, width: number, height: number, textDecoration = "NONE"): RawTextNode {
  return {
    absoluteBoundingBox: { height, width, x, y },
    id,
    name: id,
    path: ["Frame 488", "sale product card", "content"],
    text,
    textDecoration,
    visible: true
  };
}

function makeProduct(productName: string, rrp: number, discountedPrice: number): Product {
  return {
    discountedPrice,
    id: `product_${productName}`,
    priceDifference: rrp - discountedPrice,
    productName,
    projectId: "internal_library",
    rrp,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
