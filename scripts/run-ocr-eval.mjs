import {
  access,
  cp,
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const evalRoot = resolve(root, 'tools/ocr-eval');
const runtimeId = 'tesseract-7.0.0-data-1.0.0';
const tempRoot = await mkdtemp(join(tmpdir(), 'comebackhome-private-ocr-eval-'));
const tempPublic = join(tempRoot, 'public');
const runtimeOutput = join(tempPublic, 'ocr', runtimeId);

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(command + ' failed with code ' + code + '\n' + stdout + stderr));
    });
  });
}

async function copyExistingPublic() {
  const sourcePublic = resolve(root, 'public');
  try {
    await access(sourcePublic);
    await cp(sourcePublic, tempPublic, { recursive: true });
  } catch {
    await mkdir(tempPublic, { recursive: true });
  }
}

await copyExistingPublic();
await run(process.execPath, [
  resolve(root, 'scripts/prepare-ocr-assets.mjs'),
  '--output',
  runtimeOutput,
]);

const server = await createServer({
  root: evalRoot,
  configFile: false,
  publicDir: tempPublic,
  server: {
    host: '127.0.0.1',
    port: 4191,
    strictPort: true,
    fs: {
      allow: [root, tempRoot],
    },
  },
  logLevel: 'info',
});

let closing = false;

async function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  try {
    await server.close();
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    process.exit(exitCode);
  }
}

process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });
process.once('uncaughtException', (error) => {
  console.error(error);
  void shutdown(1);
});
process.once('unhandledRejection', (error) => {
  console.error(error);
  void shutdown(1);
});

await server.listen();

console.log('');
console.log('ComeBackHome private OCR evaluation harness');
console.log('LOCAL ONLY: http://127.0.0.1:4191/');
console.log('The selected schedule image stays in browser memory and is not uploaded or persisted by this harness.');
console.log('Press Ctrl+C to stop and remove temporary OCR runtime assets.');
console.log('');
