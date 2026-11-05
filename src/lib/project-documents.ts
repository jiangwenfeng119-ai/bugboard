import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { canAccessProject, requireAdmin } from "./permissions";
import type { Identity } from "./types";
import { absoluteAttachmentPath, assertAllowedUpload } from "./uploads";

export const DOCUMENT_KINDS = ["design", "docs"] as const;
export type ProjectDocumentKind = (typeof DOCUMENT_KINDS)[number];

export type ProjectDocument = {
  id: number;
  project_id: number;
  kind: ProjectDocumentKind;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
};

const MAX_PER_KIND = 20;
const KIND_LABEL: Record<ProjectDocumentKind, string> = {
  design: "设计稿",
  docs: "需求文档",
};

type StoredDocument = ProjectDocument & { storage_path: string };

export function isDocumentKind(value: string): value is ProjectDocumentKind {
  return value === "design" || value === "docs";
}

function requireProject(identity: Identity, projectId: number) {
  if (!canAccessProject(identity, projectId)) throw new Error("无权访问该项目");
  const project = getDb()
    .prepare("SELECT id FROM projects WHERE id = ?")
    .get(projectId);
  if (!project) throw new Error("项目不存在");
}

function rowsFor(projectId: number) {
  return getDb()
    .prepare(
      `SELECT id, project_id, kind, filename, mime, size, created_at
       FROM project_documents WHERE project_id = ? ORDER BY id`
    )
    .all(projectId) as ProjectDocument[];
}

export function listProjectDocuments(identity: Identity, projectId: number) {
  requireProject(identity, projectId);
  return rowsFor(projectId);
}

export function documentsByProject(projectIds: number[]) {
  const grouped: Record<number, ProjectDocument[]> = {};
  if (projectIds.length === 0) return grouped;
  const placeholders = projectIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT id, project_id, kind, filename, mime, size, created_at
       FROM project_documents
       WHERE project_id IN (${placeholders})
       ORDER BY id`
    )
    .all(...projectIds) as ProjectDocument[];
  for (const row of rows) {
    grouped[row.project_id] ||= [];
    grouped[row.project_id].push(row);
  }
  return grouped;
}

export function addProjectDocuments(
  identity: Identity,
  projectId: number,
  kind: string,
  files: { filename: string; mime: string; buffer: Buffer }[]
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  requireProject(identity, projectId);
  if (!isDocumentKind(kind)) throw new Error("文档类型无效");
  if (files.length === 0) throw new Error("请选择文件");
  const existing = getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM project_documents WHERE project_id = ? AND kind = ?"
    )
    .get(projectId, kind) as { c: number };
  if (existing.c + files.length > MAX_PER_KIND) {
    throw new Error(`${KIND_LABEL[kind]}附件不能超过 ${MAX_PER_KIND} 个`);
  }
  for (const file of files) assertAllowedUpload(file.filename, file.buffer.length);

  const insert = getDb().prepare(
    `INSERT INTO project_documents
      (project_id, kind, filename, mime, size, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const write = getDb().transaction(() => {
    for (const file of files) {
      const safeName = file.filename.replace(/[^\w.\-\u4e00-\u9fff]+/g, "_") || "file";
      const rel = path.join("project-docs", String(projectId), `${nanoid(10)}_${safeName}`);
      const abs = absoluteAttachmentPath(rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.buffer);
      insert.run(
        projectId,
        kind,
        file.filename,
        file.mime || "application/octet-stream",
        file.buffer.length,
        rel,
        nowIso()
      );
    }
  });
  write();
  return rowsFor(projectId);
}

export function deleteProjectDocument(
  identity: Identity,
  projectId: number,
  documentId: number
) {
  if (!requireAdmin(identity)) throw new Error("需要管理员权限");
  requireProject(identity, projectId);
  const row = getDb()
    .prepare(
      "SELECT * FROM project_documents WHERE id = ? AND project_id = ?"
    )
    .get(documentId, projectId) as StoredDocument | undefined;
  if (!row) return rowsFor(projectId);
  getDb().prepare("DELETE FROM project_documents WHERE id = ?").run(documentId);
  try {
    fs.unlinkSync(absoluteAttachmentPath(row.storage_path));
  } catch {
    // 文件已不在磁盘上时，库记录仍然删除
  }
  return rowsFor(projectId);
}

export function readProjectDocument(
  identity: Identity,
  projectId: number,
  documentId: number
) {
  requireProject(identity, projectId);
  const row = getDb()
    .prepare(
      "SELECT * FROM project_documents WHERE id = ? AND project_id = ?"
    )
    .get(documentId, projectId) as StoredDocument | undefined;
  if (!row) throw new Error("文档不存在");
  const absolutePath = absoluteAttachmentPath(row.storage_path);
  if (!fs.existsSync(absolutePath)) throw new Error("文档不存在");
  return {
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    absolutePath,
  };
}
