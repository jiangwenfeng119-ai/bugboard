import Database from "better-sqlite3";
import { dbPath, ensureDataDirs } from "./paths";
import {
  storedWakeActionsWithReleaseHold,
  storedWakeActionsWithReleaseReturn,
} from "./behavior-shared";
import { PROFILE_FIELDS } from "./project-profile";
import { allocateProjectCode, nextPublicId } from "./ticket-id";

let _db: Database.Database | null = null;

const PROJECT_CHANGES_SCHEMA = `
CREATE TABLE IF NOT EXISTS project_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('fix','feature','chore','release')),
  title TEXT NOT NULL,
  summary TEXT,
  commit_shas TEXT NOT NULL DEFAULT '[]',
  branch TEXT,
  bug_ids TEXT,
  release_change_id INTEGER,
  trigger TEXT CHECK(trigger IS NULL OR trigger IN ('scheduled','manual','external')),
  result TEXT CHECK(result IS NULL OR result IN ('success','failed')),
  detail TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','api_key')),
  actor_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_changes_project ON project_changes(project_id, id);
`;

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
  session_version INTEGER NOT NULL DEFAULT 0,
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
  logo_path TEXT NOT NULL DEFAULT '',
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
  kind TEXT NOT NULL DEFAULT 'transition',
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
  deploy_mode TEXT NOT NULL DEFAULT 'none',
  deploy_command TEXT NOT NULL DEFAULT '',
  release_schedule TEXT NOT NULL DEFAULT '',
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
  claimed_at TEXT,
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

CREATE TABLE IF NOT EXISTS rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_events_bucket ON rate_events(bucket, at);
${PROJECT_CHANGES_SCHEMA}
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
  ensureSessionVersion(db);
  ensureProjectCodes(db);
  ensureProjectProfile(db);
  ensureProjectLogo(db);
  ensurePublicIds(db);
  ensureCaptureSchema(db);
  ensureLocalAgents(db);
  ensureReleaseConfig(db);
  ensureBehaviorConfig(db);
  ensureEventKind(db);
  ensureProjectChanges(db);
  ensureAsk(db);
  ensureSeeAlso(db);
}

function ensureSeeAlso(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bug_see_also (
      bug_id INTEGER NOT NULL PRIMARY KEY,
      see_bug_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE,
      FOREIGN KEY (see_bug_id) REFERENCES bugs(id) ON DELETE CASCADE,
      CHECK (bug_id <> see_bug_id)
    );
  `);
}

function ensureProjectChanges(db: Database.Database) {
  db.exec(PROJECT_CHANGES_SCHEMA);
  const cols = new Set(columnNames(db, "project_changes"));
  const adds: [string, string][] = [
    ["summary", "TEXT"],
    ["commit_shas", "TEXT NOT NULL DEFAULT '[]'"],
    ["branch", "TEXT"],
    ["bug_ids", "TEXT"],
    ["release_change_id", "INTEGER"],
    ["trigger", "TEXT"],
    ["result", "TEXT"],
    ["detail", "TEXT"],
    ["actor_type", "TEXT"],
    ["actor_id", "INTEGER"],
    ["created_at", "TEXT"],
  ];
  for (const [name, ddl] of adds) {
    if (!cols.has(name)) db.exec(`ALTER TABLE project_changes ADD COLUMN ${name} ${ddl}`);
  }
}

function ensureAsk(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ask_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('user','api_key')),
      actor_id INTEGER NOT NULL,
      thread_id TEXT NOT NULL,
      question TEXT NOT NULL,
      question_norm TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('streaming','done','failed','reverted')),
      judgment TEXT NOT NULL DEFAULT '',
      answer TEXT NOT NULL DEFAULT '',
      status_line TEXT NOT NULL DEFAULT '',
      mirror_sha TEXT NOT NULL DEFAULT '',
      cached_from_id INTEGER,
      session_id TEXT NOT NULL DEFAULT '',
      seq INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      force INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ask_mirrors (
      project_id INTEGER PRIMARY KEY,
      head_sha TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ask_cache ON ask_runs(project_id, question_norm, mirror_sha, status);
    CREATE INDEX IF NOT EXISTS idx_ask_thread ON ask_runs(project_id, thread_id, id);

    CREATE TABLE IF NOT EXISTS ask_optimizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ask_run_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      actor_type TEXT NOT NULL CHECK(actor_type IN ('user','api_key')),
      actor_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      judgment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('queued','sent','failed','done','reverting','reverted')),
      prompt TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      diff_text TEXT NOT NULL DEFAULT '',
      commit_sha TEXT NOT NULL DEFAULT '',
      revert_sha TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (ask_run_id) REFERENCES ask_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ask_opt_run ON ask_optimizations(ask_run_id, id);

    CREATE TABLE IF NOT EXISTS ask_optimization_runs (
      optimization_id INTEGER NOT NULL,
      ask_run_id INTEGER NOT NULL,
      PRIMARY KEY (optimization_id, ask_run_id),
      FOREIGN KEY (optimization_id) REFERENCES ask_optimizations(id) ON DELETE CASCADE,
      FOREIGN KEY (ask_run_id) REFERENCES ask_runs(id) ON DELETE CASCADE
    );
    INSERT OR IGNORE INTO ask_optimization_runs (optimization_id, ask_run_id)
    SELECT id, ask_run_id FROM ask_optimizations;

    CREATE TABLE IF NOT EXISTS ask_maps (
      project_id INTEGER PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      mirror_sha TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ask_graphs (
      project_id INTEGER PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      mirror_sha TEXT NOT NULL DEFAULT '',
      html_path TEXT NOT NULL DEFAULT '',
      node_count INTEGER NOT NULL DEFAULT 0,
      edge_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  const cols = new Set(columnNames(db, "ask_runs"));
  if (!cols.has("queued")) db.exec("ALTER TABLE ask_runs ADD COLUMN queued INTEGER NOT NULL DEFAULT 0");
  if (!cols.has("payload")) db.exec("ALTER TABLE ask_runs ADD COLUMN payload TEXT NOT NULL DEFAULT ''");
}

function ensureEventKind(db: Database.Database) {
  const cols = new Set(columnNames(db, "bug_status_events"));
  if (!cols.has("kind")) {
    db.exec(
      "ALTER TABLE bug_status_events ADD COLUMN kind TEXT NOT NULL DEFAULT 'transition'"
    );
  }
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

function ensureReleaseConfig(db: Database.Database) {
  const cols = new Set(columnNames(db, "project_dispatch"));
  if (!cols.has("deploy_mode")) {
    db.exec("ALTER TABLE project_dispatch ADD COLUMN deploy_mode TEXT NOT NULL DEFAULT 'none'");
  }
  if (!cols.has("deploy_command")) {
    db.exec("ALTER TABLE project_dispatch ADD COLUMN deploy_command TEXT NOT NULL DEFAULT ''");
  }
  if (!cols.has("release_schedule")) {
    db.exec("ALTER TABLE project_dispatch ADD COLUMN release_schedule TEXT NOT NULL DEFAULT ''");
  }
  const dispatchCols = new Set(columnNames(db, "agent_dispatches"));
  if (!dispatchCols.has("claimed_at")) {
    db.exec("ALTER TABLE agent_dispatches ADD COLUMN claimed_at TEXT");
  }
}

function ensureBehaviorConfig(db: Database.Database) {
  const cols = new Set(columnNames(db, "project_dispatch"));
  const add = (name: string, ddl: string) => {
    if (!cols.has(name)) db.exec(`ALTER TABLE project_dispatch ADD COLUMN ${ddl}`);
  };
  add("wake_on_web_create", "wake_on_web_create INTEGER NOT NULL DEFAULT 1");
  add("wake_on_widget_create", "wake_on_widget_create INTEGER NOT NULL DEFAULT 1");
  add("wake_on_capture_create", "wake_on_capture_create INTEGER NOT NULL DEFAULT 1");
  add("wake_on_api_create", "wake_on_api_create INTEGER NOT NULL DEFAULT 0");
  add(
    "wake_actions",
    "wake_actions TEXT NOT NULL DEFAULT 'provide_info,reject_fix,release_return,release_hold,dispute_invalid,reopen_invalid,supplement,accept_product'"
  );
  const rows = db
    .prepare("SELECT project_id, wake_actions FROM project_dispatch")
    .all() as { project_id: number; wake_actions: string }[];
  const update = db.prepare(
    "UPDATE project_dispatch SET wake_actions = ? WHERE project_id = ?"
  );
  for (const row of rows) {
    const next = storedWakeActionsWithReleaseHold(
      storedWakeActionsWithReleaseReturn(row.wake_actions)
    );
    if (next !== row.wake_actions) update.run(next, row.project_id);
  }
  add("wake_drain_queue", "wake_drain_queue INTEGER NOT NULL DEFAULT 1");
  add("intake_priority", "intake_priority TEXT NOT NULL DEFAULT 'p2'");
  add("inbox_show_pending", "inbox_show_pending INTEGER NOT NULL DEFAULT 1");
  add("inbox_show_needs_product", "inbox_show_needs_product INTEGER NOT NULL DEFAULT 1");
  add("inbox_show_ready", "inbox_show_ready INTEGER NOT NULL DEFAULT 1");
  add("inbox_show_own_fixing", "inbox_show_own_fixing INTEGER NOT NULL DEFAULT 1");
  add("inbox_pending_cap", "inbox_pending_cap INTEGER NOT NULL DEFAULT 8");
  add("release_advances_bugs", "release_advances_bugs INTEGER NOT NULL DEFAULT 1");
  add("release_timeout_min", "release_timeout_min INTEGER NOT NULL DEFAULT 45");
  add("capture_gap_ms", "capture_gap_ms INTEGER NOT NULL DEFAULT 1200");
  add("capture_short_chars", "capture_short_chars INTEGER NOT NULL DEFAULT 8");
  add("organize_timeout_min", "organize_timeout_min INTEGER NOT NULL DEFAULT 8");
  add("ask_enabled", "ask_enabled INTEGER NOT NULL DEFAULT 1");
  add("ask_per_hour", "ask_per_hour INTEGER NOT NULL DEFAULT 20");
}

function ensureProjectLogo(db: Database.Database) {
  if (columnNames(db, "projects").includes("logo_path")) return;
  db.exec("ALTER TABLE projects ADD COLUMN logo_path TEXT NOT NULL DEFAULT ''");
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
  db.exec(
    `UPDATE project_members
     SET role = 'admin'
     WHERE user_id IN (SELECT id FROM users WHERE role IN ('admin', 'superadmin'))`
  );
}

function ensureSessionVersion(db: Database.Database) {
  if (columnNames(db, "users").includes("session_version")) return;
  db.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
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

let _usageDb: Database.Database | null = null;

/** 使用次数写在另一条连接上，锁冲突时放弃这次计数，不让鉴权失败。 */
export function recordApiKeyUse(id: number) {
  try {
    if (!_usageDb) {
      _usageDb = new Database(dbPath(), { timeout: 50 });
      _usageDb.pragma("journal_mode = WAL");
    }
    _usageDb
      .prepare(
        "UPDATE api_keys SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?"
      )
      .run(nowIso(), id);
  } catch {
    // 主连接正占着写锁时，这次计数可以丢，Key 仍然有效
  }
}

export function resetDbForTests() {
  if (_usageDb) {
    _usageDb.close();
    _usageDb = null;
  }
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
