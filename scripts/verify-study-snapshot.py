"""Check a closed QA snapshot against the protected real-study baseline."""
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

snapshot, baseline = map(Path, sys.argv[1:3])
expected = json.loads(baseline.read_text(encoding='utf-8'))
with closing(sqlite3.connect(snapshot.absolute().as_uri() + '?mode=ro', uri=True)) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    progress = {key: json.loads(value) for key, value in db.execute('SELECT question_id,progress_json FROM question_progress')}
    assert progress == expected['state']['progress'], 'Snapshot differs from protected real study records'
    profile = json.loads(db.execute('SELECT profile_json FROM study_profile WHERE id=1').fetchone()[0])
    assert profile['xp'] == expected['study']['xp'], 'Snapshot XP differs'
    assert db.execute('SELECT count(*) FROM module_history').fetchone()[0] == len(expected['study']['modules'])
print(f'Validated clean snapshot: {len(progress)} records, XP {profile["xp"]}, integrity OK')
