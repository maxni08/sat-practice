CREATE TABLE IF NOT EXISTS question_sources (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  present INTEGER NOT NULL DEFAULT 1,
  file_path TEXT,
  file_size INTEGER,
  file_mtime INTEGER,
  digest TEXT,
  report_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS library_questions (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  question_json TEXT NOT NULL CHECK(json_valid(question_json)),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS library_questions_source_active ON library_questions(source_id, active);
CREATE INDEX IF NOT EXISTS library_questions_external ON library_questions(source_id, external_id);
INSERT OR IGNORE INTO question_sources(id,name,source_type,version,enabled,present,report_json)
VALUES('personal','Personal Questions','personal','1',1,1,'{}');
PRAGMA user_version=5;
