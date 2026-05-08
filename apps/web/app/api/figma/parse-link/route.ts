import { NextResponse } from "next/server";
import { parseFigmaUrl } from "@eu-translation/shared";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({ figma: parseFigmaUrl(String(body.url || "")) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Figma URL" }, { status: 400 });
  }
}
