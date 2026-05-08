import { NextResponse } from "next/server";
import { parseProductWorkbook } from "@/lib/products";
import { DEFAULT_PROJECT_ID, store } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const projectId = String(formData.get("projectId") || DEFAULT_PROJECT_ID);
    const campaignId = String(formData.get("campaignId") || "").trim();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Choose an Excel file first");
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Upload an .xls or .xlsx file");
    const defaultProducts = store.listProducts(projectId);
    const campaignProductNames = campaignId
      ? store
          .listEffectiveProducts(projectId, campaignId)
          .filter((product) => product.hasCampaignPrice)
          .map((product) => product.productName)
      : [];
    const preview = parseProductWorkbook(await file.arrayBuffer(), defaultProducts, {
      campaignMode: Boolean(campaignId),
      existingCampaignProductNames: campaignProductNames
    });
    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Product upload failed" }, { status: 400 });
  }
}
