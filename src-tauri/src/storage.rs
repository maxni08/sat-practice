use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::Path, time::Duration};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub field: String,
    pub start: usize,
    pub end: usize,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub attempts: u32,
    pub correct_attempts: u32,
    pub incorrect_attempts: u32,
    pub last_answer: String,
    pub last_result: Option<bool>,
    pub total_time_spent: f64,
    pub last_attempt_date: Option<String>,
    pub bookmark: bool,
    pub notes: String,
    pub highlights: Vec<Highlight>,
}

#[derive(Debug, Serialize)]
pub struct SavedState {
    pub progress: HashMap<String, Progress>,
    pub session: Option<Value>,
}

pub struct Store {
    connection: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create progress directory: {e}"))?;
        }
        let connection = Connection::open(path)
            .map_err(|e| format!("Cannot open local progress database: {e}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0)).map_err(|e| e.to_string())?;
        if version > 4 { return Err("This database belongs to a newer SAT Practice version. Use that version to preserve your progress.".into()); }
        if version == 1 {
            let backup = path.with_file_name("progress-before-v2.sqlite3");
            if !backup.exists() {
                connection.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                    .map_err(|e| format!("Cannot back up existing progress before migration: {e}"))?;
            }
        }
        if version == 2 {
            let backup = path.with_file_name("progress-before-v3.sqlite3");
            if !backup.exists() {
                connection.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                    .map_err(|e| format!("Cannot back up existing progress before playtime migration: {e}"))?;
            }
        }
        if version == 3 {
            let backup = path.with_file_name("progress-before-v4.sqlite3");
            if !backup.exists() {
                connection.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])
                    .map_err(|e| format!("Cannot back up existing progress before Local 1v1 migration: {e}"))?;
            }
        }
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             PRAGMA foreign_keys=ON;
             CREATE TABLE IF NOT EXISTS question_progress (
               question_id TEXT PRIMARY KEY NOT NULL,
               progress_json TEXT NOT NULL CHECK(json_valid(progress_json))
             );
             CREATE TABLE IF NOT EXISTS active_session (
               id INTEGER PRIMARY KEY CHECK(id = 1),
               session_json TEXT NOT NULL CHECK(json_valid(session_json))
             );
             ",
            )
            .map_err(|e| format!("Cannot initialize local progress database: {e}"))?;
        if version < 2 {
            connection.execute_batch(include_str!("migrations/002_study.sql"))
                .map_err(|e| format!("Cannot migrate study data; the original progress is preserved: {e}"))?;
        }
        if version < 3 {
            connection.execute_batch(include_str!("migrations/003_playtime.sql"))
                .map_err(|e| format!("Cannot migrate playtime data; the original progress is preserved: {e}"))?;
        }
        if version < 4 {
            connection.execute_batch(include_str!("migrations/004_duel.sql"))
                .map_err(|e| format!("Cannot migrate Local 1v1 history; the original progress is preserved: {e}"))?;
        }
        Ok(Self { connection })
    }

    pub fn load_duel_history(&self) -> Result<Option<Value>, String> {
        let json: Option<String> = self.connection.query_row(
            "SELECT data_json FROM duel_history WHERE id=1", [], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        json.map(|value| serde_json::from_str(&value).map_err(|e| format!("Invalid Local 1v1 history: {e}"))).transpose()
    }

    pub fn save_duel_history(&mut self, data: &Value) -> Result<(), String> {
        if data["version"].as_u64()!=Some(1) || data["matches"].as_array().filter(|items|items.len()<=200).is_none() {
            return Err("Invalid Local 1v1 history".into());
        }
        self.connection.execute(
            "INSERT INTO duel_history(id,data_json) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json",
            [data.to_string()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_playtime(&self) -> Result<Option<Value>, String> {
        let json: Option<String> = self.connection.query_row(
            "SELECT data_json FROM playtime_summary WHERE id=1",
            [],
            |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        json.map(|value| serde_json::from_str(&value).map_err(|e| format!("Invalid playtime data: {e}"))).transpose()
    }

    pub fn save_playtime(&mut self, data: &Value) -> Result<(), String> {
        Self::validate_playtime(data)?;
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        transaction.execute(
            "INSERT INTO playtime_summary(id,data_json) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json",
            [data.to_string()],
        ).map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())
    }

    pub fn load_study(&self) -> Result<Option<Value>, String> {
        let profile: Option<String> = self.connection.query_row("SELECT profile_json FROM study_profile WHERE id=1", [], |row| row.get(0)).optional().map_err(|e|e.to_string())?;
        let Some(profile) = profile else { return Ok(None) };
        let mut state: Value = serde_json::from_str(&profile).map_err(|e|format!("Invalid study profile: {e}"))?;
        for (field, table) in [("evidence","study_evidence"),("skills","skill_mastery"),("reviews","review_schedule"),("achievements","study_achievements")] {
            let mut map=serde_json::Map::new();
            let mut stmt=self.connection.prepare(&format!("SELECT id,data_json FROM {table}")).map_err(|e|e.to_string())?;
            let rows=stmt.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
            for row in rows { let (id,json)=row.map_err(|e|e.to_string())?;map.insert(id,serde_json::from_str(&json).map_err(|e|e.to_string())?); }
            state[field]=Value::Object(map);
        }
        let mut modules=Vec::new();
        let mut stmt=self.connection.prepare("SELECT data_json FROM module_history ORDER BY json_extract(data_json,'$.date'), id").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|row|row.get::<_,String>(0)).map_err(|e|e.to_string())?;
        for row in rows { modules.push(serde_json::from_str::<Value>(&row.map_err(|e|e.to_string())?).map_err(|e|e.to_string())?); }
        state["modules"]=Value::Array(modules);
        Ok(Some(state))
    }

    // All study consequences of an answer/module and its legacy progress update
    // commit atomically. Event IDs make retrying a completed operation harmless.
    pub fn commit_study(&mut self, event_id: &str, expected_revision: i64, study: &Value, updates: &HashMap<String,Progress>, session: Option<&Value>, removed: &[String]) -> Result<(),String> {
        if event_id.is_empty() || event_id.len()>256 {return Err("Invalid study event ID".into());}
        for (id,p) in updates {Self::validate(id,p)?;}
        if study["version"].as_u64()!=Some(2) || study["revision"].as_i64()!=Some(expected_revision+1) {return Err("Invalid study revision".into());}
        let xp=study["xp"].as_u64().filter(|n|*n<=1_000_000_000).ok_or("Invalid study XP")?;
        let transaction=self.connection.transaction().map_err(|e|e.to_string())?;
        let applied:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM study_commits WHERE id=?1)",[event_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if applied {return Ok(());}
        let revision:i64=transaction.query_row("SELECT COALESCE((SELECT revision FROM study_profile WHERE id=1),0)",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if revision!=expected_revision{return Err("Study data changed in another operation. Reopen SAT Practice before retrying.".into());}
        let mut profile=study.clone();
        let object=profile.as_object_mut().ok_or("Invalid study profile")?;
        for field in ["evidence","skills","reviews","achievements","modules"] {object.remove(field);}
        let level=((1.0+(1.0+4.0*xp as f64/25.0).sqrt())/2.0).floor() as i64;
        transaction.execute("INSERT INTO study_profile(id,revision,total_xp,level,profile_json) VALUES(1,?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,total_xp=excluded.total_xp,level=excluded.level,profile_json=excluded.profile_json",params![expected_revision+1,xp,level,profile.to_string()]).map_err(|e|e.to_string())?;
        for (field,table) in [("evidence","study_evidence"),("skills","skill_mastery"),("reviews","review_schedule"),("achievements","study_achievements")] {
            let map=study[field].as_object().ok_or_else(||format!("Invalid study {field}"))?;
            let mut stmt=transaction.prepare(&format!("INSERT INTO {table}(id,data_json) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json WHERE data_json<>excluded.data_json")).map_err(|e|e.to_string())?;
            for(id,value)in map {stmt.execute(params![id,value.to_string()]).map_err(|e|e.to_string())?;}
        }
        for record in study["modules"].as_array().ok_or("Invalid module history")? {
            let id=record["id"].as_str().ok_or("Invalid module ID")?;
            transaction.execute("INSERT INTO module_history(id,data_json) VALUES(?1,?2) ON CONFLICT(id) DO NOTHING",params![id,record.to_string()]).map_err(|e|e.to_string())?;
            let answers=record["session"]["answers"].as_object().ok_or("Invalid module answers")?;
            for(question_id,answer)in answers {transaction.execute("INSERT INTO module_answers(module_id,question_id,answer_json) VALUES(?1,?2,?3) ON CONFLICT(module_id,question_id) DO NOTHING",params![id,question_id,answer.to_string()]).map_err(|e|e.to_string())?;}
        }
        for id in removed {
            for table in ["study_evidence","review_schedule"] {transaction.execute(&format!("DELETE FROM {table} WHERE id=?1"),[id]).map_err(|e|e.to_string())?;}
            transaction.execute("DELETE FROM question_progress WHERE question_id=?1",[id]).map_err(|e|e.to_string())?;
        }
        for(id,p)in updates {Self::write_progress(&transaction,id,p)?;}
        Self::write_session(&transaction,session)?;
        transaction.execute("INSERT INTO study_commits(id,committed_at) VALUES(?1,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",[event_id]).map_err(|e|e.to_string())?;
        transaction.commit().map_err(|e|e.to_string())
    }

    pub fn load(&self) -> Result<SavedState, String> {
        let mut progress = HashMap::new();
        let mut statement = self
            .connection
            .prepare("SELECT question_id, progress_json FROM question_progress")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, json) = row.map_err(|e| e.to_string())?;
            let value = serde_json::from_str(&json)
                .map_err(|e| format!("Saved progress for {id} is invalid: {e}"))?;
            progress.insert(id, value);
        }
        let session_json: Option<String> = self
            .connection
            .query_row(
                "SELECT session_json FROM active_session WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let session = session_json
            .map(|json| serde_json::from_str(&json))
            .transpose()
            .map_err(|e| format!("Saved session is invalid: {e}"))?;
        Ok(SavedState { progress, session })
    }

    pub fn save_progress(&mut self, id: &str, progress: &Progress) -> Result<(), String> {
        Self::validate(id, progress)?;
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        Self::write_progress(&transaction, id, progress)?;
        transaction.commit().map_err(|e| e.to_string())
    }

    pub fn save_session(&mut self, session: Option<&Value>) -> Result<(), String> {
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        Self::write_session(&transaction, session)?;
        transaction.commit().map_err(|e| e.to_string())
    }

    // An answer and its session checkpoint become durable together or neither does.
    pub fn save_attempt(
        &mut self,
        id: &str,
        progress: &Progress,
        session: Option<&Value>,
    ) -> Result<(), String> {
        Self::validate(id, progress)?;
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        Self::write_progress(&transaction, id, progress)?;
        Self::write_session(&transaction, session)?;
        transaction.commit().map_err(|e| e.to_string())
    }

    pub fn reset_question(&mut self, id: &str) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM question_progress WHERE question_id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_progress(
        transaction: &Transaction<'_>,
        id: &str,
        progress: &Progress,
    ) -> Result<(), String> {
        let json = serde_json::to_string(progress).map_err(|e| e.to_string())?;
        transaction.execute("INSERT INTO question_progress(question_id, progress_json) VALUES (?1, ?2) ON CONFLICT(question_id) DO UPDATE SET progress_json=excluded.progress_json", params![id, json]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn write_session(transaction: &Transaction<'_>, session: Option<&Value>) -> Result<(), String> {
        if let Some(session) = session {
            let json = serde_json::to_string(session).map_err(|e| e.to_string())?;
            transaction.execute("INSERT INTO active_session(id, session_json) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET session_json=excluded.session_json", [json]).map_err(|e| e.to_string())?;
        } else {
            transaction
                .execute("DELETE FROM active_session WHERE id=1", [])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn validate(id: &str, progress: &Progress) -> Result<(), String> {
        if id.is_empty() || id.len() > 256 {
            return Err("Invalid question ID".into());
        }
        if progress
            .correct_attempts
            .checked_add(progress.incorrect_attempts)
            != Some(progress.attempts)
        {
            return Err("Attempt counts are inconsistent".into());
        }
        if !progress.total_time_spent.is_finite() || progress.total_time_spent < 0.0 {
            return Err("Time spent must be a finite nonnegative number".into());
        }
        for highlight in &progress.highlights {
            if !matches!(highlight.field.as_str(), "passage" | "stem")
                || highlight.start >= highlight.end
            {
                return Err("Invalid highlight range".into());
            }
        }
        Ok(())
    }

    fn validate_playtime(data: &Value) -> Result<(), String> {
        if data["version"].as_u64() != Some(1)
            || data["trackingSince"].as_str().is_none()
        {
            return Err("Invalid playtime summary".into());
        }
        for field in ["totalSeconds", "historicalSeconds"] {
            let value = data[field].as_f64().filter(|n| n.is_finite() && *n >= 0.0 && *n <= 1.0e12);
            if value.is_none() { return Err("Invalid playtime duration".into()); }
        }
        for field in ["byDay", "byMode"] {
            let values = data[field].as_object().ok_or("Invalid playtime breakdown")?;
            if values.len() > 100_000 { return Err("Playtime breakdown is too large".into()); }
            for value in values.values() {
                if value.as_f64().filter(|n| n.is_finite() && *n >= 0.0 && *n <= 1.0e12).is_none() {
                    return Err("Invalid playtime breakdown duration".into());
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn progress() -> Progress {
        Progress {
            attempts: 1,
            correct_attempts: 0,
            incorrect_attempts: 1,
            last_answer: "2/3".into(),
            last_result: Some(false),
            total_time_spent: 41.5,
            last_attempt_date: Some("2026-09-08T00:00:00Z".into()),
            bookmark: true,
            notes: "Check signs. \"x\"".into(),
            highlights: vec![Highlight {
                field: "passage".into(),
                start: 2,
                end: 8,
                color: "yellow".into(),
            }],
        }
    }

    #[test]
    fn progress_and_interrupted_session_survive_reopen_in_path_with_spaces() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("Profile with spaces")
            .join("progress.sqlite3");
        let session = json!({"ids":["abc123"],"index":0,"answers":{"abc123":{"answer":"2/3","submitted":true}}});
        {
            let mut store = Store::open(&path).unwrap();
            store
                .save_attempt("abc123", &progress(), Some(&session))
                .unwrap();
        }
        let state = Store::open(&path).unwrap().load().unwrap();
        assert_eq!(state.progress["abc123"].last_answer, "2/3");
        assert_eq!(state.progress["abc123"].notes, "Check signs. \"x\"");
        assert_eq!(state.progress["abc123"].highlights[0].end, 8);
        assert_eq!(state.session, Some(session));
    }

    #[test]
    fn invalid_attempt_does_not_change_progress_or_session() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::open(&directory.path().join("progress.sqlite3")).unwrap();
        store
            .save_attempt("q", &progress(), Some(&json!({"index":1})))
            .unwrap();
        let mut invalid = progress();
        invalid.attempts = 10;
        assert!(store
            .save_attempt("q", &invalid, Some(&json!({"index":2})))
            .is_err());
        let state = store.load().unwrap();
        assert_eq!(state.progress["q"].attempts, 1);
        assert_eq!(state.session, Some(json!({"index":1})));
    }

    #[test]
    fn transaction_rolls_back_when_session_write_fails() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::open(&directory.path().join("progress.sqlite3")).unwrap();
        store.connection.execute_batch("CREATE TRIGGER fail_session BEFORE INSERT ON active_session BEGIN SELECT RAISE(FAIL, 'simulated failure'); END;").unwrap();
        assert!(store
            .save_attempt("q", &progress(), Some(&json!({"index":1})))
            .is_err());
        assert!(store.load().unwrap().progress.is_empty());
    }

    #[test]
    fn reset_only_removes_the_target_question() {
        let directory = tempfile::tempdir().unwrap();
        let mut store = Store::open(&directory.path().join("progress.sqlite3")).unwrap();
        store.save_progress("q1", &progress()).unwrap();
        store.save_progress("q2", &progress()).unwrap();
        store.reset_question("q1").unwrap();
        let state = store.load().unwrap();
        assert!(!state.progress.contains_key("q1"));
        assert!(state.progress.contains_key("q2"));
        store.save_session(Some(&json!({"active":true}))).unwrap();
        store.save_session(None).unwrap();
        assert!(store.load().unwrap().session.is_none());
    }

    fn study(revision: i64, xp: u64) -> Value {
        json!({"version":2,"revision":revision,"xp":xp,"initializedAt":"2026-09-08T00:00:00Z",
            "credits":{"q":{"base":true,"correction":false}},"adaptive":{"Math":{"level":"Medium","correctRun":1,"recent":[true]}},
            "skillAwards":{},"completedSessions":{"module-1":"2026-09-08T00:00:00Z"},"milestones":{},
            "evidence":{"q":[{"at":"2026-09-08T00:00:00Z","correct":true,"seconds":42,"mode":"module"}]},
            "skills":{"Math::Algebra":{"score":68,"state":"Developing"}},
            "reviews":{"q":{"dueAt":"2026-09-11T00:00:00Z","streak":1,"misses":1}},
            "achievements":{"first-question":"2026-09-08T00:00:00Z"},
            "modules":[{"id":"module-1","date":"2026-09-08T00:00:00Z","score":1,"session":{"answers":{"q":{"answer":"2/3","correct":true,"timeSpent":42}}}}]})
    }

    #[test]
    fn migration_preserves_real_v1_rows_and_creates_a_consistent_backup() {
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("progress.sqlite3");
        let old_json=serde_json::to_string(&progress()).unwrap();
        {
            let db=Connection::open(&path).unwrap();
            db.execute_batch("CREATE TABLE question_progress(question_id TEXT PRIMARY KEY NOT NULL,progress_json TEXT NOT NULL CHECK(json_valid(progress_json))); CREATE TABLE active_session(id INTEGER PRIMARY KEY CHECK(id=1),session_json TEXT NOT NULL CHECK(json_valid(session_json))); PRAGMA user_version=1;").unwrap();
            db.execute("INSERT INTO question_progress VALUES('legacy',?1)",[&old_json]).unwrap();
            db.execute("INSERT INTO active_session VALUES(1,?1)",[json!({"id":"interrupted-v1","drafts":{"legacy":"-3/2"}}).to_string()]).unwrap();
        }
        let store=Store::open(&path).unwrap();
        let unchanged:String=store.connection.query_row("SELECT progress_json FROM question_progress WHERE question_id='legacy'",[],|r|r.get(0)).unwrap();
        assert_eq!(unchanged,old_json);
        assert_eq!(store.load().unwrap().session.unwrap()["drafts"]["legacy"],"-3/2");
        assert_eq!(store.load().unwrap().progress["legacy"].notes,progress().notes);
        assert!(store.load_study().unwrap().is_none());
        let backup=Connection::open(directory.path().join("progress-before-v2.sqlite3")).unwrap();
        assert_eq!(backup.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(backup.query_row("SELECT progress_json FROM question_progress",[],|r|r.get::<_,String>(0)).unwrap(),old_json);
        drop(store);
        assert_eq!(Store::open(&path).unwrap().connection.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),4);
    }

    #[test]
    fn all_study_fields_and_module_answers_survive_real_database_reopen() {
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("Profile with spaces").join("progress.sqlite3");
        let expected=study(1,150);let updates=HashMap::from([("q".to_string(),progress())]);
        {
            let mut store=Store::open(&path).unwrap();
            store.commit_study("module-1:complete",0,&expected,&updates,Some(&json!({"id":"module-1","finished":true})),&[]).unwrap();
        }
        let store=Store::open(&path).unwrap();assert_eq!(store.load_study().unwrap(),Some(expected));
        assert_eq!(store.load().unwrap().progress["q"].notes,progress().notes);
        assert_eq!(store.connection.query_row("SELECT level FROM study_profile",[],|r|r.get::<_,i64>(0)).unwrap(),3);
        assert_eq!(store.connection.query_row("SELECT json_extract(answer_json,'$.answer') FROM module_answers WHERE module_id='module-1' AND question_id='q'",[],|r|r.get::<_,String>(0)).unwrap(),"2/3");
    }

    #[test]
    fn achievement_catalog_extension_keeps_xp_and_legacy_data_after_reopen() {
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("achievement upgrade.sqlite3");
        let mut original=study(1,1234);
        original["achievements"]=json!({"first-question":"2026-08-01T12:00:00Z","level-5":"2026-08-02T12:00:00Z"});
        let mut extended=original.clone();extended["revision"]=json!(2);
        extended["trophies"]=json!({"version":2,"backfilled":{"explore-250":true},"awardedXp":{},"run":["q"],"weak":{"Math::Algebra":{"at":"2026-09-01T00:00:00Z","recommended":true}},"sessions":[]});
        extended["achievements"]["explore-250"]=json!("2026-09-09T00:00:00Z");
        {
            let mut store=Store::open(&path).unwrap();
            store.commit_study("legacy",0,&original,&HashMap::from([("q".into(),progress())]),None,&[]).unwrap();
            store.commit_study("catalog-v2",1,&extended,&HashMap::new(),None,&[]).unwrap();
        }
        let store=Store::open(&path).unwrap();
        assert_eq!(store.load_study().unwrap(),Some(extended));
        assert_eq!(store.load().unwrap().progress["q"].notes,progress().notes);
        assert_eq!(store.connection.query_row("SELECT total_xp FROM study_profile",[],|r|r.get::<_,i64>(0)).unwrap(),1234);
    }

    #[test]
    fn retrying_a_study_event_cannot_duplicate_xp_or_module_history() {
        let directory=tempfile::tempdir().unwrap();let mut store=Store::open(&directory.path().join("progress.sqlite3")).unwrap();
        store.commit_study("unique-event",0,&study(1,150),&HashMap::new(),None,&[]).unwrap();
        store.commit_study("unique-event",1,&study(2,999),&HashMap::new(),None,&[]).unwrap();
        assert_eq!(store.load_study().unwrap().unwrap()["xp"],150);
        assert_eq!(store.connection.query_row("SELECT COUNT(*) FROM module_history",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert!(store.commit_study("different-event",0,&study(1,999),&HashMap::new(),None,&[]).is_err());
    }

    #[test]
    fn failed_module_answer_write_rolls_back_xp_and_legacy_progress() {
        let directory=tempfile::tempdir().unwrap();let mut store=Store::open(&directory.path().join("progress.sqlite3")).unwrap();
        store.connection.execute_batch("CREATE TRIGGER fail_module BEFORE INSERT ON module_answers BEGIN SELECT RAISE(FAIL,'test failure'); END;").unwrap();
        let updates=HashMap::from([("q".to_string(),progress())]);
        assert!(store.commit_study("module",0,&study(1,100),&updates,Some(&json!({"finished":true})),&[]).is_err());
        assert!(store.load_study().unwrap().is_none());assert!(store.load().unwrap().progress.is_empty());assert!(store.load().unwrap().session.is_none());
    }

    #[test]
    fn scoped_reset_retains_rewards_and_module_history_to_prevent_farming() {
        let directory=tempfile::tempdir().unwrap();let mut store=Store::open(&directory.path().join("progress.sqlite3")).unwrap();
        store.commit_study("initial",0,&study(1,150),&HashMap::from([("q".to_string(),progress())]),None,&[]).unwrap();
        let mut reset=study(2,150);reset["evidence"]=json!({});reset["reviews"]=json!({});
        store.commit_study("reset",1,&reset,&HashMap::new(),None,&["q".into()]).unwrap();
        let loaded=store.load_study().unwrap().unwrap();assert_eq!(loaded["xp"],150);assert!(loaded["evidence"].as_object().unwrap().is_empty());assert_eq!(loaded["modules"].as_array().unwrap().len(),1);assert!(store.load().unwrap().progress.is_empty());
    }

    #[test]
    fn future_schema_is_never_silently_downgraded() {
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("future.sqlite3");
        Connection::open(&path).unwrap().execute_batch("PRAGMA user_version=99;").unwrap();
        assert!(Store::open(&path).is_err());
        assert_eq!(Connection::open(path).unwrap().pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),99);
    }

    #[test]
    fn playtime_migration_preserves_v2_data_and_survives_reopen() {
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("existing v2.sqlite3");
        {
            let mut store=Store::open(&path).unwrap();
            store.save_progress("real",&progress()).unwrap();
            store.connection.execute_batch("DROP TABLE playtime_summary; PRAGMA user_version=2;").unwrap();
        }
        let value=json!({"version":1,"trackingSince":"2026-09-16T00:00:00Z","totalSeconds":125.5,"historicalSeconds":100.0,"byDay":{"2026-09-16":25.5},"byMode":{"Practice":125.5}});
        {
            let mut store=Store::open(&path).unwrap();
            assert_eq!(store.load().unwrap().progress["real"].notes,progress().notes);
            assert!(store.load_playtime().unwrap().is_none());
            store.save_playtime(&value).unwrap();
        }
        let store=Store::open(&path).unwrap();
        assert_eq!(store.load_playtime().unwrap(),Some(value));
        assert_eq!(store.load().unwrap().progress.len(),1);
        assert!(directory.path().join("progress-before-v3.sqlite3").exists());
        assert_eq!(store.connection.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),4);
    }

    #[test]
    fn duel_migration_preserves_v3_data_and_history_survives_reopen() {
        let directory=tempfile::tempdir().unwrap();let path=directory.path().join("existing v3.sqlite3");
        {
            let mut store=Store::open(&path).unwrap();
            store.save_progress("real",&progress()).unwrap();
            store.connection.execute_batch("DROP TABLE duel_history; PRAGMA user_version=3;").unwrap();
        }
        let value=json!({"version":1,"matches":[{"id":"m","date":"2026-09-17","subject":"Mixed","mode":"Regular","count":5,"p1":3,"p2":2,"p1CorrectMs":5000,"p2CorrectMs":6000,"winner":"Player 1"}]});
        {
            let mut store=Store::open(&path).unwrap();
            assert_eq!(store.load().unwrap().progress.len(),1);
            assert!(store.load_duel_history().unwrap().is_none());
            store.save_duel_history(&value).unwrap();
        }
        let store=Store::open(&path).unwrap();
        assert_eq!(store.load_duel_history().unwrap(),Some(value));
        assert_eq!(store.load().unwrap().progress["real"].notes,progress().notes);
        assert!(directory.path().join("progress-before-v4.sqlite3").exists());
        assert_eq!(store.connection.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),4);
    }

    #[test]
    fn invalid_playtime_never_replaces_saved_time() {
        let directory=tempfile::tempdir().unwrap();let mut store=Store::open(&directory.path().join("playtime.sqlite3")).unwrap();
        let valid=json!({"version":1,"trackingSince":"2026-09-16T00:00:00Z","totalSeconds":10,"historicalSeconds":0,"byDay":{},"byMode":{"Practice":10}});
        store.save_playtime(&valid).unwrap();
        let invalid=json!({"version":1,"trackingSince":"2026-09-16T00:00:00Z","totalSeconds":-1,"historicalSeconds":0,"byDay":{},"byMode":{}});
        assert!(store.save_playtime(&invalid).is_err());
        assert_eq!(store.load_playtime().unwrap(),Some(valid));
    }
}
