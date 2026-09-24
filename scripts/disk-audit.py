"""Read-only project footprint report; never follows directory links."""
from pathlib import Path
import argparse
import json
import os

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = args.root.resolve()
totals = {}
largest = []
errors = []
files = 0
for directory, dirs, names in os.walk(root, followlinks=False):
    dirs[:] = [d for d in dirs if not (Path(directory) / d).is_symlink()]
    for name in names:
        path = Path(directory) / name
        try:
            if path.is_symlink():
                continue
            size = path.stat().st_size
            files += 1
            relative = path.relative_to(root)
            largest.append({'path': str(relative), 'bytes': size})
            for count in range(0, len(relative.parts)):
                key = str(Path(*relative.parts[:count])) if count else '.'
                totals[key] = totals.get(key, 0) + size
        except OSError as error:
            errors.append({'path': str(path), 'error': str(error)})
result = {'root': str(root), 'bytes': totals.get('.', 0), 'files': files,
          'directories': dict(sorted(totals.items(), key=lambda x: -x[1])),
          'largestFiles': sorted(largest, key=lambda x: -x['bytes'])[:40], 'errors': errors}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
print(f'{result["bytes"] / 1_000_000_000:.2f} GB, {files:,} files; errors: {len(errors)}')
for directory, size in list(result['directories'].items())[:15]:
    print(f'{size / 1_000_000_000:8.2f} GB  {directory}')
