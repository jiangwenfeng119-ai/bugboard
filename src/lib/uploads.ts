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
  ".md",
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

const INLINE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".webm",
  ".mov",
  ".pdf",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".zip": "application/zip",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
};

export function mimeForFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

/** 下载时按扩展名决定类型，不采用客户端上报的 Content-Type。 */
export function uploadResponseHeaders(filename: string, byteLength: number) {
  const ext = path.extname(filename).toLowerCase();
  const mime = mimeForFilename(filename);
  const disposition = INLINE_EXT.has(ext) ? "inline" : "attachment";
  return {
    "Content-Type": mime,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Content-Length": String(byteLength),
  };
}

export function absoluteAttachmentPath(storagePath: string) {
  const root = path.resolve(uploadsRoot());
  const abs = path.resolve(root, storagePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("附件路径无效");
  }
  return abs;
}
