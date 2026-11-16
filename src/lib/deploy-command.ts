import path from "path";

export const DEPLOY_SHELLS = [
  "sh",
  "bash",
  "zsh",
  "fish",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "osascript",
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
] as const;

const SHELLS = new Set<string>(DEPLOY_SHELLS);

/** Absolute executable roots. The runner also allows the project workspace. */
const ROOTS = ["/Users", "/opt", "/usr", "/homebrew"];

const SAFE_PATH = /^\/(?:[\w.+@-]{1,80}\/)*[\w.+@-]{1,120}$/;

/**
 * One absolute executable path. No shell, pipeline, or `bash -c`.
 * `workspace`, when set, may contain the script even outside the fixed roots.
 */
export function assertDeployExecutable(command: string, workspace?: string): string {
  const text = command.trim();
  if (!text || text.length > 400 || /[\s\r\n\0|&;<>`$(){}[\]!#*?~\\'"]/.test(text) || text.includes("..")) {
    throw new Error("发布命令必须是绝对路径，不能包含管道或 shell");
  }
  if (!SAFE_PATH.test(text)) throw new Error("发布命令必须是绝对路径，不能包含管道或 shell");
  const base = text.split("/").pop() || "";
  if (SHELLS.has(base)) throw new Error("发布命令不能是 shell");
  const resolved = path.resolve(text);
  const roots = [...ROOTS];
  if (workspace && workspace.trim()) roots.push(path.resolve(workspace));
  const allowed = roots.some((root) => resolved.startsWith(`${root}${path.sep}`));
  if (!allowed) throw new Error("发布命令必须放在 /Users、/opt、/usr 或工作区里");
  return text;
}
