import path from "path";
import fs from "fs";

export function dataRoot() {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function dbPath() {
  return process.env.DB_PATH || path.join(dataRoot(), "db", "bugboard.sqlite");
}

export function uploadsRoot() {
  return process.env.UPLOADS_DIR || path.join(dataRoot(), "uploads");
}

export function ensureDataDirs() {
  fs.mkdirSync(path.dirname(dbPath()), { recursive: true });
  fs.mkdirSync(uploadsRoot(), { recursive: true });
}
