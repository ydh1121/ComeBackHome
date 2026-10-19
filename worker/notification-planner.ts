import { activeWorkSchedule, shiftTimes } from '../src/domain/product-time';
import { nextBirthday } from '../src/domain/birthday';
import type {
  NotificationEtaSource,
  NotificationJobStore,
  NotificationPayload,
  NotificationPlannerStateStore,
  NotificationSettingsStore,
} from './contracts';
import type {
  PersonRepository,
  ScheduleRepository,
} from '../src/application/contracts/repositories';
import type { Person, ScheduleEntry } from '../src/domain/models';

export interface NotificationPlannerDependencies {
  jobs: NotificationJobStore;
  settings: NotificationSettingsStore;
  plannerState: NotificationPlannerStateStore;
  people: PersonRepository;
  schedules: ScheduleRepository;
  etaSource: NotificationEtaSource;
}

export interface NotificationPlanResult {
  status: 'planned' | 'unsupported-timezone';
  plannedAt: string;
  peopleChecked: number;
  workdays: number;
  shiftEndEnqueued: number;
  arrivalAdvanceEnqueued: number;
  etaBaselinesInitialized: number;
  etaChangeEnqueued: number;
  skippedNoWork: number;
  birthdayEnqueued: number;
}

const ETA_CHANGE_THRESHOLD_MINUTES = 10;
const ETA_CHANGE_COOLDOWN_MINUTES = 15;
const PRODUCT_TIMEZONE = 'Asia/Seoul';

function seoulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRODUCT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return map.year + '-' + map.month + '-' + map.day;
}


function seoulDisplay(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: PRODUCT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function nextWorkDisplay(schedule: ScheduleEntry | null): string {
  if (!schedule) return '다음 출근 일정 없음';
  const [, month, day] = schedule.date.split('-');
  return '다음 출근 ' + Number(month) + '/' + Number(day) + ' ' + schedule.start;
}

function confidenceLabel(confidence: 'LIVE' | 'STALE' | 'FALLBACK' | 'UNKNOWN'): string {
  return confidence === 'LIVE' ? '실시간 기준' : '예상 기준';
}

function shiftEndPayload(
  person: Person,
  schedule: ScheduleEntry,
  etaArrivalAt: string | null,
  etaConfidence: 'LIVE' | 'STALE' | 'FALLBACK' | 'UNKNOWN',
  nextWork: ScheduleEntry | null,
): NotificationPayload {
  const etaText = etaArrivalAt
    ? '귀가 예상 ' + seoulDisplay(etaArrivalAt) + ' (' + confidenceLabel(etaConfidence) + ')'
    : '귀가 예상 확인 필요';

  return {
    title: person.name + ' 퇴근 예정 10분 전',
    body: '퇴근 예정 ' + schedule.end + ' · ' + etaText + ' · ' + nextWorkDisplay(nextWork),
    tag: 'cbh:shift-end:' + person.id + ':' + schedule.date,
    path: '/',
  };
}

function etaChangePayload(
  person: Person,
  arrivalAt: string,
  confidence: 'LIVE' | 'STALE' | 'FALLBACK' | 'UNKNOWN',
  diffMinutes: number,
): NotificationPayload {
  const direction = diffMinutes > 0 ? '+' : '';
  return {
    title: person.name + ' 귀가 예상 변경',
    body:
      '귀가 예상 ' + seoulDisplay(arrivalAt) +
      ' · 이전 예상 대비 ' + direction + diffMinutes + '분 · ' +
      confidenceLabel(confidence),
    tag: 'cbh:eta-change:' + person.id,
    path: '/',
  };
}

function latestFutureWork(schedules: ScheduleEntry[], currentDate: string): ScheduleEntry | null {
  return schedules
    .filter((schedule) => schedule.enabled && schedule.date > currentDate)
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      left.start.localeCompare(right.start)
    )[0] ?? null;
}


function minuteDifference(laterIso: string, earlierIso: string): number {
  return Math.round((Date.parse(laterIso) - Date.parse(earlierIso)) / 60_000);
}

function cooldownSatisfied(lastNotificationAt: string | null, now: Date): boolean {
  if (!lastNotificationAt) return true;
  const parsed = Date.parse(lastNotificationAt);
  if (!Number.isFinite(parsed)) return true;
  return now.getTime() - parsed >= ETA_CHANGE_COOLDOWN_MINUTES * 60_000;
}

export async function planNotificationJobs(
  dependencies: NotificationPlannerDependencies,
  scheduledTime: number,
): Promise<NotificationPlanResult> {
  const now = new Date(scheduledTime);
  const plannedAt = now.toISOString();
  const settings = await dependencies.settings.get();

  const result: NotificationPlanResult = {
    status: 'planned',
    plannedAt,
    peopleChecked: 0,
    workdays: 0,
    shiftEndEnqueued: 0,
    arrivalAdvanceEnqueued: 0,
    etaBaselinesInitialized: 0,
    etaChangeEnqueued: 0,
    skippedNoWork: 0,
    birthdayEnqueued: 0,
  };

  if (settings.timezone !== PRODUCT_TIMEZONE) {
    result.status = 'unsupported-timezone';
    return result;
  }

  const currentDate = seoulDate(now);
  const people = await dependencies.people.list();

  for (const person of people) {
    result.peopleChecked += 1;
    const birthday = nextBirthday(person.birthday,currentDate);
    if (person.birthday && birthday) {
      for (const days of settings.birthdayDays ?? []) {
        const when = Date.parse(birthday.date+'T09:00:00+09:00') - days*86400000;
        // Morning reminders expire after one hour; enabling a rule at night
        // must not produce a burst of overdue birthday notifications.
        if (when < scheduledTime - 3600000) continue;
        const scheduledFor = new Date(when).toISOString();
        await dependencies.jobs.enqueueOnce({
          id:crypto.randomUUID(),dedupeKey:`birthday:${person.id}:${birthday.date}:${days}`,
          personId:person.id,type:'birthday',scheduledFor,nextAttemptAt:scheduledFor,
          payload:{title:days ? `${person.name} 생일 ${days}일 전` : `${person.name}의 생일이에요 🎂`,
            body:`${Number(birthday.date.slice(5,7))}월 ${Number(birthday.date.slice(8,10))}일 생일을 챙겨 주세요.`,
            tag:`cbh:birthday:${person.id}:${birthday.date}:${days}`,path:'/',
            birthday:{source:JSON.stringify(person.birthday),date:birthday.date,days}},
        });
        result.birthdayEnqueued++;
      }
    }
    const schedules = await dependencies.schedules.list(person.id);
    const today = activeWorkSchedule(schedules, now);

    if (!today) {
      await dependencies.jobs.setArrivalPlan?.(person.id, currentDate, null, plannedAt);
      result.skippedNoWork += 1;
      continue;
    }

    result.workdays += 1;

    let eta = null;
    try {
      eta = await dependencies.etaSource.get(person.id, now);
    } catch {
      eta = null;
    }

    const validEta = eta?.arrivalAt && eta.confidence !== 'UNKNOWN' && (!eta.workDate || eta.workDate === today.date) && Number.isFinite(Date.parse(eta.arrivalAt))
      ? eta.arrivalAt : null;
    await dependencies.jobs.setArrivalPlan?.(person.id, today.date, validEta, plannedAt, today);
    if (settings.arrivalAdvanceEnabled && validEta) {
      const scheduledFor = new Date(Date.parse(validEta) - 10 * 60_000).toISOString();
      // Never send a late reminder after the predicted arrival has passed.
      if (Date.parse(validEta) > now.getTime()) {
        await dependencies.jobs.enqueueOnce({
          id: crypto.randomUUID(), dedupeKey: 'arrival-advance:' + person.id + ':' + today.date,
          personId: person.id, type: 'arrival-advance', scheduledFor, nextAttemptAt: scheduledFor,
          payload: { title: person.name + ' 도착 예상 10분 전',
            body: '도착 예상 ' + seoulDisplay(validEta) + ' · ' + (eta?.earliestArrivalAt && eta?.latestArrivalAt
              ? seoulDisplay(eta.earliestArrivalAt) + '–' + seoulDisplay(eta.latestArrivalAt) : confidenceLabel(eta?.confidence ?? 'UNKNOWN')) + (eta?.departureBasis === 'ACTUAL' ? ' · 전달받은 퇴근 시각 기준' : ' · 예정 퇴근 기준, 실제 출발 미확인'),
            tag: 'cbh:arrival-advance:' + person.id + ':' + today.date, path: '/' },
        });
        result.arrivalAdvanceEnqueued++;
      }
    }

    if (settings.shiftEndEnabled) {
      const scheduledFor = new Date(shiftTimes(today).end - 10 * 60_000).toISOString();
      const nextWork = latestFutureWork(schedules, currentDate);
      const payload = shiftEndPayload(
        person,
        today,
        eta?.arrivalAt ?? null,
        eta?.confidence ?? 'UNKNOWN',
        nextWork,
      );

      await dependencies.jobs.enqueueOnce({
        id: crypto.randomUUID(),
        dedupeKey: 'shift-end:' + person.id + ':' + today.date,
        personId: person.id,
        type: 'shift-end',
        scheduledFor,
        nextAttemptAt: scheduledFor,
        payload,
      });
      result.shiftEndEnqueued += 1;
    }

    if (!settings.etaChangeEnabled || !validEta || !eta?.arrivalAt) {
      continue;
    }

    const currentEtaMs = Date.parse(eta.arrivalAt);
    if (!Number.isFinite(currentEtaMs)) continue;

    const state = await dependencies.plannerState.get(person.id);
    const baselineAt = state?.etaBaselineAt ?? null;
    const requiresBaseline =
      !baselineAt ||
      state?.etaBaselineWorkDate !== today.date ||
      !Number.isFinite(Date.parse(baselineAt));

    if (requiresBaseline) {
      await dependencies.plannerState.upsert({
        personId: person.id,
        etaBaselineAt: eta.arrivalAt,
        etaBaselineWorkDate: today.date,
        lastEtaNotificationAt: null,
        updatedAt: plannedAt,
      });
      result.etaBaselinesInitialized += 1;
      continue;
    }

    const diffMinutes = minuteDifference(eta.arrivalAt, baselineAt);
    if (
      Math.abs(diffMinutes) < ETA_CHANGE_THRESHOLD_MINUTES ||
      !cooldownSatisfied(state?.lastEtaNotificationAt ?? null, now)
    ) {
      continue;
    }

    await dependencies.jobs.enqueueOnce({
      id: crypto.randomUUID(),
      dedupeKey: 'eta-change:' + person.id + ':' + eta.arrivalAt,
      personId: person.id,
      type: 'eta-change',
      scheduledFor: plannedAt,
      nextAttemptAt: plannedAt,
      payload: etaChangePayload(person, eta.arrivalAt, eta.confidence, diffMinutes),
    });

    await dependencies.plannerState.upsert({
      personId: person.id,
      etaBaselineAt: eta.arrivalAt,
      etaBaselineWorkDate: today.date,
      lastEtaNotificationAt: plannedAt,
      updatedAt: plannedAt,
    });
    result.etaChangeEnqueued += 1;
  }

  return result;
}

export const NOTIFICATION_PLANNER_POLICY = {
  etaChangeThresholdMinutes: ETA_CHANGE_THRESHOLD_MINUTES,
  etaChangeCooldownMinutes: ETA_CHANGE_COOLDOWN_MINUTES,
  homeArrivalNotificationEnabled: false,
  productTimezone: PRODUCT_TIMEZONE,
} as const;
