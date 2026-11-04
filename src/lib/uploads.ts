import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { uploadsRoot } from "./paths";
import type { AttachmentRow } from "./types";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

const ALLOWED_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".webm",
  ".mov",
  ".pdf",
  ".docx",
  ".xlsx",
  ".txt",
  ".zip",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".webm",
]);

export function assertAllowedUpload(filename: string, size: number) {
  if (size > MAX_FILE_BYTES) {
    throw new Error("单文件不能超过 50MB");
  }
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`不支持的文件类型：${ext || "(无扩展名)"}`);
  }
}

/** 批量预检：任一非法则抛错，调用方应在写库/流转之前调用 */
export function assertUploadsReady(
  files: { filename: string; buffer: Buffer }[],
  existingCount = 0
) {
  if (existingCount + files.length > MAX_ATTACHMENTS) {
    throw new Error("单条附件不能超过 20 个");
  }
  for (const f of files) {
    assertAllowedUpload(f.filename, f.buffer.length);
  }
}

export function saveUploadedFile(params: {
  ownerType: "bug" | "status_event";
  ownerId: number;
  filename: string;
  mime: string;
  buffer: Buffer;
}): AttachmentRow {
  assertAllowedUpload(params.filename, params.buffer.length);
  const count = getDb()
    .prepare(
      "SELECT COUNT(*) AS c FROM attachments WHERE owner_type = ? AND owner_id = ?"
    )
    .get(params.ownerType, params.ownerId) as { c: number };
  if (count.c >= MAX_ATTACHMENTS) {
    throw new Error("单条附件不能超过 20 个");
  }

  const safeName = params.filename.replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  const rel = path.join(
    params.ownerType,
    String(params.ownerId),
    `${nanoid(10)}_${safeName}`
  );
  const abs = path.join(uploadsRoot(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, params.buffer);
  const created = nowIso();
  const info = getDb()
    .prepare(
      `INSERT INTO attachments (owner_type, owner_id, filename, mime, size, storage_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.ownerType,
      params.ownerId,
      params.filename,
      params.mime || "application/octet-stream",
      params.buffer.length,
      rel,
      created
    );
  return getDb()
    .prepare("SELECT * FROM attachments WHERE id = ?")
    .get(info.lastInsertRowid) as AttachmentRow;
}

export function absoluteAttachmentPath(storagePath: string) {
  return path.join(uploadsRoot(), storagePath);
}
