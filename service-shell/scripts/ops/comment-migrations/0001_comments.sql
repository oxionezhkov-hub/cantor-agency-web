CREATE TABLE workspace_comments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  section TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  target TEXT NOT NULL,
  text TEXT NOT NULL,
  diagnostics TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'fixed')),
  audio BLOB,
  audio_type TEXT,
  screenshot BLOB,
  transcript TEXT,
  transcription_status TEXT CHECK (transcription_status IN ('pending', 'processing', 'complete', 'failed')),
  transcription_attempt TEXT,
  transcription_started_at INTEGER
);

CREATE INDEX workspace_comments_workspace_date ON workspace_comments (workspace_id, created_at DESC);

CREATE TABLE commenter_unlock_attempts (
  workspace_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  time_window INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, employee_id)
);
