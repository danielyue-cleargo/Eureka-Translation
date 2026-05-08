import { NextResponse } from "next/server";
import { isLocale, parseFigmaUrl, type FigmaFrameSnapshot, type Locale } from "@eu-translation/shared";
import { fetchFigmaFrameSnapshot } from "@/lib/figma";
import { translateFrame } from "@/lib/openai";
import { DEFAULT_PROJECT_ID, store } from "@/lib/store";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  const jobId = searchParams.get("jobId") || "";
  if (!jobId) return jsonWithCors({ error: "Job id is required" }, { status: 400 });
  const job = store.getJob(jobId);
  if (!job) return jsonWithCors({ error: "Translation job was not found" }, { status: 404 });
  return jsonWithCors({ job });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const targetLocales = normalizeTargetLocales(body.targetLocales);
    const parsed = body.figmaUrl ? parseFigmaUrl(String(body.figmaUrl)) : undefined;
    const frame = body.frame ? normalizeFrame(body.frame, parsed?.fileKey) : await fetchFigmaFrameSnapshot(String(body.figmaUrl || ""));
    const job = await translateFrame({
      projectId,
      frame,
      terms: store.listTerms(projectId),
      targetLocales
    });
    store.createJob(job);
    return jsonWithCors({ job, summary: summarizeJob(job) });
  } catch (error) {
    return jsonWithCors({ error: error instanceof Error ? error.message : "Translation failed" }, { status: 400 });
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

function summarizeJob(job: { nodeTranslations: Array<{ matchedTermIds: string[]; warnings: unknown[] }> }) {
  const totalTextNodes = job.nodeTranslations.length;
  const nodesWithLibraryMatches = job.nodeTranslations.filter((node) => node.matchedTermIds.length > 0).length;
  return {
    totalTextNodes,
    nodesWithLibraryMatches,
    nodesTranslatedByAi: totalTextNodes - nodesWithLibraryMatches,
    warnings: job.nodeTranslations.reduce((count, node) => count + node.warnings.length, 0)
  };
}

function normalizeTargetLocales(input: unknown): Locale[] {
  if (!Array.isArray(input)) return ["DE", "FR", "IT", "ES"];
  const selected = [...new Set(input.map((locale) => String(locale)).filter(isLocale))];
  if (selected.length === 0) throw new Error("Select at least one target language");
  return selected;
}

function normalizeFrame(input: any, fileKey?: string): FigmaFrameSnapshot {
  if (!input?.nodeId || !Array.isArray(input.textNodes)) {
    throw new Error("A frame snapshot with textNodes is required");
  }
  return {
    fileKey,
    nodeId: String(input.nodeId),
    frameName: String(input.frameName || "Selected frame"),
    textNodes: input.textNodes,
    capturedAt: input.capturedAt || new Date().toISOString()
  };
}
