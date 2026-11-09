import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import type { Database } from "better-sqlite3";
import { actorFromIdentity } from "./auth";
import { getDb, nowIso } from "./db";
import { uploadsRoot } from "./paths";
import type { Identity } from "./types";
import { MAX_ATTACHMENTS, assertAllowedUpload, mimeForFilename } from "./uploads";

export type StagedRow = {
  id: number;
  actor_type: "user" | "api_key";
  actor_id: number;
  project_id: number;
  filename: string;
  mime: string;
  size: number;
  storage_path: string;
  created_at: string;
};

export function stageUpload(
  identity: Identity,
  projectId: number,
  file: { filename: string; buffer: Buffer }
) {
  assertAllowedUpload(file.filename, file.buffer.length);
  const actor = actorFromIdentity(identity);
  const safeName = file.filename.replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  const rel = path.join("staged", `${actor.actorType}-${actor.actorId}`, `${nanoid(10)}_${safeName}`);
  const abs = path.join(uploadsRoot(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, file.buffer);
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO staged_uploads (actor_type, actor_id, project_id, filename, mime, size, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        actor.actorType,
        actor.actorId,
        projectId,
        file.filename,
        mimeForFilename(file.filename),
        file.buffer.length,
        rel,
        nowIso()
      );
    return getDb().prepare("SELECT * FROM staged_uploads WHERE id = ?").get(info.lastInsertRowid) as StagedRow;
  } catch (error) {
    try {
      fs.unlinkSync(abs);
    } catch {
      // 库没写成时把落盘文件清掉
    }
    throw error;
  }
}

export function claimStagedUploads(
  db: Database,
  identity: Identity,
  projectId: number,
  bugId: number,
  ids: number[]
) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const actor = actorFromIdentity(identity);
  const placeholders = unique.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT * FROM staged_uploads WHERE id IN (${placeholders})`)
    .all(...unique) as StagedRow[];
  if (rows.length !== unique.length) throw new Error("附件不存在");
  for (const row of rows) {
    if (row.project_id !== projectId) throw new Error("附件不属于该项目");
    if (row.actor_type !== actor.actorType || row.actor_id !== actor.actorId) {
      throw new Error("无权使用该附件");
    }
  }
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM attachments WHERE owner_type = 'bug' AND owner_id = ?")
    .get(bugId) as { c: number };
  if (count.c + rows.length > MAX_ATTACHMENTS) throw new Error("单条附件不能超过 20 个");
  const insert = db.prepare(
    `INSERT INTO attachments (owner_type, owner_id, filename, mime, size, storage_path, created_at)
     VALUES ('bug', ?, ?, ?, ?, ?, ?)`
  );
  const remove = db.prepare("DELETE FROM staged_uploads WHERE id = ?");
  const created = nowIso();
  for (const row of rows) {
    insert.run(bugId, row.filename, row.mime, row.size, row.storage_path, created);
    remove.run(row.id);
  }
}
