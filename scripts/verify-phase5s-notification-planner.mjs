import { createServer as createViteServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const plannerSource = await readFile(new URL('../worker/notification-planner.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../db/migrations/0002_notification_planner_state.sql', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../worker/repositories/D1NotificationPlannerStateStore.ts', import.meta.url), 'utf8');

for (const text of [
  'etaChangeThresholdMinutes: ETA_CHANGE_THRESHOLD_MINUTES',
  'etaChangeCooldownMinutes: ETA_CHANGE_COOLDOWN_MINUTES',
  'homeArrivalNotificationEnabled: false',
  "dedupeKey: 'shift-end:'",
  "dedupeKey: 'eta-change:'",
  "type: 'shift-end'",
  "type: 'eta-change'",
]) {
  expect(plannerSource.includes(text), 'notification planner contract missing ' + text);
}
expect(!plannerSource.includes("type: 'home-arrival'"), 'planner must not generate a home-arrival job');
expect(migration.includes('notification_planner_state'), 'planner state migration missing');
expect(migration.includes('eta_baseline_work_date'), 'work-date scoped ETA baseline migration missing');
expect(storeSource.includes('class D1NotificationPlannerStateStore'), 'D1 planner state store missing');

const vite = await createViteServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  const planner = await vite.ssrLoadModule('/worker/notification-planner.ts');

  class MemoryJobs {
    constructor() {
      this.jobs = [];
      this.keys = new Set();
    }
    async enqueueOnce(job) {
      if (this.keys.has(job.dedupeKey)) return;
      this.keys.add(job.dedupeKey);
      this.jobs.push(structuredClone({
        ...job,
        status: 'pending',
        attempts: 0,
        sentAt: null,
        lastError: null,
      }));
    }
    async claimDue() { return []; }
    async markSent() {}
    async markRetry() {}
    async markFailed() {}
  }

  class MemoryPlannerState {
    constructor() { this.states = new Map(); }
    async get(personId) {
      return this.states.has(personId) ? structuredClone(this.states.get(personId)) : null;
    }
    async upsert(state) {
      this.states.set(state.personId, structuredClone(state));
    }
  }

  const jobs = new MemoryJobs();
  const plannerState = new MemoryPlannerState();
  const person = { id: 'person-1', name: '여자친구', relation: '연인' };
  const scheduleRows = [
    { id: 's1', personId: person.id, date: '2026-10-05', enabled: true, start: '09:00', end: '22:10' },
    { id: 's2', personId: person.id, date: '2026-10-07', enabled: true, start: '09:30', end: '18:30' },
  ];
  const people = {
    async list() { return [structuredClone(person)]; },
  };
  const schedules = {
    async list(personId) {
      return structuredClone(scheduleRows.filter((row) => row.personId === personId));
    },
  };
  const settingsRecord = {
    shiftEndEnabled: true,
    etaChangeEnabled: true,
    timezone: 'Asia/Seoul',
    updatedAt: '2026-10-05T00:00:00.000Z',
  };
  const settings = {
    async get() { return structuredClone(settingsRecord); },
  };

  let eta = {
    personId: person.id,
    arrivalAt: '2026-10-05T13:48:00.000Z',
    confidence: 'FALLBACK',
  };
  const etaSource = {
    async get() { return structuredClone(eta); },
  };

  const deps = { jobs, settings, plannerState, people, schedules, etaSource };

  const first = await planner.planNotificationJobs(deps, Date.parse('2026-10-05T12:00:00.000Z'));
  expect(first.workdays === 1, 'workday was not recognized');
  expect(first.shiftEndEnqueued === 1, 'shift-end planning count mismatch');
  expect(first.etaBaselinesInitialized === 1, 'first ETA must initialize baseline');
  expect(first.etaChangeEnqueued === 0, 'first ETA observation must not notify');

  const shiftJobs = jobs.jobs.filter((job) => job.type === 'shift-end');
  expect(shiftJobs.length === 1, 'shift-end dedupe failed on first plan');
  expect(shiftJobs[0]?.scheduledFor === '2026-10-05T13:10:00.000Z', 'shift-end scheduled time must equal 22:10 KST');
  expect(shiftJobs[0]?.payload.title === '여자친구 퇴근 예정', 'shift-end title mismatch');
  expect(shiftJobs[0]?.payload.body.includes('퇴근 예정 22:10'), 'shift-end body missing planned shift end');
  expect(shiftJobs[0]?.payload.body.includes('귀가 예상 22:48'), 'shift-end body missing ETA');
  expect(shiftJobs[0]?.payload.body.includes('예상 기준'), 'fallback ETA must not be labeled live');
  expect(shiftJobs[0]?.payload.body.includes('다음 출근 10/7 09:30'), 'shift-end body missing next work');

  eta = { ...eta, arrivalAt: '2026-10-05T13:57:00.000Z' };
  const nine = await planner.planNotificationJobs(deps, Date.parse('2026-10-05T12:05:00.000Z'));
  expect(nine.etaChangeEnqueued === 0, '9-minute ETA change must not notify');
  expect(jobs.jobs.filter((job) => job.type === 'shift-end').length === 1, 'replanning duplicated shift-end job');

  eta = { ...eta, arrivalAt: '2026-10-05T13:58:00.000Z' };
  const ten = await planner.planNotificationJobs(deps, Date.parse('2026-10-05T12:10:00.000Z'));
  expect(ten.etaChangeEnqueued === 1, '10-minute ETA change must notify');
  const firstEtaJob = jobs.jobs.find((job) => job.type === 'eta-change');
  expect(firstEtaJob?.payload.body.includes('+10분'), 'ETA change body missing +10 minute delta');
  expect(firstEtaJob?.payload.body.includes('예상 기준'), 'fallback ETA change must remain expected, not live');

  eta = {
    ...eta,
    arrivalAt: '2026-10-05T14:10:00.000Z',
    confidence: 'LIVE',
  };
  const cooldown = await planner.planNotificationJobs(deps, Date.parse('2026-10-05T12:20:00.000Z'));
  expect(cooldown.etaChangeEnqueued === 0, 'ETA change inside 15-minute cooldown must not notify');

  const afterCooldown = await planner.planNotificationJobs(deps, Date.parse('2026-10-05T12:25:00.000Z'));
  expect(afterCooldown.etaChangeEnqueued === 1, 'ETA change at 15-minute cooldown boundary must notify');
  const etaJobs = jobs.jobs.filter((job) => job.type === 'eta-change');
  expect(etaJobs.length === 2, 'ETA change job count mismatch after cooldown');
  expect(etaJobs[1]?.payload.body.includes('실시간 기준'), 'LIVE ETA change must be labeled live');

  const nonWork = await planner.planNotificationJobs(deps, Date.parse('2026-10-06T12:00:00.000Z'));
  expect(nonWork.skippedNoWork === 1, 'non-work day must be skipped');
  expect(nonWork.shiftEndEnqueued === 0, 'non-work day must not plan shift-end');
  expect(nonWork.etaChangeEnqueued === 0, 'non-work day must not plan ETA change');

  eta = {
    personId: person.id,
    arrivalAt: '2026-10-07T10:20:00.000Z',
    confidence: 'FALLBACK',
  };
  const nextWorkday = await planner.planNotificationJobs(deps, Date.parse('2026-10-07T08:00:00.000Z'));
  expect(nextWorkday.etaBaselinesInitialized === 1, 'new work date must reset ETA baseline');
  expect(nextWorkday.etaChangeEnqueued === 0, 'new work date first ETA must not alert');

  expect(jobs.jobs.every((job) => job.type !== 'home-arrival'), 'home-arrival job must not exist');

  const unsupportedJobs = new MemoryJobs();
  const unsupported = await planner.planNotificationJobs({
    ...deps,
    jobs: unsupportedJobs,
    settings: {
      async get() {
        return { ...settingsRecord, timezone: 'UTC' };
      },
    },
  }, Date.parse('2026-10-05T12:00:00.000Z'));
  expect(unsupported.status === 'unsupported-timezone', 'non-product timezone must fail closed');
  expect(unsupportedJobs.jobs.length === 0, 'unsupported timezone must not enqueue jobs');
} finally {
  await vite.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('phase 5S notification job planner verification passed');

// Phase 5S final dependency-backed verification trigger.
