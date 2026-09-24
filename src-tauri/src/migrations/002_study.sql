BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS study_profile (
  id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL,
  total_xp INTEGER NOT NULL CHECK(total_xp>=0), level INTEGER NOT NULL CHECK(level>=1),
  profile_json TEXT NOT NULL CHECK(json_valid(profile_json))
);
CREATE TABLE IF NOT EXISTS study_evidence (id TEXT PRIMARY KEY NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)));
CREATE TABLE IF NOT EXISTS skill_mastery (id TEXT PRIMARY KEY NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)));
CREATE TABLE IF NOT EXISTS review_schedule (id TEXT PRIMARY KEY NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)));
CREATE TABLE IF NOT EXISTS study_achievements (id TEXT PRIMARY KEY NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)));
CREATE TABLE IF NOT EXISTS module_history (id TEXT PRIMARY KEY NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)));
CREATE TABLE IF NOT EXISTS module_answers (
  module_id TEXT NOT NULL REFERENCES module_history(id), question_id TEXT NOT NULL,
  answer_json TEXT NOT NULL CHECK(json_valid(answer_json)), PRIMARY KEY(module_id,question_id)
);
CREATE TABLE IF NOT EXISTS study_commits (id TEXT PRIMARY KEY NOT NULL,committed_at TEXT NOT NULL);
PRAGMA user_version=2;
COMMIT;
