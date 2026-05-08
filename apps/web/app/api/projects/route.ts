import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ projects: store.listProjects() });
}

export async function POST(request: Request) {
  const body = await request.json();
  const id = String(body.id || `project_${Date.now()}`);
  const project = store.upsertProject({
    id,
    name: String(body.name || "Untitled project"),
    createdAt: new Date().toISOString()
  });
  return NextResponse.json({ project });
}
