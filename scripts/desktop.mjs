import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = { ...process.env };
const pathName = Object.keys(environment).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const localCargo = path.join(root, 'work/tooling/cargo');
const localRustup = path.join(root, 'work/tooling/rustup');
if (existsSync(path.join(localCargo, 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo'))) {
  environment.CARGO_HOME = localCargo;
  environment.RUSTUP_HOME = localRustup;
  environment[pathName] = `${path.join(localCargo, 'bin')}${path.delimiter}${environment[pathName] ?? ''}`;
}
// Tauri's pre-build command needs Node even with a portable Node installation.
environment[pathName] = `${path.dirname(process.execPath)}${path.delimiter}${environment[pathName] ?? ''}`;
const command = process.argv[2] ?? 'dev';
const extra = process.argv.slice(3);
const isTest = command === 'test';
const executable = isTest ? 'cargo' : process.execPath;
const args = isTest
  ? ['test', '--manifest-path', path.join(root, 'src-tauri/Cargo.toml'), ...extra]
  : [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), command, ...extra];
const child = spawn(executable, args, { cwd: root, env: environment, stdio: 'inherit' });
child.on('error', (error) => {
  const guide = process.platform === 'darwin' ? 'MACOS.md' : 'WINDOWS.md';
  console.error(`${error.message}\nCheck the prerequisites described in ${guide}.`);
  process.exitCode = 1;
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
