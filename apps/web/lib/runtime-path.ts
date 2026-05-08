import { existsSync } from "node:fs";
import { join } from "node:path";

export function getWebRuntimePath(fileName: string, envPath?: string): string {
  if (envPath) return envPath;
  return join(getWebAppRoot(), ".runtime", fileName);
}

function getWebAppRoot(): string {
  const cwd = process.cwd();
  const cwdWebPackage = join(cwd, "package.json");
  if (existsSync(cwdWebPackage) && process.env.npm_package_name === "apps-web") return cwd;

  const workspaceWebRoot = join(cwd, "apps", "web");
  if (existsSync(join(workspaceWebRoot, "package.json"))) return workspaceWebRoot;

  if (existsSync(join(cwd, "app")) && existsSync(join(cwd, "lib"))) return cwd;
  return cwd;
}
