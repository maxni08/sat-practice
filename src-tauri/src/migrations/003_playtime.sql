BEGIN IMMEDIATE;
CREATE TABLE IF NOT EXISTS playtime_summary (
  id INTEGER PRIMARY KEY CHECK(id=1),
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);
PRAGMA user_version=3;
COMMIT;
