import {
  createId,
  estimateTextOverflow,
  findExactApprovedSpecificationMatches,
  findApprovedTermMatches,
  findGlossarySourceValue,
  folderForTermType,
  isSpecificationLikeText,
  locales,
  splitFigmaTranslationTerms,
  validateSpecPreservation,
  type FigmaFrameSnapshot,
  type Locale,
  type NodeTranslation,
  type Term,
  type TermType,
  type TranslationJob
} from "@eu-translation/shared";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getActiveLlmApiKey, getLlmProvider, getOpenAiBaseUrl, getOpenAiModel, getRuntimeOpenAiApiKey } from "./settings";
import { callGeminiStructured } from "./gemini";
import { parseJsonText } from "./parse-json-text";

const OPENAI_MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function getApiKey(): string | undefined {
  return getActiveLlmApiKey();
}

function getModel(): string {
  return getOpenAiModel();
}

export function hasLlmApiKey(): boolean {
  return Boolean(getApiKey());
}

export function hasOpenAiApiKey(): boolean {
  return hasLlmApiKey();
}

export async function extractTermsFromSource(input: {
  localizedSources?: Partial<Record<Locale, { sourceText: string; url: string }>>;
  projectId: string;
  sourceId: string;
  sourceText: string;
  sourceUrl?: string;
  fileName?: string;
  vectorStoreId?: string;
}): Promise<Term[]> {
  if (!getApiKey()) {
    throw new Error("AI API key is required. Add it in Setting.");
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["terms"],
    properties: {
      terms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["canonical", "type", "translations", "snippet", "localeEvidence", "confidence", "reason"],
          properties: {
            canonical: { type: "string" },
            type: {
              enum: [
                "product_name",
                "feature",
                "feature_naming",
                "specification",
                "specification_title",
                "accessory"
              ]
            },
            translations: {
              type: "object",
              additionalProperties: false,
              required: ["DE", "FR", "IT", "ES"],
              properties: {
                DE: { type: "string" },
                FR: { type: "string" },
                IT: { type: "string" },
                ES: { type: "string" }
              }
            },
            snippet: { type: "string" },
            localeEvidence: {
              type: "object",
              additionalProperties: false,
              required: ["DE", "FR", "IT", "ES"],
              properties: {
                DE: { type: "string" },
                FR: { type: "string" },
                IT: { type: "string" },
                ES: { type: "string" }
              }
            },
            confidence: { type: "number" },
            reason: { type: "string" }
          }
        }
      }
    }
  };

  const json = await callStructuredResponse({
    schemaName: "term_extraction",
    schema,
    instructions: terminologyExtractionInstructions(),
    input: buildTerminologyExtractionInput({
      fileName: input.fileName,
      localizedSources: input.localizedSources,
      sourceUrl: input.sourceUrl,
      sourceText: input.sourceText.slice(0, 28000)
    }),
    vectorStoreId: input.vectorStoreId
  });

  return normalizeExtractedTerms(json.terms ?? [], input);
}

export function buildTerminologyExtractionInput(input: {
  fileName?: string;
  localizedSources?: Partial<Record<Locale, { sourceText: string; url: string }>>;
  sourceText: string;
  sourceUrl?: string;
}): string {
  return JSON.stringify({
    primarySource: {
      fileName: input.fileName,
      role: "Defines canonical rows and categories",
      sourceText: input.sourceText.slice(0, 28000),
      sourceUrl: input.sourceUrl
    },
    localizedSources: Object.fromEntries(
      locales
        .map((locale) => {
          const source = input.localizedSources?.[locale];
          return source
            ? [
                locale,
                {
                  role: `Use exact website wording for translations.${locale} when matched confidently`,
                  sourceText: source.sourceText.slice(0, 18000),
                  sourceUrl: source.url
                }
              ]
            : undefined;
        })
        .filter((entry): entry is [Locale, { role: string; sourceText: string; sourceUrl: string }] => Boolean(entry))
    )
  });
}

export async function translateFrame(input: {
  projectId: string;
  frame: FigmaFrameSnapshot;
  terms: Term[];
  targetLocales?: Locale[];
}): Promise<TranslationJob> {
  if (!getApiKey()) return heuristicJob(input);

  const approvedTerms = input.terms.filter((term) => term.status === "approved");
  const { glossaryTerms, specificationReferences } = splitFigmaTranslationTerms(input.terms);
  const targetLocales = normalizeTargetLocales(input.targetLocales);
  const localeProperties = Object.fromEntries(targetLocales.map((locale) => [locale, { type: "string" }]));
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["nodes"],
    properties: {
      nodes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nodeId", "translations", "confidence"],
          properties: {
            nodeId: { type: "string" },
            translations: {
              type: "object",
              additionalProperties: false,
              required: targetLocales,
              properties: localeProperties
            },
            confidence: { type: "number" }
          }
        }
      }
    }
  };

  const json = await callStructuredResponse({
    schemaName: "figma_translation_job",
    schema,
    instructions: figmaTranslationInstructions(targetLocales),
    input: JSON.stringify({
      glossary: glossaryTerms.map((term) => ({
        id: term.id,
        canonical: term.canonical,
        type: term.type,
        translations: term.translations
      })),
      specificationReferences: specificationReferences.map((term) => ({
        id: term.id,
        canonical: term.canonical,
        translations: term.translations
      })),
      nodes: input.frame.textNodes.map((node) => ({
        isSpecificationLike: isSpecificationLikeText(node.characters),
        nodeId: node.id,
        source: node.characters,
        name: node.name
      }))
    })
  });

  const byNodeId = new Map(json.nodes.map((node: any) => [node.nodeId, node]));
  return buildJob(input.projectId, input.frame, approvedTerms, (node) => {
    const proposed = byNodeId.get(node.id) as any;
    return enforceApprovedTermTranslations(
      node.characters,
      proposed?.translations ?? fallbackTranslations(node.characters, targetLocales),
      glossaryTerms,
      specificationReferences,
      targetLocales
    );
  }, targetLocales);
}

export function figmaTranslationInstructions(targetLocales: readonly Locale[]): string {
  return [
    `Translate Figma ecommerce/product marketing layout text only to these locales: ${targetLocales.join(", ")}.`,
    "Source text may already be English, German, French, Italian, or Spanish. Detect the source language per text layer and translate to the requested target locales.",
    "Use the approved glossary exactly for product names, specification titles, feature names, accessories, and proprietary function terms.",
    "If source text matches any normal glossary column, including canonical, DE, FR, IT, or ES, use the approved glossary translation for each requested target locale exactly.",
    "The input may include specificationReferences. These are only type=specification Library terms.",
    "For specification-like text with numbers, dimensions, capacity, duration, force, suction, thresholds, or units, use specificationReferences as writing-format and measurement-phrasing guidance.",
    "Do not force partial replacement from specificationReferences unless the whole source text exactly matches one specification reference.",
    "For exact specification reference matches, use the approved target-locale specification wording exactly.",
    "For non-exact specification-like text, translate naturally while following specificationReferences for unit placement, measurement terms, and concise spec style.",
    "For non-glossary wording, translate as natural product marketing copy, not literal dictionary wording.",
    "Preserve emoji, model names, brand terms, currency values, prices, discount amounts, numeric specs, and units.",
    "Translate sale, CTA, and marketing labels naturally; do not leave them in English unless they are approved glossary terms.",
    "When there is no glossary match for a layer, act as the translator for every requested target locale: output natural, idiomatic marketing and CTA copy in each of DE, FR, IT, and ES (as requested). Do not leave English promo headlines, short sale banners, or button labels in FR, IT, or ES unless the approved glossary explicitly requires that English wording for that locale.",
    "Illustrative parallel patterns when the source is English short marketing text (examples only—not a fixed dictionary): a sale-style headline or promo line should read naturally in German, French, Italian, and Spanish respectively; a generic retail CTA such as \"Shop now\" should become natural in each locale, for example DE \"Jetzt kaufen\", FR \"Acheter maintenant\", IT \"Acquista ora\", ES \"Comprar ahora\".",
    "Preserve \"OFF\" only when it is a standalone discount label or part of discount text such as \"€200 OFF\".",
    "Do not uppercase substrings inside translated words; for example Italian \"offerte\" must not become \"OFFerte\".",
    "For discount text such as \"€200 OFF\", preserve \"€200\" and translate the discount meaning naturally.",
    "Keep translations concise enough for Figma layouts and avoid unnecessary expansion.",
    "\"Refresh Picks\" means refreshed/renewed curated product recommendations or selected favorites, not fresh food or fruit.",
    "Example: \"🌷 Mother’s Day Refresh Picks 🌷\" should become natural festival promo wording per locale (German example: \"🌷 Neue Empfehlungen zum Muttertag 🌷\"); use equally natural French, Italian, and Spanish—not English left in place. Avoid \"Frische Empfehlungen\" in German.",
    "Return only the requested JSON schema."
  ].join("\n");
}

async function callStructuredResponse(input: {
  schemaName: string;
  schema: object;
  instructions: string;
  input: string;
  vectorStoreId?: string;
}): Promise<any> {
  if (getLlmProvider() === "gemini") {
    if (input.vectorStoreId) {
      throw new Error("PDF/Word File Search requires OpenAI provider. Switch to OpenAI in Setting.");
    }
    return callGeminiStructured(input);
  }

  const responsesResult = await callResponsesStructured(input);
  if (responsesResult.ok) return responsesResult.data;

  if (!shouldFallbackToChat(responsesResult.status, responsesResult.body)) {
    throw new Error(formatOpenAiRequestError(responsesResult.status, responsesResult.body));
  }

  const chatResult = await callChatCompletionsStructured(input);
  if (chatResult.ok) return chatResult.data;

  throw new Error(
    [
      "OpenAI-compatible provider request failed.",
      "The app tried both /responses and /chat/completions.",
      "Check the API URL, model support, and provider status in Setting.",
      formatOpenAiRequestError(chatResult.status, chatResult.body)
    ].join(" ")
  );
}

export { parseJsonText } from "./parse-json-text";

async function callResponsesStructured(input: {
  schemaName: string;
  schema: object;
  instructions: string;
  input: string;
  vectorStoreId?: string;
}): Promise<{ ok: true; data: any } | { ok: false; status?: number; body: string }> {
  const requestBody = JSON.stringify({
    model: getModel(),
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: input.instructions }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: input.input }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: input.schemaName,
        strict: true,
        schema: input.schema
      }
    },
    tools: input.vectorStoreId
      ? [
          {
            type: "file_search",
            vector_store_ids: [input.vectorStoreId]
          }
        ]
      : undefined
  });

  let response: Response | undefined;
  let responseText = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(`${getOpenAiBaseUrl()}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${getApiKey()}`,
        "content-type": "application/json"
      },
      body: requestBody
    });

    if (response.ok) break;
    responseText = await response.text();
    if (!isTransientOpenAiStatus(response.status) || attempt === 3) break;
    await delay(600 * attempt);
  }

  if (!response?.ok) {
    return { ok: false, status: response?.status, body: responseText };
  }

  const data = await response.json();
  const text = data.output_text ?? data.output?.flatMap((item: any) => item.content ?? []).find((item: any) => item.text)?.text;
  if (!text) return { ok: false, status: response.status, body: "OpenAI response did not include structured text output" };
  return { ok: true, data: parseJsonText(text) };
}

async function callChatCompletionsStructured(input: {
  schemaName: string;
  schema: object;
  instructions: string;
  input: string;
}): Promise<{ ok: true; data: any } | { ok: false; status?: number; body: string }> {
  const baseBody = {
    model: getModel(),
    messages: [
      {
        role: "system",
        content: [
          input.instructions,
          "Return valid JSON only. Do not wrap it in Markdown.",
          `The JSON must match this schema named ${input.schemaName}: ${JSON.stringify(input.schema)}`
        ].join("\n\n")
      },
      { role: "user", content: input.input }
    ]
  };

  const first = await postChatCompletions({ ...baseBody, response_format: { type: "json_object" } });
  if (first.ok) return first;

  if (first.status === 400 && /response_format|json_object/i.test(first.body)) {
    return postChatCompletions(baseBody);
  }

  return first;
}

async function postChatCompletions(body: object): Promise<{ ok: true; data: any } | { ok: false; status?: number; body: string }> {
  let response: Response | undefined;
  let responseText = "";
  const requestBody = JSON.stringify(body);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${getApiKey()}`,
        "content-type": "application/json"
      },
      body: requestBody
    });

    if (response.ok) break;
    responseText = await response.text();
    if (!isTransientOpenAiStatus(response.status) || attempt === 3) break;
    await delay(600 * attempt);
  }

  if (!response?.ok) {
    return { ok: false, status: response?.status, body: responseText };
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) return { ok: false, status: response.status, body: "Chat Completions response did not include message content" };
  return { ok: true, data: parseJsonText(text) };
}

export function shouldFallbackToChat(status: number | undefined, body: string): boolean {
  if (!status) return true;
  if ([400, 404, 405, 422, 500, 501, 502].includes(status)) return true;
  return /responses|unsupported|not found|unknown endpoint|request_failed/i.test(body);
}

function isTransientOpenAiStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function formatOpenAiRequestError(status: number | undefined, body: string): string {
  const details = extractOpenAiErrorMessage(body);
  if (status && isTransientOpenAiStatus(status)) {
    return `OpenAI provider temporarily failed after retries (${status}). Try again, or check the API URL/model in Setting. ${details}`.trim();
  }
  return `OpenAI request failed${status ? ` (${status})` : ""}. ${details}`.trim();
}

function extractOpenAiErrorMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body);
    return String(parsed.error?.message || parsed.message || body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function uploadFileToVectorStore(file: File): Promise<{ fileId: string; vectorStoreId: string }> {
  const apiKey = getRuntimeOpenAiApiKey() || process.env.OPENAI_API_KEY;
  const configuredVectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
  if (!apiKey || !configuredVectorStoreId) {
    throw new Error("OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID are required for document File Search ingestion");
  }

  const formData = new FormData();
  formData.set("purpose", "assistants");
  formData.set("file", file);

  const uploadResponse = await fetch(`${getOpenAiBaseUrl()}/files`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: formData
  });
  if (!uploadResponse.ok) {
    throw new Error(`OpenAI file upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
  }
  const uploaded = await uploadResponse.json();

  const attachResponse = await fetch(`${getOpenAiBaseUrl()}/vector_stores/${configuredVectorStoreId}/files`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ file_id: uploaded.id })
  });
  if (!attachResponse.ok) {
    throw new Error(`OpenAI vector store attach failed: ${attachResponse.status} ${await attachResponse.text()}`);
  }

  return { fileId: uploaded.id, vectorStoreId: configuredVectorStoreId };
}

function normalizeExtractedTerms(
  terms: any[],
  input: {
    localizedSources?: Partial<Record<Locale, { sourceText: string; url: string }>>;
    projectId: string;
    sourceId: string;
    sourceUrl?: string;
    fileName?: string;
  }
): Term[] {
  const seen = new Set<string>();
  const normalized: Term[] = [];

  for (const item of terms) {
    const canonical = String(item.canonical ?? "").replace(/\s+/g, " ").trim();
    const type = item.type as TermType;
    if (!canonical || !isLikelyTerminology(canonical)) continue;
    if (!["product_name", "feature", "feature_naming", "specification", "specification_title", "accessory"].includes(type)) {
      continue;
    }

    const key = `${type}:${canonical.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({
      id: createId("term"),
      projectId: input.projectId,
      canonical,
      type,
      folderId: folderForTermType(type),
      translations: normalizeTranslations(item.translations, canonical),
      evidence: [
        {
          id: createId("evidence"),
          sourceId: input.sourceId,
          url: input.sourceUrl,
          fileName: input.fileName,
          snippet: String(item.snippet ?? canonical).slice(0, 500)
        },
        ...locales
          .map((locale) => {
            const snippet = String(item.localeEvidence?.[locale] ?? "").trim();
            const source = input.localizedSources?.[locale];
            if (!snippet || !source) return undefined;
            return {
              id: createId("evidence"),
              locale,
              sourceId: input.sourceId,
              url: source.url,
              snippet: snippet.slice(0, 500)
            };
          })
          .filter((evidence): evidence is NonNullable<typeof evidence> => Boolean(evidence))
      ],
      confidence: clampConfidence(item.confidence),
      status: "approved",
      updatedAt: new Date().toISOString()
    });
  }

  return normalized.slice(0, 80);
}

function normalizeTranslations(value: any, fallback: string): Record<Locale, string> {
  return {
    DE: cleanTranslation(value?.DE, fallback, "DE"),
    FR: cleanTranslation(value?.FR, fallback, "FR"),
    IT: cleanTranslation(value?.IT, fallback, "IT"),
    ES: cleanTranslation(value?.ES, fallback, "ES")
  };
}

function cleanTranslation(value: unknown, fallback: string, locale: Locale): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text === `[${locale}] ${fallback}`) return fallback;
  return text;
}

export function terminologyExtractionInstructions(): string {
  return [
    "You extract approved terminology from product source material for a Figma translation library.",
    "The user may provide localizedSources for DE, FR, IT, and ES. The primarySource defines rows and categories.",
    "canonical is the EN column and must always be English.",
    "If primarySource is not English, translate each extracted source term back to concise English for canonical. Never copy non-English primary source wording into canonical.",
    "Keep source-language wording only in the matching translations locale field. For German primary pages, put exact German source wording in translations.DE.",
    "Example: German source 'Saugkraft von 22000 Pa' -> canonical '22000 Pa suction power', translations.DE 'Saugkraft von 22000 Pa'.",
    "Example: German source 'Duale Entwirrtechnologie' -> canonical 'Dual anti-tangle technology', translations.DE 'Duale Entwirrtechnologie'.",
    "Return only terms that a translator/designer should reuse exactly or review carefully.",
    "Do not return navigation labels, cookie text, prices, shipping text, reviews, generic marketing fragments, full paragraphs, or duplicate variants.",
    "When localizedSources include a confident apple-to-apple match, use the exact localized website wording in translations.DE/FR/IT/ES instead of newly translating.",
    "Website localized wording wins over your own translation. Generate missing locale translations only when no matched localized page wording exists.",
    "For each locale where website wording is used, put the matching localized page text or concise evidence in localeEvidence.<locale>. Use an empty string when no localized source match exists.",
    "If the source is English, keep canonical as source English and provide DE, FR, IT, and ES.",
    "Every returned term must include translations.DE, translations.FR, translations.IT, and translations.ES.",
    "Do not use placeholder prefixes such as [DE], [FR], [IT], or [ES].",
    "Keep product model names, brand names, numbers, units, and package quantities unchanged inside translations.",
    "Classify with these exact meanings:",
    "product_name = complete model or product name.",
    "feature = a product capability written as a short descriptive phrase.",
    "feature_naming = proprietary or reusable feature names and named technologies.",
    "specification = measurable product spec, quantity, threshold, force, dimension, included count, or unit-bearing phrase.",
    "specification_title = a heading for product dimensions/spec sections.",
    "accessory = included package item/accessory/manual/brush/bag/mop/base/holder.",
    "Do not output description as a category. Categorize reusable product wording by its meaning instead.",
    "Expected examples from a Eureka product page include:",
    "Eureka J15 Max Ultra Roboterstaubsauger = product_name.",
    "Sowohl Wischmopp als auch Seitenbürste verlängern sich = feature.",
    "Saugkraft von 22000 Pa = specification.",
    "Duale Entwirrtechnologie = feature_naming.",
    "Duales Sichtsystem = feature_naming.",
    "Überquerung von 45 mm Schwellen = specification.",
    "J15 Pro Ultra Roboterstaubsauger x 1 = accessory.",
    "Staubbeutel x 3 = accessory.",
    "Abmessungen des Saugroboters = specification_title.",
    "Roboter-Wassertank = specification_title.",
    "Prefer concise noun phrases and heading text over sentences. Preserve numbers, units, model names, and x quantities exactly.",
    "",
    "Additional product URL generation rules:",
    translationGenerationRules()
  ].join("\n");
}

export function translationGenerationRules(): string {
  return readFileSync(join(OPENAI_MODULE_DIR, "translation-generation-rules.md"), "utf8").trim();
}

function isLikelyTerminology(term: string): boolean {
  if (term.length < 4 || term.length > 120) return false;
  if (/^(home|menu|search|account|cart|checkout|privacy|cookie|newsletter|subscribe|support|contact|login|register)$/i.test(term)) {
    return false;
  }
  if (term.split(/\s+/).length > 14) return false;
  return /[A-Za-zÄÖÜäöüß0-9]/.test(term);
}

function heuristicJob(input: { projectId: string; frame: FigmaFrameSnapshot; terms: Term[]; targetLocales?: Locale[] }): TranslationJob {
  const targetLocales = normalizeTargetLocales(input.targetLocales);
  const { glossaryTerms, specificationReferences } = splitFigmaTranslationTerms(input.terms);
  return buildJob(input.projectId, input.frame, input.terms, (node) => {
    let translations = fallbackTranslations(node.characters, targetLocales);
    for (const term of findApprovedTermMatches(node.characters, glossaryTerms)) {
      const matchedValue = findGlossarySourceValue(node.characters, term);
      if (!matchedValue) continue;
      for (const locale of targetLocales) {
        const approved = term.translations[locale];
        if (!approved) continue;
        if (node.characters.trim().toLocaleLowerCase() === matchedValue.toLocaleLowerCase()) {
          translations[locale] = approved;
        } else {
          translations[locale] = replaceGlossaryValue(translations[locale] ?? node.characters, matchedValue, approved);
        }
      }
    }
    return enforceApprovedTermTranslations(node.characters, translations, glossaryTerms, specificationReferences, targetLocales);
  }, targetLocales);
}

function buildJob(
  projectId: string,
  frame: FigmaFrameSnapshot,
  terms: Term[],
  translate: (node: FigmaFrameSnapshot["textNodes"][number]) => Partial<Record<Locale, string>>,
  targetLocales: Locale[] = [...locales]
): TranslationJob {
  const { glossaryTerms, specificationReferences } = splitFigmaTranslationTerms(terms);
  const nodeTranslations: NodeTranslation[] = frame.textNodes
    .filter((node) => node.characters.trim().length > 0)
    .map((node) => {
      const translations = translate(node);
      const matchedTerms = [
        ...findApprovedTermMatches(node.characters, glossaryTerms),
        ...findExactApprovedSpecificationMatches(node.characters, specificationReferences)
      ];
      const warnings = validateSpecPreservation(node.id, node.characters, translations, targetLocales);
      for (const locale of targetLocales) {
        if (translations[locale] === node.characters) {
          warnings.push({
            id: createId("warn"),
            type: "untranslated_text",
            severity: "warning",
            nodeId: node.id,
            locale,
            message: `${locale} appears untranslated.`
          });
        }
        if (estimateTextOverflow(node.characters, translations[locale] ?? "")) {
          warnings.push({
            id: createId("warn"),
            type: "text_overflow",
            severity: "warning",
            nodeId: node.id,
            locale,
            message: `${locale} is much longer than the source text.`
          });
        }
      }

      return {
        nodeId: node.id,
        source: node.characters,
        translations,
        matchedTermIds: matchedTerms.map((term) => term.id),
        confidence: warnings.some((warning) => warning.severity === "error") ? 0.4 : 0.82,
        warnings
      };
    });

  const warnings = nodeTranslations.flatMap((node) => node.warnings);
  return {
    id: createId("job"),
    projectId,
    status: "approved",
    targetLocales,
    sourceFrame: frame,
    nodeTranslations,
    warnings,
    createdAt: new Date().toISOString()
  };
}

function fallbackTranslations(source: string, targetLocales: readonly Locale[]): Partial<Record<Locale, string>> {
  return Object.fromEntries(targetLocales.map((locale) => [locale, `[${locale}] ${source}`]));
}

function normalizeTargetLocales(targetLocales: Locale[] | undefined): Locale[] {
  const selected = targetLocales?.filter((locale) => (locales as readonly string[]).includes(locale)) ?? [...locales];
  return [...new Set(selected)] as Locale[];
}

function enforceApprovedTermTranslations(
  source: string,
  translations: Partial<Record<Locale, string>>,
  glossaryTerms: Term[],
  specificationReferences: Term[],
  targetLocales: readonly Locale[]
): Partial<Record<Locale, string>> {
  const matchedTerms = [
    ...findApprovedTermMatches(source, glossaryTerms),
    ...findExactApprovedSpecificationMatches(source, specificationReferences)
  ];
  if (matchedTerms.length === 0) return translations;
  const next = { ...translations };
  for (const term of matchedTerms) {
    const matchedValue = findGlossarySourceValue(source, term);
    if (!matchedValue) continue;
    for (const locale of targetLocales) {
      const approved = term.translations[locale];
      if (!approved) continue;
      if (source.trim().toLocaleLowerCase() === matchedValue.toLocaleLowerCase()) {
        next[locale] = approved;
      } else if (next[locale]) {
        next[locale] = replaceGlossaryValue(next[locale], matchedValue, approved);
      }
      if (next[locale]) {
        next[locale] = replaceGlossaryValue(next[locale], approved, approved);
      }
    }
  }
  return next;
}

function replaceGlossaryValue(text: string, sourceValue: string, targetValue: string): string {
  const index = text.toLocaleLowerCase().indexOf(sourceValue.toLocaleLowerCase());
  if (index < 0) return text;
  return `${text.slice(0, index)}${targetValue}${text.slice(index + sourceValue.length)}`;
}

function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(1, typeof value === "number" ? value : 0.5));
}
