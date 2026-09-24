"""Consistent native-QA backup/restore. Close SAT Practice before restoring."""
import argparse
import sqlite3
from contextlib import closing
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['backup', 'restore'])
parser.add_argument('database', type=Path)
parser.add_argument('snapshot', type=Path)
args = parser.parse_args()
args.database = args.database.absolute()
args.snapshot = args.snapshot.absolute()
source, target = ((args.database, args.snapshot) if args.mode == 'backup'
                  else (args.snapshot, args.database))
if not source.is_file():
    raise SystemExit(f'Missing source database: {source}')
if args.mode == 'backup' and target.exists():
    raise SystemExit(f'Preserving existing snapshot: {target}')
target.parent.mkdir(parents=True, exist_ok=True)
with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as src:
    assert src.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    if args.mode == 'backup':
        with closing(sqlite3.connect(target)) as dst:
            src.backup(dst)
            assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    else:
        # Restore only with the app closed. Build a standalone database first;
        # never overlay a new main file with stale journals from another snapshot.
        staged = target.with_name(target.name + '.restore-staged')
        if staged.exists():
            raise SystemExit(f'Inspect existing staging file before retrying: {staged}')
        with closing(sqlite3.connect(staged)) as dst:
            src.backup(dst)
            dst.execute('PRAGMA journal_mode=DELETE')
            assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        for suffix in ('-wal', '-shm'):
            sidecar = Path(str(target) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        os.replace(staged, target)
print(f'{args.mode} complete: {target}')
