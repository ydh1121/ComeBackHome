import type {
  NotificationJobStore,
  NotificationPayload,
} from './contracts';
import type {
  PersonRepository,
  ScheduleRepository,
} from '../src/application/contracts/repositories';
import type { Person, ScheduleEntry } from '../src/domain/models';

export type PresenceEventType = 'LEFT_WORK' | 'ARRIVED_HOME';

export interface PresenceEventInput {
  eventId: string;
  personId: string;
  type: PresenceEventType;
}

export interface PresenceEventDependencies {
  jobs: NotificationJobStore;
  people: PersonRepository;
  schedules: ScheduleRepository;
}

export interface PresenceEventResult {
  eventId: string;
  personId: string;
  type: PresenceEventType;
  acceptedAt: string;
}

const PRODUCT_TIMEZONE = 'Asia/Seoul';

function seoulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRODUCT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function nextWork(
  schedules: ScheduleEntry[],
  currentDate: string,
): ScheduleEntry | null {
  return schedules
    .filter((schedule) => schedule.enabled && schedule.date > currentDate)
    .sort((left, right) =>
      left.date.localeCompare(right.date) ||
      left.start.localeCompare(right.start)
    )[0] ?? null;
}

function nextWorkDisplay(schedule: ScheduleEntry | null): string {
  if (!schedule) return '다음 출근 일정 없음';
  const [, month, day] = schedule.date.split('-');
  return '다음 출근 ' + Number(month) + '/' + Number(day) + ' ' + schedule.start;
}

function payloadFor(
  person: Person,
  type: PresenceEventType,
  futureWork: ScheduleEntry | null,
): NotificationPayload {
  const next = nextWorkDisplay(futureWork);
  if (type === 'LEFT_WORK') {
    return {
      title: person.name + ' 퇴근',
      body: '회사 이탈 신호 수신 · ' + next,
      tag: 'cbh:presence:left-work:' + person.id,
      path: '/',
    };
  }

  return {
    title: person.name + ' 집 도착',
    body: '집 도착 신호 수신 · ' + next,
    tag: 'cbh:presence:arrived-home:' + person.id,
    path: '/',
  };
}

export function isPresenceEventAuthorized(
  request: Request,
  configuredToken: string | undefined,
): boolean {
  const token = configuredToken?.trim() ?? '';
  if (!token) return false;
  return request.headers.get('Authorization') === 'Bearer ' + token;
}

export async function enqueuePresenceEvent(
  dependencies: PresenceEventDependencies,
  input: PresenceEventInput,
  now: Date = new Date(),
): Promise<PresenceEventResult> {
  const eventId = input.eventId.trim();
  const personId = input.personId.trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(eventId)) {
    throw new Error('eventId is invalid.');
  }
  if (!personId) throw new Error('personId is required.');
  if (input.type !== 'LEFT_WORK' && input.type !== 'ARRIVED_HOME') {
    throw new Error('Presence event type is invalid.');
  }

  const person = await dependencies.people.get(personId);
  if (!person) throw new Error('Person was not found.');

  const acceptedAt = now.toISOString();
  const schedules = await dependencies.schedules.list(personId);
  const futureWork = nextWork(schedules, seoulDate(now));
  const payload = payloadFor(person, input.type, futureWork);
  const typeSlug = input.type === 'LEFT_WORK' ? 'left-work' : 'arrived-home';

  await dependencies.jobs.enqueueOnce({
    id: crypto.randomUUID(),
    dedupeKey: 'presence:' + typeSlug + ':' + personId + ':' + eventId,
    personId,
    type: 'presence-' + typeSlug,
    scheduledFor: acceptedAt,
    nextAttemptAt: acceptedAt,
    payload,
  });

  return {
    eventId,
    personId,
    type: input.type,
    acceptedAt,
  };
}
