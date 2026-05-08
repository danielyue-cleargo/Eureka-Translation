import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Term } from "@eu-translation/shared";
import { buildTerminologyExtractionInput, figmaTranslationInstructions, parseJsonText, shouldFallbackToChat, translateFrame, translationGenerationRules } from "./openai";
import { clearRuntimeOpenAiApiKey, resetRuntimeSettingsForTest, setRuntimeOpenAiApiKey } from "./settings";

resetRuntimeSettingsForTest(join(mkdtempSync(join(tmpdir(), "eu-web-openai-test-settings-")), "settings.json"));

test("builds terminology extraction input with labeled localized sources", () => {
  const input = JSON.parse(
    buildTerminologyExtractionInput({
      localizedSources: {
        DE: { sourceText: "Duale Entwirrtechnologie", url: "https://de.example.com/product" },
        FR: { sourceText: "Double technologie anti-enchevetrement", url: "https://fr.example.com/product" }
      },
      sourceText: "Dual anti-tangle technology",
      sourceUrl: "https://www.example.com/product"
    })
  );

  assert.equal(input.primarySource.sourceUrl, "https://www.example.com/product");
  assert.equal(input.localizedSources.DE.sourceUrl, "https://de.example.com/product");
  assert.equal(input.localizedSources.FR.sourceText, "Double technologie anti-enchevetrement");
  assert.equal(input.localizedSources.IT, undefined);
});

test("loads translation generation rules from markdown", () => {
  const rules = translationGenerationRules();
  assert.match(rules, /Translation Generation Rules/);
  assert.match(rules, /canonical` must be an AI-generated English translation/);
});

test("parses JSON returned from chat completions with optional code fences", () => {
  assert.deepEqual(parseJsonText('{"terms":[]}'), { terms: [] });
  assert.deepEqual(parseJsonText('```json\n{"terms":[{"canonical":"A"}]}\n```'), { terms: [{ canonical: "A" }] });
});

test("falls back to chat completions for unsupported responses endpoint failures", () => {
  assert.equal(shouldFallbackToChat(502, '{"error":{"message":"request_failed"}}'), true);
  assert.equal(shouldFallbackToChat(404, "not found"), true);
  assert.equal(shouldFallbackToChat(401, "invalid api key"), false);
});

test("figma translation prompt is tuned for ecommerce marketing copy", () => {
  const instructions = figmaTranslationInstructions(["DE", "FR"]);
  assert.match(instructions, /ecommerce\/product marketing/);
  assert.match(instructions, /Refresh Picks/);
  assert.match(instructions, /not fresh food or fruit/);
  assert.match(instructions, /Frische Empfehlungen/);
  assert.match(instructions, /Preserve emoji/);
  assert.match(instructions, /Translate sale, CTA, and marketing labels/);
  assert.match(instructions, /act as the translator for every requested target locale/);
  assert.match(instructions, /Do not leave English promo headlines/);
  assert.match(instructions, /Acheter maintenant/);
  assert.match(instructions, /Acquista ora/);
  assert.match(instructions, /Comprar ahora/);
  assert.match(instructions, /Shop now/);
  assert.match(instructions, /Jetzt kaufen/);
  assert.match(instructions, /€200 OFF/);
  assert.match(instructions, /standalone discount label/);
  assert.match(instructions, /offerte/);
  assert.match(instructions, /OFFerte/);
  assert.match(instructions, /specificationReferences/);
  assert.match(instructions, /only type=specification/);
  assert.match(instructions, /Do not force partial replacement from specificationReferences/);
  assert.match(instructions, /specification titles/);
  assert.match(instructions, /equally natural French, Italian, and Spanish/);
  assert.doesNotMatch(instructions, /Preserve .*sale labels/i);
});

test("figma translation request sends specification references separately from glossary", async () => {
  const previousFetch = globalThis.fetch;
  let requestBody: any;
  setRuntimeOpenAiApiKey("test-provider-key_1234567890abcdef");
  globalThis.fetch = (async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          nodes: [
            {
              nodeId: "node_1",
              translations: { FR: "Autonomie jusqu'a 360 minutes" },
              confidence: 0.88
            }
          ]
        })
      }),
      { headers: { "content-type": "application/json" }, status: 200 }
    );
  }) as typeof fetch;

  try {
    await translateFrame({
      projectId: "project_1",
      targetLocales: ["FR"],
      frame: {
        nodeId: "frame_1",
        frameName: "Frame",
        capturedAt: new Date().toISOString(),
        textNodes: [
          {
            id: "node_1",
            name: "Spec",
            characters: "Runtime up to 360 minutes",
            visible: true,
            locked: false,
            parentPath: []
          }
        ]
      },
      terms: [
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
      ]
    });

    const userInput = JSON.parse(requestBody.input[1].content[0].text);
    assert.deepEqual(userInput.glossary.map((term: any) => term.id), ["term_title"]);
    assert.deepEqual(userInput.specificationReferences.map((term: any) => term.id), ["term_spec"]);
    assert.equal(userInput.nodes[0].isSpecificationLike, true);
  } finally {
    globalThis.fetch = previousFetch;
    clearRuntimeOpenAiApiKey();
  }
});

test("figma translation jobs respect selected locales and approved library terms", async () => {
  clearRuntimeOpenAiApiKey();
  const job = await translateFrame({
    projectId: "project_1",
    targetLocales: ["DE", "FR"],
    frame: {
      nodeId: "frame_1",
      frameName: "Frame",
      capturedAt: new Date().toISOString(),
      textNodes: [
        {
          id: "node_1",
          name: "Product",
          characters: "Eureka J15",
          visible: true,
          locked: false,
          parentPath: []
        }
      ]
    },
    terms: [
      {
        id: "term_1",
        projectId: "project_1",
        canonical: "Eureka J15",
        type: "product_name",
        folderId: "product_names",
        translations: { DE: "Eureka J15 DE", FR: "Eureka J15 FR", IT: "Eureka J15 IT" },
        evidence: [],
        confidence: 0.9,
        status: "approved",
        updatedAt: new Date().toISOString()
      },
      {
        id: "term_2",
        projectId: "project_1",
        canonical: "Eureka J15",
        type: "product_name",
        folderId: "product_names",
        translations: { DE: "Disabled DE", FR: "Disabled FR" },
        evidence: [],
        confidence: 0.9,
        status: "rejected",
        updatedAt: new Date().toISOString()
      }
    ]
  });

  assert.deepEqual(job.targetLocales, ["DE", "FR"]);
  assert.equal(job.nodeTranslations[0]?.translations.DE, "Eureka J15 DE");
  assert.equal(job.nodeTranslations[0]?.translations.FR, "Eureka J15 FR");
  assert.notEqual(job.nodeTranslations[0]?.translations.DE, "Disabled DE");
  assert.equal(job.nodeTranslations[0]?.translations.IT, undefined);
  assert.deepEqual(job.nodeTranslations[0]?.matchedTermIds, ["term_1"]);
});

test("figma translation jobs match J12 product aliases before accessories", async () => {
  clearRuntimeOpenAiApiKey();
  const terms: Term[] = [
    makeTerm("term_bag", "eureka-j12-staubsaugerbeutel-3", "accessory", { FR: "Sac a poussiere J12" }),
    makeTerm("term_mop", "eureka-j12-mopp-4", "accessory", { FR: "Serpilleres J12" }),
    makeTerm("term_product", "J12-BK", "product_name", { FR: "J12-BK" })
  ];

  const job = await translateFrame({
    projectId: "project_1",
    targetLocales: ["FR"],
    frame: {
      nodeId: "frame_1",
      frameName: "Frame",
      capturedAt: new Date().toISOString(),
      textNodes: [
        {
          id: "node_1",
          name: "Product",
          characters: "Eureka J12 Ultra Saugroboter",
          visible: true,
          locked: false,
          parentPath: []
        }
      ]
    },
    terms
  });

  assert.equal(job.nodeTranslations[0]?.translations.FR, "J12-BK");
  assert.deepEqual(job.nodeTranslations[0]?.matchedTermIds, ["term_product"]);
});

test("figma translation jobs correct AI casing to approved glossary target wording", async () => {
  const previousFetch = globalThis.fetch;
  setRuntimeOpenAiApiKey("test-provider-key_1234567890abcdef");
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        output_text: JSON.stringify({
          nodes: [
            {
              nodeId: "node_1",
              translations: { IT: "🔥 Super OFFerte 🔥" },
              confidence: 0.88
            }
          ]
        })
      }),
      { headers: { "content-type": "application/json" }, status: 200 }
    )) as typeof fetch;

  try {
    const job = await translateFrame({
      projectId: "project_1",
      targetLocales: ["IT"],
      frame: {
        nodeId: "frame_1",
        frameName: "Frame",
        capturedAt: new Date().toISOString(),
        textNodes: [
          {
            id: "node_1",
            name: "Headline",
            characters: "🔥 Super Savers 🔥",
            visible: true,
            locked: false,
            parentPath: []
          }
        ]
      },
      terms: [
        {
          id: "term_1",
          projectId: "project_1",
          canonical: "Super Savers",
          type: "feature",
          folderId: "features",
          translations: { IT: "Super offerte" },
          evidence: [],
          confidence: 0.9,
          status: "approved",
          updatedAt: new Date().toISOString()
        },
        {
          id: "term_2",
          projectId: "project_1",
          canonical: "Super Savers",
          type: "feature",
          folderId: "features",
          translations: { IT: "SUPER OFFERTE" },
          evidence: [],
          confidence: 0.9,
          status: "rejected",
          updatedAt: new Date().toISOString()
        }
      ]
    });

    assert.equal(job.nodeTranslations[0]?.translations.IT, "🔥 Super offerte 🔥");
    assert.deepEqual(job.nodeTranslations[0]?.matchedTermIds, ["term_1"]);
  } finally {
    globalThis.fetch = previousFetch;
    clearRuntimeOpenAiApiKey();
  }
});

test("figma translation jobs enforce only exact specification matches", async () => {
  clearRuntimeOpenAiApiKey();
  const baseTerm = {
    id: "term_spec",
    projectId: "project_1",
    canonical: "Up to 360 minutes",
    type: "specification" as const,
    folderId: "specifications" as const,
    translations: { FR: "Jusqu'a 360 minutes" },
    evidence: [],
    confidence: 0.9,
    status: "approved" as const,
    updatedAt: new Date().toISOString()
  };

  const exactJob = await translateFrame({
    projectId: "project_1",
    targetLocales: ["FR"],
    frame: {
      nodeId: "frame_1",
      frameName: "Frame",
      capturedAt: new Date().toISOString(),
      textNodes: [
        {
          id: "node_1",
          name: "Spec",
          characters: "Up to 360 minutes",
          visible: true,
          locked: false,
          parentPath: []
        }
      ]
    },
    terms: [baseTerm]
  });

  const partialJob = await translateFrame({
    projectId: "project_1",
    targetLocales: ["FR"],
    frame: {
      nodeId: "frame_2",
      frameName: "Frame",
      capturedAt: new Date().toISOString(),
      textNodes: [
        {
          id: "node_2",
          name: "Spec",
          characters: "Runtime up to 360 minutes",
          visible: true,
          locked: false,
          parentPath: []
        }
      ]
    },
    terms: [baseTerm]
  });

  assert.equal(exactJob.nodeTranslations[0]?.translations.FR, "Jusqu'a 360 minutes");
  assert.deepEqual(exactJob.nodeTranslations[0]?.matchedTermIds, ["term_spec"]);
  assert.equal(partialJob.nodeTranslations[0]?.translations.FR, "[FR] Runtime up to 360 minutes");
  assert.deepEqual(partialJob.nodeTranslations[0]?.matchedTermIds, []);
});

function makeTerm(id: string, canonical: string, type: Term["type"], translations: Term["translations"]): Term {
  const folderByType: Record<Term["type"], Term["folderId"]> = {
    accessory: "accessories",
    feature: "features",
    feature_naming: "feature_naming",
    product_name: "product_names",
    specification: "specifications",
    specification_title: "specification_titles"
  };

  return {
    id,
    projectId: "project_1",
    canonical,
    type,
    folderId: folderByType[type],
    translations,
    evidence: [],
    confidence: 0.9,
    status: "approved",
    updatedAt: new Date().toISOString()
  };
}
