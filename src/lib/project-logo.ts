import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { requireAdmin } from "./permissions";
import { logoExtension, logoFileError } from "./project-logo-shared";
import { getProject } from "./services";
import type { Identity, ProjectRow } from "./types";
import { absoluteAttachmentPath, mimeForFilename } from "./uploads";

export function assertLogoFile(filename: string, buffer: Buffer) {
  const message = logoFileError(filename, buffer);
  if (message) throw new Error(message);
  return logoExtension(filename);
}

export function toPublicProject<T extends { logo_path?: string | null }>(project: T) {
  const { logo_path: logoPath, ...rest } = project;
  return { ...rest, has_logo: Boolean(logoPath && logoPath.trim()) };
}

function unlinkLogo(storagePath: string) {
  if (!storagePath) return;
  try {
    fs.unlinkSync(absoluteAttachmentPath(storagePath));
  } catch {
    // 文件已不在磁盘上时，库记录仍然更新
  }
}

export function setProjectLogo(
  identity: Identity,
  projectId: number,
  file: { filename: string; buffer: Buffer }
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const project = getProject(identity, projectId);
  const ext = assertLogoFile(file.filename, file.buffer);
  const rel = path.join("project-logos", String(projectId), `${nanoid(10)}${ext}`);
  const abs = absoluteAttachmentPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, file.buffer);
  const updatedAt = nowIso();
  try {
    getDb()
      .prepare("UPDATE projects SET logo_path = ?, updated_at = ? WHERE id = ?")
      .run(rel, updatedAt, projectId);
  } catch (error) {
    unlinkLogo(rel);
    throw error;
  }
  if (project.logo_path && project.logo_path !== rel) unlinkLogo(project.logo_path);
  return { has_logo: true, updated_at: updatedAt };
}

export function removeProjectLogo(identity: Identity, projectId: number) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  const project = getProject(identity, projectId);
  const updatedAt = nowIso();
  getDb()
    .prepare("UPDATE projects SET logo_path = '', updated_at = ? WHERE id = ?")
    .run(updatedAt, projectId);
  unlinkLogo(project.logo_path);
  return { has_logo: false, updated_at: updatedAt };
}

export function readProjectLogo(identity: Identity, projectId: number) {
  const project = getProject(identity, projectId);
  if (!project.logo_path) throw new Error("Logo 不存在");
  const absolutePath = absoluteAttachmentPath(project.logo_path);
  const ext = path.extname(project.logo_path).toLowerCase() || ".png";
  return {
    absolutePath,
    filename: `logo${ext}`,
    mime: mimeForFilename(`logo${ext}`),
  };
}

export function projectHasLogo(project: Pick<ProjectRow, "logo_path">) {
  return Boolean(project.logo_path && project.logo_path.trim());
}
