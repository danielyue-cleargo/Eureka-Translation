import { GET as getLlmSettings, POST as postLlmSettings, DELETE as deleteLlmSettings } from "../llm/route";

export async function GET(request: Request) {
  return getLlmSettings(request);
}

export async function POST(request: Request) {
  return postLlmSettings(request);
}

export async function DELETE() {
  return deleteLlmSettings();
}
