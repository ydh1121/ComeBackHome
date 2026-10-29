import type { CaseRecord } from '../domain/records';
import { todaySeoul, validDate } from '../domain/dates';

export type ReemploymentStage = 'applied' | 'treatment' | 'ended' | 'disability' | 'unemployment' | 'unknown';
export type ReemploymentIntent = 'planned' | 'working';
export type ReviewDateStatus = 'complete' | 'open' | 'missing' | 'invalid';
type Certainty = CaseRecord['payload']['certainty'];
type Data = CaseRecord['payload']['data'];

export interface EmploymentSummary {
  recordId: string;
  title: string;
  employerName: string;
  jobTitle: string;
  kind: 'actual' | 'planned' | 'unknown';
  certainty: Certainty;
  sourceIds: string[];
  hireDate: string | null;
  firstWorkDate: string | null;
  lastWorkDate: string | null;
  contractEnd: string | null;
  from: string | null;
  to: string | null;
  basis: 'work_dates' | 'employment_dates' | 'missing';
  dateStatus: ReviewDateStatus;
  weeklyHours: number | null;
  wage: number | null;
  wageType: string | null;
}

export interface ReviewPeriod {
  recordId: string;
  title: string;
  kind: 'treatment' | 'workers_comp_leave' | 'unemployment';
  status: string;
  certainty: Certainty;
  sourceIds: string[];
  from: string | null;
  to: string | null;
  dateStatus: ReviewDateStatus;
}

export interface EmploymentPeriodReview {
  employmentId: string;
  periodId: string;
  periodKind: ReviewPeriod['kind'];
  kind: 'actual_overlap' | 'planned_overlap' | 'possible_overlap' | 'date_review';
  from: string | null;
  to: string | null;
  recordIds: string[];
  sourceIds: string[];
  reasons: string[];
}

export interface ReemploymentContext {
  employments: EmploymentSummary[];
  periods: ReviewPeriod[];
  overlaps: EmploymentPeriodReview[];
  hasUncertainRecords: boolean;
}

const text = (value: unknown) => typeof value === 'string' ? value : '';
const date = (value: unknown) => validDate(value) ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
const sources = (record: CaseRecord) => [...new Set(record.payload.sourceIds)];

function dateStatus(data: Data, keys: string[], from: string | null, to: string | null): ReviewDateStatus {
  if (keys.some(key => present(data[key]) && !validDate(data[key])) || (from && to && from > to)) return 'invalid';
  if (!from) return 'missing';
  return to ? 'complete' : 'open';
}

function employment(record: CaseRecord): EmploymentSummary {
  const d = record.payload.data;
  const kind = d.actualOrSimulated === 'actual' || d.actualOrSimulated === 'planned' ? d.actualOrSimulated : 'unknown';
  const hireDate = date(d.hireDate), firstWorkDate = date(d.firstWorkDate), lastWorkDate = date(d.lastWorkDate), contractEnd = date(d.contractEnd);
  const from = firstWorkDate ?? hireDate;
  // A contract expiry is not proof that someone actually worked until that day.
  // It can bound a planned job; an actual job needs its recorded last work date.
  const to = kind === 'planned' ? contractEnd ?? lastWorkDate : lastWorkDate;
  const keys = ['hireDate', 'firstWorkDate', 'lastWorkDate', ...(kind === 'planned' ? ['contractEnd'] : [])];
  return {
    recordId: record.id, title: record.payload.title,
    employerName: text(d.employerName), jobTitle: text(d.jobTitle), kind,
    certainty: record.payload.certainty, sourceIds: sources(record),
    hireDate, firstWorkDate, lastWorkDate, contractEnd, from, to,
    basis: firstWorkDate ? 'work_dates' : hireDate ? 'employment_dates' : 'missing',
    dateStatus: dateStatus(d, keys, from, to),
    weeklyHours: number(d.weeklyHours), wage: number(d.wage), wageType: text(d.wageType) || null,
  };
}

function period(record: CaseRecord): ReviewPeriod {
  const d = record.payload.data, from = date(d.from), to = date(d.to);
  return {
    recordId: record.id, title: record.payload.title,
    kind: record.kind === 'treatment' ? 'treatment' : d.benefitType as ReviewPeriod['kind'],
    status: text(d.status), certainty: record.payload.certainty, sourceIds: sources(record),
    from, to, dateStatus: dateStatus(d, ['from', 'to'], from, to),
  };
}

function compare(job: EmploymentSummary, range: ReviewPeriod, today: string): EmploymentPeriodReview | null {
  const invalid = job.dateStatus === 'invalid' || range.dateStatus === 'invalid';
  // Missing ends stay open and unknown. Do not fill them with today, a claim
  // expiry, a contract expiry or an assumed period of actual work.
  if (!invalid && ((job.from && range.to && job.from > range.to) || (range.from && job.to && range.from > job.to))) return null;
  const reasons: string[] = [];
  if (job.dateStatus !== 'complete') reasons.push('employment_dates_' + job.dateStatus);
  if (range.dateStatus !== 'complete') reasons.push('period_dates_' + range.dateStatus);
  if (job.kind === 'unknown') reasons.push('employment_kind_unknown');
  if (job.basis === 'employment_dates') reasons.push('employment_dates_not_work_days');
  const futureActual = job.kind === 'actual' && [job.from, job.to].some(value => value && value > today);
  if (futureActual) reasons.push('future_actual_dates');
  if (job.certainty !== 'official' || range.certainty !== 'official') reasons.push('records_not_agency_determination');
  const missing = job.dateStatus === 'missing' || range.dateStatus === 'missing';
  const complete = job.dateStatus === 'complete' && range.dateStatus === 'complete';
  const kind = invalid || missing ? 'date_review'
    : !complete || job.kind === 'unknown' || futureActual ? 'possible_overlap'
    : job.kind === 'planned' ? 'planned_overlap' : 'actual_overlap';
  // This is a comparison of recorded ranges only. Even actual_overlap is not
  // a finding of daily work, benefit ineligibility, approval, or overpayment.
  return {
    employmentId: job.recordId, periodId: range.recordId, periodKind: range.kind, kind,
    from: invalid ? null : job.from && range.from ? (job.from > range.from ? job.from : range.from) : null,
    to: invalid ? null : job.to && range.to ? (job.to < range.to ? job.to : range.to) : null,
    recordIds: [job.recordId, range.recordId], sourceIds: [...new Set([...job.sourceIds, ...range.sourceIds])], reasons,
  };
}

/** Read-only hints over the existing case records. Never edits a claim or ledger. */
export function getReemploymentContext(records: CaseRecord[], today = todaySeoul()): ReemploymentContext {
  if (!validDate(today)) throw new Error('INVALID_REVIEW_DATE');
  const active = records.filter(record => !record.archivedAt);
  const employments = active.filter(record => record.kind === 'employment').map(employment);
  const periods = active.filter(record => record.kind === 'treatment' || (record.kind === 'benefit_claim' && ['workers_comp_leave', 'unemployment'].includes(String(record.payload.data.benefitType)))).map(period);
  const overlaps = employments.flatMap(job => periods.flatMap(range => {
    const review = compare(job, range, today);
    return review ? [review] : [];
  }));
  return {
    employments, periods, overlaps,
    hasUncertainRecords: employments.some(job => job.dateStatus !== 'complete' || job.kind === 'unknown' || job.certainty !== 'official' || (job.kind === 'actual' && [job.from, job.to].some(value => value && value > today)))
      || periods.some(range => range.dateStatus !== 'complete' || range.certainty !== 'official'),
  };
}
