import fs from "fs";
import path from "path";
import packageJson from "../../package.json";

const repoRoot = process.cwd();

export const appVersion =
  typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

function readRepoMarkdown(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

export function readUserManual(): string {
  return readRepoMarkdown("docs/user-manual.md");
}

export function readProductChangelog(): string {
  return readRepoMarkdown("CHANGELOG.md");
}