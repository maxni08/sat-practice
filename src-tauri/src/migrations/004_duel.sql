CREATE TABLE IF NOT EXISTS duel_history (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);
PRAGMA user_version = 4;
