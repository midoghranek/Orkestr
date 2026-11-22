export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  budget_usd REAL NOT NULL DEFAULT 0,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX workflows_project ON workflows(project_id);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  preauthorized_usd REAL NOT NULL DEFAULT 0,
  spent_usd REAL NOT NULL DEFAULT 0,
  force_nodes_json TEXT NOT NULL DEFAULT '[]',
  parent_run_id TEXT,
  error TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX runs_status ON runs(status);
CREATE INDEX runs_project ON runs(project_id);

CREATE TABLE node_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  signature TEXT,
  inputs_json TEXT NOT NULL DEFAULT '{}',
  outputs_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  estimate_json TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  cached_from TEXT,
  progress REAL NOT NULL DEFAULT 0,
  progress_message TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  heartbeat_at INTEGER,
  worker_id TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  UNIQUE(run_id, node_id)
);
CREATE INDEX node_runs_status ON node_runs(status, next_attempt_at);
CREATE INDEX node_runs_signature ON node_runs(signature, status);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_s REAL,
  fps REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parents_json TEXT NOT NULL DEFAULT '[]',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  node_run_id TEXT,
  scene_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX assets_project ON assets(project_id, kind);
CREATE INDEX assets_sha ON assets(sha256);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  node_run_id TEXT,
  project_id TEXT,
  level TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX events_run ON events(run_id, id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  node_run_id TEXT,
  scene_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  amount_usd REAL,
  amount_known INTEGER NOT NULL DEFAULT 1,
  decided_note TEXT,
  requested_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX approvals_status ON approvals(status);

CREATE TABLE cost_ledger (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  node_run_id TEXT,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_usd REAL,
  known INTEGER NOT NULL,
  unit TEXT,
  quantity REAL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  note TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX cost_project ON cost_ledger(project_id);

CREATE TABLE scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  storyboard TEXT NOT NULL DEFAULT 'main',
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  duration_s REAL NOT NULL,
  aspect TEXT NOT NULL DEFAULT '16:9',
  prompt TEXT NOT NULL DEFAULT '',
  narration TEXT NOT NULL DEFAULT '',
  on_screen_text TEXT NOT NULL DEFAULT '',
  camera TEXT NOT NULL DEFAULT '',
  constraints_json TEXT NOT NULL DEFAULT '[]',
  references_json TEXT NOT NULL DEFAULT '[]',
  tool TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  selected_asset_id TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX scenes_project ON scenes(project_id, storyboard, idx);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE credentials (
  provider TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  hint TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tool_registry (
  tool_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  brief TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_json TEXT,
  error TEXT,
  model TEXT,
  cost_usd REAL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
`,
  },
];
