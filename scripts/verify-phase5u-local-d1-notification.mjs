import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = resolve(root, 'wrangler.phase5u.jsonc');
const wranglerCommand = resolve(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
);
const port = Number(process.env.CBH_PHASE5U_PORT ?? '8801');
const origin = 'http://127.0.0.1:' + port;
const persistPath = await mkdtemp(join(tmpdir(), 'comebackhome-phase5u-'));

let workerProcess;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });
    let output = '';

    if (options.capture) {
      child.stdout.on('data', (chunk) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    }

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise({ output });
        return;
      }
      reject(new Error(
        command + ' ' + args.join(' ') + ' failed with code ' + code +
        (signal ? ' signal ' + signal : '') +
        (output ? '\n' + output : ''),
      ));
    });
  });
}

async function requestJson(path, init) {
  const response = await fetch(origin + path, init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(path + ' failed with HTTP ' + response.status + ': ' + JSON.stringify(payload));
  }
  return payload;
}

async function postJson(path, body) {
  return requestJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForWorker() {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    if (workerProcess?.exitCode != null) {
      throw new Error('Phase5U wrangler dev exited early.\n' + (workerProcess.phase5uOutput ?? ''));
    }

    try {
      const health = await requestJson('/health');
      if (health?.ok === true) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error('Phase5U local Worker did not become ready: ' + String(lastError ?? 'timeout'));
}

async function stopWorker() {
  if (!workerProcess || workerProcess.exitCode != null) return;
  workerProcess.kill();
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      if (workerProcess.exitCode == null) workerProcess.kill('SIGKILL');
      resolvePromise();
    }, 3_000);
    workerProcess.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

try {
  await access(wranglerCommand);

  await run(wranglerCommand, [
    'd1',
    'migrations',
    'apply',
    'come-back-home-db',
    '--local',
    '--config',
    configPath,
    '--persist-to',
    persistPath,
  ], {
    env: { CI: '1' },
  });

  workerProcess = spawn(wranglerCommand, [
    'dev',
    '--local',
    '--config',
    configPath,
    '--persist-to',
    persistPath,
    '--port',
    String(port),
    '--ip',
    '127.0.0.1',
    '--show-interactive-dev-session=false',
    '--log-level',
    'warn',
  ], {
    cwd: root,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  workerProcess.phase5uOutput = '';
  workerProcess.stdout.on('data', (chunk) => { workerProcess.phase5uOutput += chunk.toString(); });
  workerProcess.stderr.on('data', (chunk) => { workerProcess.phase5uOutput += chunk.toString(); });

  await waitForWorker();

  const seeded = await postJson('/seed', {});
  assert(typeof seeded.personId === 'string' && seeded.personId.length > 0, 'Phase5U seed did not return person id');
  assert(typeof seeded.subscriptionId === 'string' && seeded.subscriptionId.length > 0, 'Phase5U seed did not return subscription id');

  const first = await postJson('/cycle', {
    scheduledTime: '2026-10-05T13:10:00.000Z',
    arrivalAt: '2026-10-05T13:48:00.000Z',
    confidence: 'FALLBACK',
  });

  assert(first.result?.status === 'processed', 'first D1 cycle status mismatch');
  assert(first.result?.planning?.shiftEndEnqueued === 1, 'first D1 cycle shift-end planning mismatch');
  assert(first.result?.planning?.etaBaselinesInitialized === 1, 'first D1 cycle ETA baseline mismatch');
  assert(first.result?.planning?.etaChangeEnqueued === 0, 'first D1 cycle must not emit ETA-change');
  assert(first.result?.delivery?.claimed === 1 && first.result?.delivery?.sent === 1, 'first D1 cycle shift-end delivery mismatch');
  assert(first.deliveries?.length === 1, 'first D1 cycle fake delivery count mismatch');
  assert(first.deliveries?.[0]?.payload?.tag === 'cbh:shift-end:' + seeded.personId + ':2026-10-05', 'first D1 cycle delivered wrong tag');
  assert(first.deliveries?.[0]?.payload?.body?.includes('다음 출근 10/7 09:30'), 'first D1 cycle payload lost next-work info');
  assert(first.state?.jobs?.length === 1, 'first D1 cycle persisted job count mismatch');
  assert(first.state?.jobs?.[0]?.status === 'sent', 'first D1 job must persist sent state');
  assert(first.state?.jobs?.[0]?.attempts === 1, 'first D1 job attempt count mismatch');
  assert(first.state?.plannerState?.[0]?.eta_baseline_at === '2026-10-05T13:48:00.000Z', 'first D1 planner baseline timestamp mismatch');
  assert(first.state?.plannerState?.[0]?.eta_baseline_work_date === '2026-10-05', 'first D1 planner baseline work date mismatch');
  assert(first.state?.plannerState?.[0]?.last_eta_notification_at === null, 'first D1 baseline must not set ETA notification timestamp');

  const second = await postJson('/cycle', {
    scheduledTime: '2026-10-05T13:20:00.000Z',
    arrivalAt: '2026-10-05T13:58:00.000Z',
    confidence: 'FALLBACK',
  });

  assert(second.result?.planning?.etaChangeEnqueued === 1, 'second D1 cycle must plan +10 minute ETA change');
  assert(second.result?.delivery?.claimed === 1 && second.result?.delivery?.sent === 1, 'second D1 cycle ETA delivery mismatch');
  assert(second.deliveries?.length === 1, 'second D1 cycle fake delivery count mismatch');
  assert(second.deliveries?.[0]?.payload?.tag === 'cbh:eta-change:' + seeded.personId, 'second D1 cycle delivered wrong ETA tag');
  assert(second.state?.jobs?.length === 2, 'second D1 cycle persisted job count mismatch');
  assert(second.state?.jobs?.every((job) => job.status === 'sent'), 'second D1 cycle must persist both jobs as sent');
  assert(second.state?.plannerState?.[0]?.eta_baseline_at === '2026-10-05T13:58:00.000Z', 'second D1 planner baseline was not advanced');
  assert(second.state?.plannerState?.[0]?.last_eta_notification_at === '2026-10-05T13:20:00.000Z', 'second D1 planner notification timestamp mismatch');

  const cooldown = await postJson('/cycle', {
    scheduledTime: '2026-10-05T13:25:00.000Z',
    arrivalAt: '2026-10-05T14:10:00.000Z',
    confidence: 'LIVE',
  });

  assert(cooldown.result?.planning?.etaChangeEnqueued === 0, 'D1 cooldown cycle must suppress ETA-change');
  assert(cooldown.result?.delivery?.claimed === 0, 'D1 cooldown cycle must claim no new job');
  assert(cooldown.deliveries?.length === 0, 'D1 cooldown cycle must deliver nothing');
  assert(cooldown.state?.jobs?.length === 2, 'D1 cooldown cycle created an unexpected job');

  const noWork = await postJson('/cycle', {
    scheduledTime: '2026-10-06T12:00:00.000Z',
    arrivalAt: '2026-10-06T12:40:00.000Z',
    confidence: 'LIVE',
  });

  assert(noWork.result?.planning?.skippedNoWork === 1, 'D1 non-work day was not skipped');
  assert(noWork.result?.planning?.shiftEndEnqueued === 0, 'D1 non-work day planned shift-end');
  assert(noWork.result?.planning?.etaChangeEnqueued === 0, 'D1 non-work day planned ETA-change');
  assert(noWork.state?.jobs?.length === 2, 'D1 non-work day created a job');

  const nextWorkday = await postJson('/cycle', {
    scheduledTime: '2026-10-07T08:00:00.000Z',
    arrivalAt: '2026-10-07T10:20:00.000Z',
    confidence: 'FALLBACK',
  });

  assert(nextWorkday.result?.planning?.shiftEndEnqueued === 1, 'next D1 workday shift-end was not planned');
  assert(nextWorkday.result?.planning?.etaBaselinesInitialized === 1, 'next D1 workday baseline was not reset');
  assert(nextWorkday.result?.planning?.etaChangeEnqueued === 0, 'next D1 workday first ETA must not notify');
  assert(nextWorkday.result?.delivery?.claimed === 0, 'future shift-end job should not be due yet');
  assert(nextWorkday.state?.jobs?.length === 3, 'next D1 workday pending shift-end job missing');
  const pending = nextWorkday.state.jobs.find((job) => job.status === 'pending');
  assert(pending?.job_type === 'shift-end', 'next D1 workday pending job type mismatch');
  assert(pending?.scheduled_for === '2026-10-07T09:30:00.000Z', 'next D1 workday shift-end UTC schedule mismatch');
  assert(nextWorkday.state?.plannerState?.[0]?.eta_baseline_at === '2026-10-07T10:20:00.000Z', 'next D1 workday baseline timestamp mismatch');
  assert(nextWorkday.state?.plannerState?.[0]?.eta_baseline_work_date === '2026-10-07', 'next D1 workday baseline date mismatch');
  assert(nextWorkday.state?.plannerState?.[0]?.last_eta_notification_at === null, 'new D1 workday must reset last ETA notification timestamp');

  const finalState = await requestJson('/state');
  assert(finalState.jobs?.length === 3, 'final D1 notification job count mismatch');
  assert(finalState.plannerState?.length === 1, 'final D1 planner state row count mismatch');

  console.log(JSON.stringify({
    result: 'PASS',
    localD1: true,
    migrations: ['0001_initial.sql', '0002_notification_planner_state.sql'],
    sentJobs: finalState.jobs.filter((job) => job.status === 'sent').length,
    pendingJobs: finalState.jobs.filter((job) => job.status === 'pending').length,
    plannerStateRows: finalState.plannerState.length,
    fakeGatewayOnly: true,
    remoteResources: 0,
  }, null, 2));
} finally {
  await stopWorker();
  await rm(persistPath, { recursive: true, force: true });
}

// Phase 5U dependency-backed verification trigger.
