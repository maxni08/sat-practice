import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] ?? 'dev';
if (command === 'build') {
  const checked = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-b'], { cwd: root, stdio: 'inherit' });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
}
if (!['dev', 'build', 'preview'].includes(command)) throw new Error('Use dev, build, or preview');
const args = [path.join(root, 'node_modules/vite/bin/vite.js')];
if (command !== 'dev') args.push(command);
if (command !== 'build') args.push('--host', '127.0.0.1');
const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
