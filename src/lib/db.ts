import Database from "better-sqlite3";
import { dbPath, ensureDataDirs } from "./paths";
import { PROFILE_FIELDS } from "./project-profile";
import { allocateProjectCode, nextPublicId } from "./ticket-id";

let _db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','admin','superadmin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  product_manager TEXT NOT NULL DEFAULT '',
  experience_officer TEXT NOT NULL DEFAULT '',
  github_url TEXT NOT NULL DEFAULT '',
  default_branch TEXT NOT NULL DEFAULT '',
  tech_stack TEXT NOT NULL DEFAULT '',
  design_url TEXT NOT NULL DEFAULT '',
  docs_url TEXT NOT NULL DEFAULT '',
  dev_url TEXT NOT NULL DEFAULT '',
  test_url TEXT NOT NULL DEFAULT '',
  prod_url TEXT NOT NULL DEFAULT '',
  verify_env TEXT NOT NULL DEFAULT '',
  agent_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bugs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK(priority IN ('p1','p2','p3')),
  status TEXT NOT NULL,
  reporter_type TEXT NOT NULL CHECK(reporter_type IN ('user','api_key')),
  reporter_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bug_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','api_key')),
  actor_id INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('bug','status_event')),
  owner_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','admin')),
  created_by_user_id INTEGER NOT NULL,
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS api_key_projects (
  api_key_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  PRIMARY KEY (api_key_id, project_id),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('design','docs')),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_dispatch (
  project_id INTEGER PRIMARY KEY,
  webhook_url TEXT NOT NULL DEFAULT '',
  webhook_secret TEXT NOT NULL DEFAULT '',
  cursor_enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  bug_id INTEGER,
  reason TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bugs_project ON bugs(project_id);
CREATE INDEX IF NOT EXISTS idx_bugs_project_status ON bugs(project_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_project_documents_project ON project_documents(project_id, kind);
CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status);
CREATE INDEX IF NOT EXISTS idx_events_bug ON bug_status_events(bug_id);
CREATE INDEX IF NOT EXISTS idx_events_bug_id ON bug_status_events(bug_id, id);
CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_bug ON agent_dispatches(bug_id, id);
CREATE INDEX IF NOT EXISTS idx_dispatches_project ON agent_dispatches(project_id, id);
`;

export function getDb() {
  if (_db) return _db;
  ensureDataDirs();
  _db = new Database(dbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA);
  migrateSchema(_db);
  return _db;
}

function migrateSchema(db: Database.Database) {
  const cols = db.prepare("PRAGMA table_info(api_keys)").all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === "disabled_at")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN disabled_at TEXT");
  }
  if (!cols.some((c) => c.name === "use_count")) {
    db.exec(
      "ALTER TABLE api_keys ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0"
    );
    db.exec(
      "UPDATE api_keys SET use_count = 1 WHERE last_used_at IS NOT NULL"
    );
  }
  ensureSuperAdminRole(db);
  ensureMemberRoles(db);
  ensureProjectCodes(db);
  ensureProjectProfile(db);
  ensurePublicIds(db);
  ensureCaptureSchema(db);
  ensureLocalAgents(db);
}

function ensureCaptureSchema(db: Database.Database) {
  const bugCols = new Set(columnNames(db, "bugs"));
  const bugAdds: [string, string][] = [
    ["quote", "TEXT NOT NULL DEFAULT ''"],
    ["steps_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["evidence_sec", "REAL"],
    ["strokes_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["confidence", "TEXT NOT NULL DEFAULT ''"],
    ["open_question", "TEXT NOT NULL DEFAULT ''"],
    ["source_url", "TEXT NOT NULL DEFAULT ''"],
    ["capture_session_id", "INTEGER"],
  ];
  for (const [name, ddl] of bugAdds) {
    if (!bugCols.has(name)) db.exec(`ALTER TABLE bugs ADD COLUMN ${name} ${ddl}`);
  }

  const projectCols = new Set(columnNames(db, "projects"));
  if (!projectCols.has("widget_token")) {
    db.exec("ALTER TABLE projects ADD COLUMN widget_token TEXT");
  }
  if (!projectCols.has("widget_owner_user_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN widget_owner_user_id INTEGER");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_widget_token ON projects(widget_token) WHERE widget_token IS NOT NULL"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS capture_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      author_type TEXT NOT NULL CHECK(author_type IN ('user','api_key')),
      author_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('review','done')),
      title TEXT NOT NULL DEFAULT '',
      transcript_json TEXT NOT NULL DEFAULT '[]',
      duration_sec REAL,
      truncated INTEGER NOT NULL DEFAULT 0,
      video_filename TEXT,
      video_mime TEXT,
      video_size INTEGER,
      video_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS capture_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      sort_index INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      quote TEXT NOT NULL DEFAULT '',
      steps_json TEXT NOT NULL DEFAULT '[]',
      evidence_sec REAL,
      confidence TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL DEFAULT '',
      strokes_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('draft','kept','discarded','merged')),
      merged_into_id INTEGER,
      bug_id INTEGER,
      frame_filename TEXT,
      frame_mime TEXT,
      frame_size INTEGER,
      frame_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES capture_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS staged_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('user','api_key')),
      actor_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_captures_project ON capture_sessions(project_id, id);
    CREATE INDEX IF NOT EXISTS idx_drafts_session ON capture_drafts(session_id, sort_index);
    CREATE INDEX IF NOT EXISTS idx_staged_actor ON staged_uploads(actor_type, actor_id, project_id);
  `);

  const sessionCols = new Set(columnNames(db, "capture_sessions"));
  if (!sessionCols.has("organize_status")) {
    db.exec("ALTER TABLE capture_sessions ADD COLUMN organize_status TEXT NOT NULL DEFAULT 'ready'");
  }
  if (!sessionCols.has("organize_detail")) {
    db.exec("ALTER TABLE capture_sessions ADD COLUMN organize_detail TEXT NOT NULL DEFAULT ''");
  }
  if (!sessionCols.has("organize_started_at")) {
    db.exec("ALTER TABLE capture_sessions ADD COLUMN organize_started_at TEXT");
  }
}

function ensureLocalAgents(db: Database.Database) {
  const dispatchCols = new Set(columnNames(db, "project_dispatch"));
  if (!dispatchCols.has("local_agents_saved")) {
    db.exec("ALTER TABLE project_dispatch ADD COLUMN local_agents_saved INTEGER NOT NULL DEFAULT 0");
  }
  if (!dispatchCols.has("organize_enabled")) {
    db.exec("ALTER TABLE project_dispatch ADD COLUMN organize_enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!dispatchCols.has("repair_local_enabled")) {
    db.exec("ALTER TABLE project_dispatch ADD COLUMN repair_local_enabled INTEGER NOT NULL DEFAULT 1");
  }
  const logCols = new Set(columnNames(db, "agent_dispatches"));
  if (!logCols.has("capture_session_id")) {
    db.exec("ALTER TABLE agent_dispatches ADD COLUMN capture_session_id INTEGER");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_local_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('cursor','zcode','command')),
      command TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_index INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_local_agents_project ON project_local_agents(project_id, sort_index);
  `);
}

function ensureProjectProfile(db: Database.Database) {
  const existing = new Set(columnNames(db, "projects"));
  for (const field of PROFILE_FIELDS) {
    if (existing.has(field.key)) continue;
    if (!/^[a-z_]+$/.test(field.key)) continue;
    db.exec(
      `ALTER TABLE projects ADD COLUMN ${field.key} TEXT NOT NULL DEFAULT ''`
    );
  }
}

function columnNames(db: Database.Database, table: string) {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((col) => col.name);
}

function ensureMemberRoles(db: Database.Database) {
  if (columnNames(db, "project_members").includes("role")) return;
  db.exec(
    "ALTER TABLE project_members ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'))"
  );
}

function ensureProjectCodes(db: Database.Database) {
  if (!columnNames(db, "projects").includes("code")) {
    db.exec("ALTER TABLE projects ADD COLUMN code TEXT");
  }
  const rows = db
    .prepare("SELECT id, name, slug, code FROM projects ORDER BY id")
    .all() as { id: number; name: string; slug: string; code: string | null }[];
  const taken = rows.flatMap((row) => (row.code ? [row.code] : []));
  const update = db.prepare("UPDATE projects SET code = ? WHERE id = ?");
  for (const row of rows) {
    if (row.code) continue;
    const code = allocateProjectCode(row.name, row.slug, taken);
    update.run(code, row.id);
    taken.push(code);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_code ON projects(code)");
}

function ensurePublicIds(db: Database.Database) {
  if (!columnNames(db, "bugs").includes("public_id")) {
    db.exec("ALTER TABLE bugs ADD COLUMN public_id TEXT");
  }
  const missing = db
    .prepare(
      `SELECT b.id, b.created_at, p.code AS code
       FROM bugs b
       JOIN projects p ON p.id = b.project_id
       WHERE b.public_id IS NULL OR b.public_id = ''
       ORDER BY b.created_at ASC, b.id ASC`
    )
    .all() as { id: number; created_at: string; code: string }[];
  if (missing.length > 0) {
    const taken = (
      db
        .prepare(
          "SELECT public_id FROM bugs WHERE public_id IS NOT NULL AND public_id != ''"
        )
        .all() as { public_id: string }[]
    ).map((row) => row.public_id);
    const update = db.prepare("UPDATE bugs SET public_id = ? WHERE id = ?");
    const fill = db.transaction(() => {
      for (const row of missing) {
        if (!row.code) throw new Error("项目缺少缩写，无法生成报障 ID");
        const publicId = nextPublicId(row.code, row.created_at, taken);
        update.run(publicId, row.id);
        taken.push(publicId);
      }
    });
    fill();
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_bugs_public_id ON bugs(public_id)");
}

function ensureSuperAdminRole(db: Database.Database) {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { sql: string } | undefined;
  if (table && !table.sql.includes("'superadmin'")) {
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('user','admin','superadmin')),
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO users_new (id, username, password_hash, role, active, created_at, updated_at)
        SELECT id, username, password_hash, role, active, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
    });
    db.pragma("foreign_keys = OFF");
    try {
      rebuild();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  const existing = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'superadmin'")
    .get() as { c: number };
  if (existing.c > 0) return;
  const candidate = db
    .prepare(
      "SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id ASC LIMIT 1"
    )
    .get() as { id: number } | undefined;
  if (!candidate) return;
  db.prepare("UPDATE users SET role = 'superadmin', updated_at = ? WHERE id = ?").run(
    nowIso(),
    candidate.id
  );
}

export function resetDbForTests() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function isSetupComplete() {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c > 0;
}
