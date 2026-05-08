import { NextResponse } from "next/server";
import { createId } from "@eu-translation/shared";
import { DEFAULT_PROJECT_ID, store } from "@/lib/store";
import { deleteCampaignPriceBookFromCloud, isSupabaseSyncEnabled, syncCampaignPriceBooks } from "@/lib/supabase-sync";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type"
};

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders, status: 204 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId") || DEFAULT_PROJECT_ID;
  if (isSupabaseSyncEnabled()) await syncCampaignPriceBooks(projectId);
  return jsonWithCors({ campaigns: store.listCampaigns(projectId) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const name = normalizeCampaignName(body.name);
    if (!name) throw new Error("Campaign name is required");
    const campaigns = store.listCampaigns(projectId);
    if (campaigns.some((campaign) => campaign.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error("Campaign name already exists");
    }
    const now = new Date().toISOString();
    const saved = store.upsertCampaign(projectId, {
      id: createId("campaign"),
      projectId,
      name,
      updatedAt: now
    });
    if (isSupabaseSyncEnabled()) await syncCampaignPriceBooks(projectId);
    return jsonWithCors({ campaigns: saved });
  } catch (error) {
    return jsonWithCors({ error: error instanceof Error ? error.message : "Create campaign failed" }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const campaignId = String(body.campaignId || "").trim();
    const name = normalizeCampaignName(body.name);
    if (!campaignId) throw new Error("Campaign id is required");
    if (!name) throw new Error("Campaign name is required");
    const currentCampaigns = store.listCampaigns(projectId);
    if (currentCampaigns.some((campaign) => campaign.id !== campaignId && campaign.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error("Campaign name already exists");
    }
    const campaigns = store.renameCampaign(projectId, campaignId, name);
    if (isSupabaseSyncEnabled()) await syncCampaignPriceBooks(projectId);
    return jsonWithCors({ campaigns });
  } catch (error) {
    return jsonWithCors({ error: error instanceof Error ? error.message : "Rename campaign failed" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const projectId = String(body.projectId || DEFAULT_PROJECT_ID);
    const campaignId = String(body.campaignId || "").trim();
    if (!campaignId) throw new Error("Campaign id is required");
    const campaigns = store.deleteCampaign(projectId, campaignId);
    if (isSupabaseSyncEnabled()) await deleteCampaignPriceBookFromCloud(projectId, campaignId);
    return jsonWithCors({ campaigns, products: store.listProducts(projectId) });
  } catch (error) {
    return jsonWithCors({ error: error instanceof Error ? error.message : "Delete campaign failed" }, { status: 400 });
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

function normalizeCampaignName(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
