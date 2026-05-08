import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalizedText,
  findApprovedTermMatches,
  findExactApprovedSpecificationMatches,
  folderForTermType,
  isSpecificationLikeText,
  libraryFolders,
  parseFigmaUrl,
  splitFigmaTranslationTerms,
  termTypes,
  validateSpecPreservation
} from "../src";
import type { Term } from "../src";

test("parses design figma urls and normalizes node ids", () => {
  assert.deepEqual(
    parseFigmaUrl("https://www.figma.com/design/abc123/Product?node-id=12-34"),
    { fileKey: "abc123", nodeId: "12:34" }
  );
});

test("parses figma file urls without node ids", () => {
  assert.deepEqual(parseFigmaUrl("https://www.figma.com/file/abc123/Product"), { fileKey: "abc123", nodeId: undefined });
});

test("requires all supported locales in localized text", () => {
  assert.doesNotThrow(() =>
    assertLocalizedText({ DE: "A", FR: "B", IT: "C", ES: "D" })
  );
  assert.throws(() => assertLocalizedText({ DE: "A" }));
});

test("matches only approved glossary terms", () => {
  const matches = findApprovedTermMatches("New Luftstrom-Boost mode", [
    {
      id: "term_1",
      projectId: "project_1",
      canonical: "AirFlow Boost",
      type: "feature_naming",
      folderId: "feature_naming",
      translations: { DE: "Luftstrom-Boost", FR: "Boost de flux d'air" },
      evidence: [],
      confidence: 0.9,
      status: "approved",
      updatedAt: new Date().toISOString()
    },
    {
      id: "term_2",
      projectId: "project_1",
      canonical: "New",
      type: "feature",
      folderId: "features",
      translations: {},
      evidence: [],
      confidence: 0.9,
      status: "draft",
      updatedAt: new Date().toISOString()
    },
    {
      id: "term_3",
      projectId: "project_1",
      canonical: "AirFlow Boost mode",
      type: "feature",
      folderId: "features",
      translations: {},
      evidence: [],
      confidence: 0.9,
      status: "rejected",
      updatedAt: new Date().toISOString()
    }
  ]);

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, "term_1");
});

test("matches approved glossary terms by locale translation values", () => {
  const matches = findApprovedTermMatches("Tecnologia anti-groviglio doppia", [
    {
      id: "term_1",
      projectId: "project_1",
      canonical: "Dual anti-tangle technology",
      type: "feature_naming",
      folderId: "feature_naming",
      translations: {
        DE: "Duale Entwirrtechnologie",
        FR: "Double technologie anti-enchevetrement",
        IT: "Tecnologia anti-groviglio doppia"
      },
      evidence: [],
      confidence: 0.9,
      status: "approved",
      updatedAt: new Date().toISOString()
    },
    {
      id: "term_2",
      projectId: "project_1",
      canonical: "Disabled technology",
      type: "feature_naming",
      folderId: "feature_naming",
      translations: { IT: "Tecnologia anti-groviglio doppia" },
      evidence: [],
      confidence: 0.9,
      status: "rejected",
      updatedAt: new Date().toISOString()
    }
  ]);

  assert.deepEqual(matches.map((term) => term.id), ["term_1"]);
});

test("matches product-like text to compact product SKU and skips accessories", () => {
  const matches = findApprovedTermMatches("Eureka J12 Ultra Saugroboter", [
    makeTerm("term_bag", "eureka-j12-staubsaugerbeutel-3", "accessory"),
    makeTerm("term_mop", "eureka-j12-mopp-4", "accessory"),
    makeTerm("term_product", "J12-BK", "product_name"),
    makeTerm("term_white", "J12WH", "product_name")
  ]);

  assert.deepEqual(matches.map((term) => term.id), ["term_product"]);
});

test("matches product variants with color words to the base product entity", () => {
  const matches = findApprovedTermMatches("Eureka J15 Ultra Roboterstaubsauger", [
    makeTerm("term_pro", "J15 Pro Ultra-BK", "product_name"),
    makeTerm("term_max", "J15 Max Ultra-BK", "product_name"),
    makeTerm("term_evo", "J15 Evo Ultra-BK", "product_name"),
    makeTerm("term_white", "J15 Ultra White", "product_name")
  ]);

  assert.deepEqual(matches.map((term) => term.id), ["term_white"]);
});

test("matches J15 series by wording between J15 and Ultra", () => {
  const terms: Term[] = [
    makeTerm("term_ultra", "J15 Ultra White", "product_name"),
    makeTerm("term_max", "J15 Max Ultra-BK", "product_name"),
    makeTerm("term_pro", "J15 Pro Ultra-BK", "product_name"),
    makeTerm("term_evo", "J15 Evo Ultra-BK", "product_name")
  ];

  assert.deepEqual(findApprovedTermMatches("Eureka J15 Ultra Roboterstaubsauger", terms).map((term) => term.id), ["term_ultra"]);
  assert.deepEqual(findApprovedTermMatches("Eureka J15 Max Ultra Roboterstaubsauger", terms).map((term) => term.id), ["term_max"]);
  assert.deepEqual(findApprovedTermMatches("Eureka J15 Pro Ultra Roboterstaubsauger", terms).map((term) => term.id), ["term_pro"]);
  assert.deepEqual(findApprovedTermMatches("Eureka J15 Evo Ultra Roboterstaubsauger", terms).map((term) => term.id), ["term_evo"]);
});

test("accessory-like text matches accessories but not product SKUs", () => {
  const matches = findApprovedTermMatches("eureka-j12-mopp-4", [
    makeTerm("term_product", "J12-BK", "product_name"),
    makeTerm("term_mop", "eureka-j12-mopp-4", "accessory")
  ]);

  assert.deepEqual(matches.map((term) => term.id), ["term_mop"]);
});

test("splits figma translation terms into regular glossary and specification references", () => {
  const terms: Term[] = [
    {
      id: "term_spec",
      projectId: "project_1",
      canonical: "Up to 360 minutes",
      type: "specification",
      folderId: "specifications",
      translations: { FR: "Jusqu'a 360 minutes" },
      evidence: [],
      confidence: 0.9,
      status: "approved",
      updatedAt: new Date().toISOString()
    },
    {
      id: "term_title",
      projectId: "project_1",
      canonical: "Robot Dimensions",
      type: "specification_title",
      folderId: "specification_titles",
      translations: { FR: "Dimensions du robot" },
      evidence: [],
      confidence: 0.9,
      status: "approved",
      updatedAt: new Date().toISOString()
    },
    {
      id: "term_disabled_spec",
      projectId: "project_1",
      canonical: "22000 Pa suction power",
      type: "specification",
      folderId: "specifications",
      translations: { FR: "Puissance d'aspiration de 22000 Pa" },
      evidence: [],
      confidence: 0.9,
      status: "rejected",
      updatedAt: new Date().toISOString()
    }
  ];

  const split = splitFigmaTranslationTerms(terms);
  assert.deepEqual(split.glossaryTerms.map((term) => term.id), ["term_title"]);
  assert.deepEqual(split.specificationReferences.map((term) => term.id), ["term_spec"]);
});

test("matches only exact approved specification references", () => {
  const terms: Term[] = [
    {
      id: "term_spec",
      projectId: "project_1",
      canonical: "Up to 360 minutes",
      type: "specification",
      folderId: "specifications",
      translations: { FR: "Jusqu'a 360 minutes" },
      evidence: [],
      confidence: 0.9,
      status: "approved",
      updatedAt: new Date().toISOString()
    },
    {
      id: "term_disabled_spec",
      projectId: "project_1",
      canonical: "22000 Pa suction power",
      type: "specification",
      folderId: "specifications",
      translations: { FR: "Puissance d'aspiration de 22000 Pa" },
      evidence: [],
      confidence: 0.9,
      status: "rejected",
      updatedAt: new Date().toISOString()
    }
  ];

  assert.deepEqual(findExactApprovedSpecificationMatches("Up to 360 minutes", terms).map((term) => term.id), ["term_spec"]);
  assert.deepEqual(findExactApprovedSpecificationMatches("Runtime up to 360 minutes", terms).map((term) => term.id), []);
});

test("detects specification-like measurement text", () => {
  assert.equal(isSpecificationLikeText("Suction power 22000 Pa"), true);
  assert.equal(isSpecificationLikeText("Up to 360 minutes"), true);
  assert.equal(isSpecificationLikeText("62 dB(A) in mop mode"), true);
  assert.equal(isSpecificationLikeText("Mother's Day picks"), false);
});

test("flags changed specs in localized text", () => {
  const warnings = validateSpecPreservation("node_1", "Battery 5000 mAh", {
    DE: "Akku 5000 mAh",
    FR: "Batterie 4000 mAh",
    IT: "Batteria 5000 mAh",
    ES: "Bateria 5000 mAh"
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.locale, "FR");
});

test("validates specs only for selected locales", () => {
  const warnings = validateSpecPreservation(
    "node_1",
    "Battery 5000 mAh",
    {
      DE: "Akku 5000 mAh",
      FR: "Batterie 4000 mAh"
    },
    ["DE"]
  );

  assert.equal(warnings.length, 0);
});

test("maps product terminology categories to library folders", () => {
  assert.equal(folderForTermType("product_name"), "product_names");
  assert.equal(folderForTermType("feature_naming"), "feature_naming");
  assert.equal(folderForTermType("accessory"), "accessories");
  assert.equal(folderForTermType("specification_title"), "specification_titles");
});

test("does not expose description as a terminology category", () => {
  assert.equal((termTypes as readonly string[]).includes("description"), false);
  assert.equal(libraryFolders.map((folder) => String(folder.id)).includes("descriptions"), false);
  assert.equal(libraryFolders.map((folder) => String(folder.label)).includes("Descriptions"), false);
});

function makeTerm(id: string, canonical: string, type: Term["type"]): Term {
  return {
    id,
    projectId: "project_1",
    canonical,
    type,
    folderId: folderForTermType(type),
    translations: {},
    evidence: [],
    confidence: 0.9,
    status: "approved",
    updatedAt: new Date().toISOString()
  };
}
