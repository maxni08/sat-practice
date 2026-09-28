use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, fs::{self, File}, io::Read, path::{Path, PathBuf}, time::{Duration, SystemTime, UNIX_EPOCH}};
use zip::ZipArchive;

const MAX_PACK: u64 = 2_000_000_000;
const MAX_ASSET: u64 = 8_000_000;
const MAX_QUESTIONS_JSON: u64 = 40_000_000;
// The two official Question Bank exports contain about 796 MB of validated
// question/rationale crops. Keep the budget bounded but large enough for them.
const MAX_EXTRACTED_ASSETS: u64 = 1_000_000_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub id: String, pub name: String, pub source_type: String, pub version: String,
    pub enabled: bool, pub present: bool, pub count: usize, pub status: String,
    pub report: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot { pub sources: Vec<SourceInfo>, pub questions: Vec<Value> }
#[derive(Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub source_id: String, pub valid: usize, pub skipped: usize,
    pub duplicates: usize, pub invalid: usize, pub missing_assets: usize,
    pub unsupported: usize, pub issues: Vec<String>,
}
impl ImportReport {
    fn issue(&mut self, id: &str, reason: &str) {
        self.skipped += 1;
        if reason.contains("asset") { self.missing_assets += 1; }
        else if reason.contains("unsupported") { self.unsupported += 1; }
        else { self.invalid += 1; }
        if self.issues.len() < 60 { self.issues.push(format!("{id}: {reason}")); }
    }
}
pub struct Library { db: Connection, root: PathBuf }

fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn digest_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop { let size = file.read(&mut chunk).map_err(|e| e.to_string())?; if size == 0 { break; } hash.update(&chunk[..size]); }
    Ok(format!("{:x}", hash.finalize()))
}
fn valid_slug(s: &str) -> bool {
    (3..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}
fn valid_external_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_:-.".contains(&b))
}
fn safe_asset_path(s: &str) -> bool {
    s.starts_with("assets/") && s.len() <= 200 && !s.contains('\\') &&
        s.split('/').all(|part| !part.is_empty() && part != "." && part != ".." &&
            part.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))) &&
        matches!(s.rsplit('.').next().unwrap_or(""), "png" | "jpg" | "jpeg" | "webp" | "gif")
}
fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") { "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "webp" => "image/webp", _ => "image/gif" }
}
fn valid_image(path: &str, bytes: &[u8]) -> bool {
    match path.rsplit('.').next().unwrap_or("") {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "gif" => bytes.starts_with(b"GIF8"),
        "webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}
fn text<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    let s = v.get(key).and_then(Value::as_str).unwrap_or("").trim();
    if s.is_empty() || s.len() > max { Err(format!("invalid {key}")) } else { Ok(s) }
}
fn read_limited<R: Read>(reader: &mut R, max: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader.take(max + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > max { return Err("asset or record exceeds size limit".into()); }
    Ok(bytes)
}
fn asset_fields(v: &Value) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut collect = |value: Option<&Value>| -> Result<(), String> {
        if let Some(value) = value {
            let list = value.as_array().ok_or("invalid asset list")?;
            for item in list {
                let path = item.as_str().ok_or("invalid asset reference")?;
                if !safe_asset_path(path) { return Err("unsupported or unsafe asset path".into()); }
                out.push(path.to_string());
            }
        }
        Ok(())
    };
    for key in ["assets", "rationaleAssets", "passageAssets", "sourceAssets"] { collect(v.get(key))?; }
    if let Some(choices) = v.get("choices").and_then(Value::as_array) {
        for choice in choices { collect(choice.get("assets"))?; }
    }
    out.sort(); out.dedup(); Ok(out)
}
fn normalize_question(v: &Value, source: &str, scope: &str,
    asset: &mut dyn FnMut(&str) -> Result<Vec<u8>, String>) -> Result<(String, String, Value, Vec<(String, Vec<u8>)>), String> {
    let external_id = text(v, "id", 100)?;
    if !valid_external_id(external_id) { return Err("invalid ID".into()); }
    let test = text(v, "test", 40)?;
    if !matches!(test, "Math" | "Reading and Writing") { return Err("unsupported subject".into()); }
    let domain = text(v, "domain", 120)?;
    let skill = text(v, "skill", 120)?;
    let domain_ok = match test {
        "Math" => matches!(domain, "Algebra" | "Advanced Math" | "Problem-Solving and Data Analysis" | "Geometry and Trigonometry"),
        _ => matches!(domain, "Information and Ideas" | "Craft and Structure" | "Expression of Ideas" | "Standard English Conventions"),
    };
    if !domain_ok || skill.chars().any(char::is_control) { return Err("unsupported domain or skill".into()); }
    let difficulty = text(v, "difficulty", 10)?;
    if !matches!(difficulty, "Easy" | "Medium" | "Hard") { return Err("unsupported difficulty".into()); }
    let kind = text(v, "questionType", 30)?;
    if !matches!(kind, "multiple-choice" | "numeric") || (test != "Math" && kind == "numeric") { return Err("unsupported question type".into()); }
    let stem = v.get("stem").and_then(Value::as_str).unwrap_or("").trim();
    if stem.len() > 20_000 { return Err("invalid stem".into()); }
    let passage = v.get("passage").and_then(Value::as_str).unwrap_or("").trim();
    if passage.len() > 50_000 { return Err("invalid passage".into()); }
    let rationale = text(v, "rationale", 30_000)?;
    let correct = text(v, "correctAnswer", 300)?;
    let choices = v.get("choices").and_then(Value::as_array).cloned().unwrap_or_default();
    let accepted = v.get("acceptedAnswers").and_then(Value::as_array).cloned().unwrap_or_default();
    if kind == "multiple-choice" {
        if choices.len() != 4 || !["A","B","C","D"].iter().zip(&choices).all(|(label, c)| c.get("label").and_then(Value::as_str) == Some(*label) && c.get("text").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty()) || c.get("label").and_then(Value::as_str) == Some(*label) && c.get("assets").and_then(Value::as_array).is_some_and(|a| !a.is_empty())) { return Err("invalid choices".into()); }
        if !matches!(correct, "A" | "B" | "C" | "D") { return Err("invalid correct answer".into()); }
    } else {
        if !choices.is_empty() { return Err("numeric question has choices".into()); }
        let numeric = |s: &str| -> bool { let s=s.trim(); !s.is_empty() && s.len()<=80 && s.bytes().all(|b| b.is_ascii_digit() || b"-+./".contains(&b)) && s.parse::<f64>().is_ok() || (s.contains('/') && s.split_once('/').is_some_and(|(a,b)| a.parse::<f64>().is_ok() && b.parse::<f64>().is_ok_and(|n| n!=0.0))) };
        if !numeric(correct) || accepted.iter().any(|a| !a.as_str().is_some_and(numeric)) { return Err("invalid numeric answer".into()); }
    }
    let references = asset_fields(v)?;
    let has_question_visual = v.get("assets").and_then(Value::as_array).is_some_and(|a| !a.is_empty()) ||
        v.get("passageAssets").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
    if stem.is_empty() && passage.is_empty() && !has_question_visual { return Err("missing stem".into()); }
    let mut asset_data = Vec::new();
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_vec(v).map_err(|e| e.to_string())?);
    for path in references {
        let bytes = asset(&path).map_err(|e| format!("missing asset {path}: {e}"))?;
        if bytes.len() as u64 > MAX_ASSET || !valid_image(&path, &bytes) { return Err(format!("invalid asset {path}")); }
        hasher.update(path.as_bytes()); hasher.update(Sha256::digest(&bytes));
        asset_data.push((path, bytes));
    }
    let content_hash = format!("{:x}", hasher.finalize());
    let id = format!("{source}:{external_id}@{content_hash}");
    let mut question = json!({
        "id":id,"questionId":format!("{source}:{external_id}"),"externalQuestionId":external_id,
        "sourceId":source,"sourceVersion":scope,"test":test,"domain":domain,"skill":skill,
        "difficulty":difficulty,"questionType":kind,"passage":passage,"stem":stem,
        "choices":choices,"acceptedAnswers":if accepted.is_empty() && kind=="numeric" {vec![Value::String(correct.into())]} else {accepted},
        "correctAnswer":correct,"rationale":rationale,
        "sourcePages":v.get("sourcePages").and_then(Value::as_array).map(|pages|pages.iter().filter_map(Value::as_u64).take(8).collect::<Vec<_>>()).unwrap_or_default(),
        "requiresOriginalFormat":v.get("requiresOriginalFormat").and_then(Value::as_bool).unwrap_or(false),
        "passageUnderlines":v.get("passageUnderlines").and_then(Value::as_array).filter(|items|items.len()<=100).cloned().unwrap_or_default(),
        "assets":[],"rationaleAssets":[]
    });
    for field in ["assets", "rationaleAssets", "passageAssets", "sourceAssets"] {
        if let Some(list) = v.get(field).and_then(Value::as_array) {
            question[field] = Value::Array(list.iter().filter_map(Value::as_str).map(|path| json!(format!("satasset://{source}/{scope}/{path}"))).collect());
        }
    }
    if let Some(list) = question["choices"].as_array_mut() {
        for choice in list {
            if let Some(items) = choice.get("assets").and_then(Value::as_array) {
                let links: Vec<Value> = items.iter().filter_map(Value::as_str).map(|path| json!(format!("satasset://{source}/{scope}/{path}"))).collect();
                choice["assets"] = Value::Array(links);
            }
        }
    }
    Ok((external_id.to_string(), content_hash, question, asset_data))
}

impl Library {
    pub fn open(database: &Path, root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root.join("Question Packs")).map_err(|e| e.to_string())?;
        fs::create_dir_all(root.join("Question Assets")).map_err(|e| e.to_string())?;
        let db = Connection::open(database).map_err(|e| e.to_string())?;
        db.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
        Ok(Self { db, root: root.to_path_buf() })
    }
    pub fn packs_path(&self) -> String { self.root.join("Question Packs").to_string_lossy().into_owned() }
    pub fn snapshot(&self) -> Result<LibrarySnapshot, String> {
        let mut stmt = self.db.prepare("SELECT s.id,s.name,s.source_type,s.version,s.enabled,s.present,s.report_json,COUNT(q.id) FROM question_sources s LEFT JOIN library_questions q ON q.source_id=s.id AND q.active=1 GROUP BY s.id ORDER BY s.source_type,s.name").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,i64>(4)?,r.get::<_,i64>(5)?,r.get::<_,String>(6)?,r.get::<_,i64>(7)?))).map_err(|e| e.to_string())?;
        let mut sources = Vec::new();
        for row in rows { let (id,name,source_type,version,enabled,present,report,count)=row.map_err(|e|e.to_string())?;
            let status=if present==0 {"Removed"} else if source_type=="invalid" {"Invalid pack"} else if enabled==0 {"Disabled"} else {"Ready"};
            sources.push(SourceInfo{id,name,source_type,version,enabled:enabled!=0,present:present!=0,count:count as usize,status:status.into(),report:serde_json::from_str(&report).unwrap_or(json!({}))}); }
        let mut stmt = self.db.prepare("SELECT q.question_json,s.name FROM library_questions q JOIN question_sources s ON s.id=q.source_id WHERE q.active=1 AND s.enabled=1 AND s.present=1 ORDER BY q.source_id,q.external_id").map_err(|e| e.to_string())?;
        let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
        let mut questions=Vec::new();
        for row in rows { let (data,name)=row.map_err(|e|e.to_string())?;let mut q:Value=serde_json::from_str(&data).map_err(|e|e.to_string())?;q["sourceName"]=json!(name);questions.push(q); }
        Ok(LibrarySnapshot{sources,questions})
    }
    pub fn scan(&mut self) -> Result<bool, String> {
        let folder=self.root.join("Question Packs");
        let mut changed=false;
        let mut paths=fs::read_dir(&folder).map_err(|e|e.to_string())?.filter_map(Result::ok).map(|e|e.path()).filter(|p|p.extension().is_some_and(|e|e.eq_ignore_ascii_case("satpack"))).collect::<Vec<_>>();
        paths.sort();
        let mut seen=HashSet::new();
        for path in paths {
            let Ok(meta)=fs::metadata(&path) else {continue};
            if meta.len()>MAX_PACK {continue}
            let modified=meta.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_nanos() as i64).unwrap_or(0);
            if SystemTime::now().duration_since(meta.modified().unwrap_or(UNIX_EPOCH)).unwrap_or_default().as_secs()<3 {continue}
            let prior:Option<(String,i64,i64,String)>=self.db.query_row("SELECT id,file_size,file_mtime,source_type FROM question_sources WHERE file_path=?1 ORDER BY source_type='invalid' DESC LIMIT 1",[path.to_string_lossy().as_ref()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
            if let Some((id,size,mtime,_))=&prior {seen.insert(id.clone());if *size==meta.len() as i64 && *mtime==modified {continue} }
            match self.import_satpack(&path, false) {
                Ok(report) => {
                    self.db.execute("DELETE FROM question_sources WHERE source_type='invalid' AND file_path=?1",[path.to_string_lossy().as_ref()]).map_err(|e|e.to_string())?;
                    seen.insert(report.source_id);changed=true;
                }
                Err(error) => {
                    if let Some((id,_,_,kind))=&prior { if kind=="pack" {self.db.execute("UPDATE question_sources SET present=0 WHERE id=?1",[id]).map_err(|e|e.to_string())?;self.db.execute("UPDATE library_questions SET active=0 WHERE source_id=?1",[id]).map_err(|e|e.to_string())?;} }
                    let invalid_id=format!("invalid-{}",&digest(path.to_string_lossy().as_bytes())[..20]);
                    let name=path.file_name().and_then(|n|n.to_str()).unwrap_or("Invalid pack");
                    let report=json!({"issues":[error],"valid":0,"skipped":0,"duplicates":0,"invalid":1,"missingAssets":0,"unsupported":0});
                    self.db.execute("INSERT INTO question_sources(id,name,source_type,version,enabled,present,file_path,file_size,file_mtime,report_json) VALUES(?1,?2,'invalid','',0,1,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET present=1,file_size=excluded.file_size,file_mtime=excluded.file_mtime,report_json=excluded.report_json",params![invalid_id,name,path.to_string_lossy(),meta.len() as i64,modified,report.to_string()]).map_err(|e|e.to_string())?;
                    seen.insert(invalid_id);changed=true;
                }
            }
        }
        let mut stmt=self.db.prepare("SELECT id,file_path FROM question_sources WHERE source_type IN ('pack','invalid') AND present=1").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?))).map_err(|e|e.to_string())?;
        let missing=rows.filter_map(Result::ok).filter(|(id,path)|!seen.contains(id)&&path.as_deref().is_some_and(|p|!Path::new(p).exists())).map(|(id,_)|id).collect::<Vec<_>>();
        drop(stmt);
        for id in missing {self.db.execute("UPDATE question_sources SET present=0 WHERE id=?1",[&id]).map_err(|e|e.to_string())?;self.db.execute("UPDATE library_questions SET active=0 WHERE source_id=?1",[&id]).map_err(|e|e.to_string())?;changed=true;}
        Ok(changed)
    }
    pub fn import_path(&mut self, path:&Path) -> Result<ImportReport,String> {
        match path.extension().and_then(|v|v.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
            "satpack" => self.import_satpack(path,true),
            "json" | "csv" => self.import_structured(path),
            _ => Err("Choose a .satpack, .json, or .csv file".into()),
        }
    }
    fn import_satpack(&mut self,path:&Path,copy:bool)->Result<ImportReport,String>{
        if fs::metadata(path).map_err(|e|e.to_string())?.len()>MAX_PACK{return Err("Pack exceeds 2 GB limit".into())}
        let mut zip=ZipArchive::new(File::open(path).map_err(|e|e.to_string())?).map_err(|e|format!("Invalid ZIP pack: {e}"))?;
        if zip.len()>20_000{return Err("Pack contains too many files".into())}
        let manifest:Value={let mut f=zip.by_name("manifest.json").map_err(|_|"Missing manifest.json")?;serde_json::from_slice(&read_limited(&mut f,100_000)?).map_err(|e|format!("Invalid manifest: {e}"))?};
        if manifest["schemaVersion"].as_u64()!=Some(1){return Err("Unsupported pack schema version".into())}
        let source=text(&manifest,"sourceId",64)?.to_string();
        if !valid_slug(&source)||matches!(source.as_str(),"builtin"|"personal"){return Err("Invalid or reserved source ID".into())}
        let name=text(&manifest,"sourceName",120)?.to_string();
        let version=text(&manifest,"packVersion",60)?.to_string();
        let declared=manifest["questionCount"].as_u64().ok_or("Missing question count")?;
        let raw:Vec<Value>={let mut f=zip.by_name("questions.json").map_err(|_|"Missing questions.json")?;serde_json::from_slice(&read_limited(&mut f,MAX_QUESTIONS_JSON)?).map_err(|e|format!("Invalid questions.json: {e}"))?};
        if raw.len()>100_000{return Err("Pack has too many questions".into())}
        let file_digest=digest_file(path)?;
        let scope=&file_digest[..24];
        let existing:Option<(Option<String>,i64)>=self.db.query_row("SELECT file_path,present FROM question_sources WHERE id=?1",[&source],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
        let existing_path=existing.as_ref().and_then(|(p,_)|p.clone());
        if !copy && existing.as_ref().is_some_and(|(old,present)|*present!=0&&old.as_deref()!=Some(path.to_string_lossy().as_ref())){return Err("Duplicate source ID in a different pack file".into())}
        let mut report=ImportReport{source_id:source.clone(),..Default::default()};
        if declared!=raw.len() as u64 {report.issues.push(format!("Manifest declares {declared} questions but contains {}",raw.len()));}
        let mut seen=HashSet::new();let mut valid=Vec::new();let mut extracted=0u64;
        for item in &raw {
            let label=item.get("id").and_then(Value::as_str).unwrap_or("(missing ID)");
            if !seen.insert(label.to_string()){report.duplicates+=1;report.skipped+=1;continue}
            let mut read=|asset:&str|->Result<Vec<u8>,String>{let mut f=zip.by_name(asset).map_err(|_|"not found")?;if f.size()>MAX_ASSET{return Err("too large".into())}read_limited(&mut f,MAX_ASSET)};
            match normalize_question(item,&source,scope,&mut read){
                Ok(q) => { let size=q.3.iter().map(|(_,b)|b.len() as u64).sum::<u64>();
                    if extracted + size > MAX_EXTRACTED_ASSETS { report.issue(label,"asset budget exceeded (1 GB)"); }
                    else { extracted += size; valid.push(q); }
                }, Err(e)=>report.issue(label,&e)
            }
        }
        report.valid=valid.len();
        if valid.is_empty(){return Err(format!("No valid questions in pack ({})",report.issues.join("; ")))}
        let final_path=if copy && path.starts_with(self.root.join("Question Packs")) {
            path.to_path_buf()
        } else if copy {
            let destination=self.root.join("Question Packs").join(format!("{source}-{scope}.satpack"));
            if destination!=path {fs::copy(path,&destination).map_err(|e|e.to_string())?;}
            destination
        } else {path.to_path_buf()};
        for (_,_,_,assets) in &valid {for(asset,bytes)in assets {
            let target=self.root.join("Question Assets").join(&source).join(scope).join(asset);
            if !target.exists(){fs::create_dir_all(target.parent().ok_or("Invalid asset path")?).map_err(|e|e.to_string())?;fs::write(&target,bytes).map_err(|e|e.to_string())?;}
        }}
        let meta=fs::metadata(&final_path).map_err(|e|e.to_string())?;
        let mtime=meta.modified().ok().and_then(|t|t.duration_since(UNIX_EPOCH).ok()).map(|d|d.as_nanos() as i64).unwrap_or(0);
        let transaction=self.db.transaction().map_err(|e|e.to_string())?;
        transaction.execute("INSERT INTO question_sources(id,name,source_type,version,enabled,present,file_path,file_size,file_mtime,digest,report_json) VALUES(?1,?2,'pack',?3,1,1,?4,?5,?6,?7,?8) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,present=1,file_path=excluded.file_path,file_size=excluded.file_size,file_mtime=excluded.file_mtime,digest=excluded.digest,report_json=excluded.report_json",params![source,name,version,final_path.to_string_lossy(),meta.len() as i64,mtime,file_digest,serde_json::to_string(&report).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        transaction.execute("UPDATE library_questions SET active=0 WHERE source_id=?1",[&source]).map_err(|e|e.to_string())?;
        for (external,hash,q,_) in valid {transaction.execute("INSERT INTO library_questions(id,source_id,external_id,content_hash,question_json,active) VALUES(?1,?2,?3,?4,?5,1) ON CONFLICT(id) DO UPDATE SET question_json=excluded.question_json,active=1",params![q["id"].as_str(),source,external,hash,q.to_string()]).map_err(|e|e.to_string())?;}
        transaction.commit().map_err(|e|e.to_string())?;
        if copy {if let Some(old)=existing_path {let old=PathBuf::from(old);if old!=final_path&&old.exists()&&old.starts_with(self.root.join("Question Packs")) {let archived=self.root.join("Archived Packs");fs::create_dir_all(&archived).map_err(|e|e.to_string())?;let _=fs::rename(&old,archived.join(old.file_name().ok_or("Invalid old pack")?));}}}
        Ok(report)
    }
    fn import_structured(&mut self,path:&Path)->Result<ImportReport,String>{
        let bytes=fs::read(path).map_err(|e|e.to_string())?;
        if bytes.len()>40_000_000{return Err("Structured import exceeds 40 MB".into())}
        let stem=path.file_stem().and_then(|v|v.to_str()).unwrap_or("questions");
        let slug=stem.to_ascii_lowercase().chars().filter(|c|c.is_ascii_alphanumeric()||*c=='-').take(25).collect::<String>();
        let source=format!("import-{}-{}",if slug.is_empty(){"questions"}else{&slug},&digest(&bytes)[..12]);
        let raw:Vec<Value>=if path.extension().is_some_and(|e|e.eq_ignore_ascii_case("csv")) {
            let mut reader=csv::ReaderBuilder::new().flexible(true).from_reader(bytes.as_slice());
            let mut out=Vec::new();for row in reader.deserialize::<HashMap<String,String>>() {
                let row=row.map_err(|e|format!("Invalid CSV: {e}"))?;
                let get=|key:&str|row.get(key).cloned().unwrap_or_default();
                let choices=["A","B","C","D"].iter().filter_map(|label|{let value=get(label);if value.is_empty(){None}else{Some(json!({"label":label,"text":value}))}}).collect::<Vec<_>>();
                out.push(json!({"id":get("id"),"test":get("test"),"domain":get("domain"),"skill":get("skill"),"difficulty":get("difficulty"),"questionType":get("questionType"),"passage":get("passage"),"stem":get("stem"),"choices":choices,"correctAnswer":get("correctAnswer"),"acceptedAnswers":get("acceptedAnswers").split('|').filter(|s|!s.trim().is_empty()).collect::<Vec<_>>(),"rationale":get("rationale")}));
            }out
        }else{let root:Value=serde_json::from_slice(&bytes).map_err(|e|format!("Invalid JSON: {e}"))?;root.as_array().or_else(||root.get("questions").and_then(Value::as_array)).ok_or("JSON must contain a questions array")?.clone()};
        let mut report=ImportReport{source_id:source.clone(),..Default::default()};let mut seen=HashSet::new();let mut valid=Vec::new();
        for item in &raw {let label=item.get("id").and_then(Value::as_str).unwrap_or("(missing ID)");if !seen.insert(label.to_string()){report.duplicates+=1;report.skipped+=1;continue}
            let mut no_asset=|_:&str|Err("structured import needs a .satpack for assets".to_string());
            match normalize_question(item,&source,"structured",&mut no_asset){Ok(q)=>valid.push(q),Err(e)=>report.issue(label,&e)}
        }
        report.valid=valid.len();if valid.is_empty(){return Err(format!("No valid questions ({})",report.issues.join("; ")))}
        let transaction=self.db.transaction().map_err(|e|e.to_string())?;
        transaction.execute("INSERT INTO question_sources(id,name,source_type,version,enabled,present,report_json) VALUES(?1,?2,'structured','1',1,1,?3) ON CONFLICT(id) DO UPDATE SET present=1,report_json=excluded.report_json",params![source,stem,serde_json::to_string(&report).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        for (external,hash,q,_) in valid {transaction.execute("INSERT INTO library_questions(id,source_id,external_id,content_hash,question_json,active) VALUES(?1,?2,?3,?4,?5,1) ON CONFLICT(id) DO UPDATE SET active=1",params![q["id"].as_str(),source,external,hash,q.to_string()]).map_err(|e|e.to_string())?;}
        transaction.commit().map_err(|e|e.to_string())?;Ok(report)
    }
    pub fn set_enabled(&mut self,source:&str,enabled:bool)->Result<(),String>{
        if source=="personal" && !enabled {return Err("Personal Questions cannot be disabled".into())}
        if self.db.execute("UPDATE question_sources SET enabled=?2 WHERE id=?1",params![source,enabled]).map_err(|e|e.to_string())?==0{return Err("Unknown source".into())}Ok(())
    }
    pub fn remove_source(&mut self,source:&str)->Result<(),String>{
        if source=="personal" {return Err("Personal Questions cannot be removed".into())}
        let path:Option<String>=self.db.query_row("SELECT file_path FROM question_sources WHERE id=?1",[source],|r|r.get(0)).optional().map_err(|e|e.to_string())?.flatten();
        if let Some(path)=path {let old=PathBuf::from(path);if old.exists() && old.starts_with(self.root.join("Question Packs")){let archived=self.root.join("Archived Packs");fs::create_dir_all(&archived).map_err(|e|e.to_string())?;fs::rename(&old,archived.join(old.file_name().ok_or("Invalid pack path")?)).map_err(|e|e.to_string())?;}}
        self.db.execute("UPDATE question_sources SET present=0 WHERE id=?1",[source]).map_err(|e|e.to_string())?;
        self.db.execute("UPDATE library_questions SET active=0 WHERE source_id=?1",[source]).map_err(|e|e.to_string())?;Ok(())
    }
    pub fn save_personal(&mut self,mut raw:Value,prior:Option<&str>)->Result<Value,String>{
        let external=if let Some(prior)=prior {self.db.query_row("SELECT external_id FROM library_questions WHERE id=?1 AND source_id='personal'",[prior],|r|r.get::<_,String>(0)).optional().map_err(|e|e.to_string())?.ok_or("Personal question not found")?}else{format!("q{}",uuid_like())};
        raw["id"]=json!(external);
        let mut read=|asset:&str|->Result<Vec<u8>,String>{self.asset_bytes(&format!("satasset://personal/personal/{asset}"))};
        let (_,hash,q,_) = normalize_question(&raw,"personal","personal",&mut read)?;
        let transaction=self.db.transaction().map_err(|e|e.to_string())?;
        transaction.execute("UPDATE library_questions SET active=0 WHERE source_id='personal' AND external_id=?1",[&external]).map_err(|e|e.to_string())?;
        transaction.execute("INSERT INTO library_questions(id,source_id,external_id,content_hash,question_json,active) VALUES(?1,'personal',?2,?3,?4,1) ON CONFLICT(id) DO UPDATE SET question_json=excluded.question_json,active=1",params![q["id"].as_str(),external,hash,q.to_string()]).map_err(|e|e.to_string())?;
        transaction.commit().map_err(|e|e.to_string())?;Ok(q)
    }
    pub fn deactivate_personal(&mut self,id:&str)->Result<(),String>{
        if self.db.execute("UPDATE library_questions SET active=0 WHERE id=?1 AND source_id='personal'",[id]).map_err(|e|e.to_string())?==0{return Err("Personal question not found".into())}Ok(())
    }
    pub fn save_personal_asset(&self,data_url:&str)->Result<String,String>{
        let (header,encoded)=data_url.split_once(',').ok_or("Invalid image")?;
        let ext=match header {"data:image/png;base64"=>"png","data:image/jpeg;base64"=>"jpg","data:image/webp;base64"=>"webp","data:image/gif;base64"=>"gif",_=>return Err("Unsupported image type".into())};
        let bytes=STANDARD.decode(encoded).map_err(|_|"Invalid image encoding")?;
        if bytes.len() as u64>MAX_ASSET{return Err("Image exceeds 8 MB".into())}
        let name=format!("{}.{}",digest(&bytes),ext);let relative=format!("assets/{name}");
        if !valid_image(&relative,&bytes){return Err("Invalid image data".into())}
        let target=self.root.join("Question Assets/personal/personal/assets").join(&name);
        fs::create_dir_all(target.parent().ok_or("Invalid image path")?).map_err(|e|e.to_string())?;
        if !target.exists(){fs::write(&target,bytes).map_err(|e|e.to_string())?;}
        Ok(relative)
    }
    fn asset_bytes(&self,uri:&str)->Result<Vec<u8>,String>{
        let rest=uri.strip_prefix("satasset://").ok_or("Invalid asset URL")?;
        let mut parts=rest.splitn(3,'/');let source=parts.next().unwrap_or("");let scope=parts.next().unwrap_or("");let asset=parts.next().unwrap_or("");
        if !valid_slug(source) || !scope.bytes().all(|b|b.is_ascii_hexdigit()||b.is_ascii_lowercase()) || scope.len()>64 || !safe_asset_path(asset){return Err("Invalid asset URL".into())}
        let path=self.root.join("Question Assets").join(source).join(scope).join(asset);
        let meta=fs::metadata(&path).map_err(|_|"Asset is unavailable")?;if meta.len()>MAX_ASSET{return Err("Asset exceeds size limit".into())}
        fs::read(path).map_err(|e|e.to_string())
    }
    pub fn read_asset(&self,uri:&str)->Result<String,String>{
        let bytes=self.asset_bytes(uri)?;let path=uri.rsplit('/').next().unwrap_or("");
        Ok(format!("data:{};base64,{}",mime(path),STANDARD.encode(bytes)))
    }
}
fn uuid_like()->String {
    let now=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{now:x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    fn question(id: &str) -> Value {
        json!({"id":id,"test":"Math","domain":"Algebra","skill":"Linear equations","difficulty":"Medium","questionType":"multiple-choice","stem":"2x=8. Find x.","choices":[{"label":"A","text":"1"},{"label":"B","text":"2"},{"label":"C","text":"4"},{"label":"D","text":"8"}],"correctAnswer":"C","rationale":"Divide by 2."})
    }
    fn pack(path: &Path, source: &str, questions: Vec<Value>, include_asset: bool) {
        let file=File::create(path).unwrap();let mut zip=zip::ZipWriter::new(file);
        zip.start_file("manifest.json",SimpleFileOptions::default()).unwrap();
        write!(zip,"{}",json!({"schemaVersion":1,"sourceId":source,"sourceName":source,"packVersion":"1","questionCount":questions.len()})).unwrap();
        zip.start_file("questions.json",SimpleFileOptions::default()).unwrap();
        write!(zip,"{}",serde_json::to_string(&questions).unwrap()).unwrap();
        if include_asset {zip.start_file("assets/figure.png",SimpleFileOptions::default()).unwrap();zip.write_all(b"\x89PNG\r\n\x1a\nimage").unwrap();}
        zip.finish().unwrap();
    }
    fn library(dir: &Path) -> Library {
        let path=dir.join("progress.sqlite3");
        crate::storage::Store::open(&path).unwrap();
        Library::open(&path,dir).unwrap()
    }
    #[test]
    fn source_pdf_page_and_original_format_metadata_survive_pack_import() {
        let dir=tempdir().unwrap();let mut library=library(dir.path());
        let path=dir.path().join("pdf.satpack");
        let mut q=question("page-two");
        q["sourcePages"]=json!([2,3]);
        q["requiresOriginalFormat"]=json!(true);
        q["passageUnderlines"]=json!([{"start":1,"end":3}]);
        pack(&path,"pdf-test",vec![q],false);
        assert_eq!(library.import_path(&path).unwrap().valid,1);
        let item=&library.snapshot().unwrap().questions[0];
        assert_eq!(item["sourcePages"],json!([2,3]));
        assert_eq!(item["requiresOriginalFormat"],json!(true));
        assert_eq!(item["passageUnderlines"],json!([{"start":1,"end":3}]));
    }
    #[test]
    fn pack_identity_validation_and_history_reconnect() {
        let dir=tempdir().unwrap();let mut library=library(dir.path());
        let a=dir.path().join("first.satpack");let b=dir.path().join("second.satpack");
        pack(&a,"teacher-one",vec![question("42")],false);
        pack(&b,"teacher-two",vec![question("42")],false);
        assert_eq!(library.import_path(&a).unwrap().valid,1);
        assert_eq!(library.import_path(&b).unwrap().valid,1);
        let snapshot=library.snapshot().unwrap();
        assert_eq!(snapshot.questions.len(),2);
        assert_ne!(snapshot.questions[0]["id"],snapshot.questions[1]["id"]);
        let first=snapshot.questions.iter().find(|q|q["sourceId"]=="teacher-one").unwrap()["id"].as_str().unwrap().to_owned();
        library.db.execute("INSERT INTO question_progress(question_id,progress_json) VALUES(?1,'{\"attempts\":1}')",[&first]).unwrap();
        library.remove_source("teacher-one").unwrap();
        assert_eq!(library.snapshot().unwrap().questions.len(),1);
        let archived=dir.path().join("reintroduced.satpack");
        pack(&archived,"teacher-one",vec![question("42")],false);
        library.import_path(&archived).unwrap();
        assert!(library.snapshot().unwrap().questions.iter().any(|q|q["id"]==first));
        assert_eq!(library.db.query_row("SELECT COUNT(*) FROM question_progress WHERE question_id=?1",[first],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn partial_import_rejects_missing_assets_and_duplicates() {
        let dir=tempdir().unwrap();let mut library=library(dir.path());
        let path=dir.path().join("mixed.satpack");
        let mut missing=question("missing");missing["assets"]=json!(["assets/no.png"]);
        let mut wrong_domain=question("wrong");wrong_domain["domain"]=json!("Unknown Domain");
        pack(&path,"mixed-bank",vec![question("good"),question("good"),missing,wrong_domain],false);
        let report=library.import_path(&path).unwrap();
        assert_eq!((report.valid,report.duplicates,report.missing_assets),(1,1,1));
        assert_eq!(report.unsupported,1);
        assert_eq!(library.snapshot().unwrap().questions.len(),1);
    }
    #[test]
    fn manual_versions_preserve_old_attempts_and_disable_is_safe() {
        let dir=tempdir().unwrap();let mut library=library(dir.path());
        let original=library.save_personal(question("unused"),None).unwrap();
        let id=original["id"].as_str().unwrap().to_owned();
        library.db.execute("INSERT INTO question_progress(question_id,progress_json) VALUES(?1,'{\"attempts\":2}')",[&id]).unwrap();
        let mut changed=question("unused");changed["stem"]=json!("3x=9. Find x.");
        let updated=library.save_personal(changed,Some(&id)).unwrap();
        assert_ne!(updated["id"],original["id"]);
        assert_eq!(library.snapshot().unwrap().questions.len(),1);
        library.deactivate_personal(updated["id"].as_str().unwrap()).unwrap();
        assert!(library.snapshot().unwrap().questions.is_empty());
        assert_eq!(library.db.query_row("SELECT COUNT(*) FROM question_progress WHERE question_id=?1",[id],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test]
    fn folder_scan_is_incremental_and_reports_corrupt_packs() {
        let dir=tempdir().unwrap();let mut library=library(dir.path());
        let folder=dir.path().join("Question Packs");
        let good=folder.join("good.satpack");
        pack(&good,"folder-bank",vec![question("one")],false);
        std::thread::sleep(Duration::from_secs(3));
        assert!(library.scan().unwrap());
        assert!(!library.scan().unwrap());
        let bad=folder.join("broken.satpack");fs::write(&bad,b"not a ZIP").unwrap();
        std::thread::sleep(Duration::from_secs(3));
        assert!(library.scan().unwrap());
        assert!(library.snapshot().unwrap().sources.iter().any(|s|s.status=="Invalid pack"));
        fs::remove_file(good).unwrap();
        assert!(library.scan().unwrap());
        assert!(!library.snapshot().unwrap().questions.iter().any(|q|q["sourceId"]=="folder-bank"));
    }
    #[test]
    fn json_and_csv_share_validation_and_enable_disable() {
        let dir=tempdir().unwrap();let mut library=library(dir.path());
        let json_path=dir.path().join("json-set.json");
        fs::write(&json_path,json!({"questions":[question("json-one")]}).to_string()).unwrap();
        let json_report=library.import_path(&json_path).unwrap();
        assert_eq!(json_report.valid,1);
        let csv_path=dir.path().join("csv-set.csv");
        fs::write(&csv_path,"id,test,domain,skill,difficulty,questionType,stem,A,B,C,D,correctAnswer,rationale\ncsv-one,Math,Algebra,Linear equations,Medium,multiple-choice,Find x,1,2,4,8,C,Divide by two\n").unwrap();
        let csv_report=library.import_path(&csv_path).unwrap();
        assert_eq!(csv_report.valid,1);
        assert_eq!(library.snapshot().unwrap().questions.len(),2);
        library.set_enabled(&json_report.source_id,false).unwrap();
        assert_eq!(library.snapshot().unwrap().questions.len(),1);
        library.set_enabled(&json_report.source_id,true).unwrap();
        assert_eq!(library.snapshot().unwrap().questions.len(),2);
    }
}
