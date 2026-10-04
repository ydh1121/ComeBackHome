import type { ImportBatch, NotificationSettings, Person, Place, RouteCandidate, RoutePreference, ScheduleEntry, TodaySnapshot, TransitAccessPoint } from '../domain/models';

export interface MockState {
  selectedPersonId: string | null;
  people: Person[];
  schedules: ScheduleEntry[];
  places: Place[];
  accessPoints: TransitAccessPoint[];
  routePreferences: RoutePreference[];
  routeCandidates: RouteCandidate[];
  todaySnapshots: TodaySnapshot[];
  importBatches: ImportBatch[];
  committedImportBatchIds: string[];
  notifications: NotificationSettings;
}

function buildScheduleFixture(): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const dd = String(day).padStart(2, '0');
    const date = `2026-10-${dd}`;
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    const enabled = day !== 4 && weekday !== 2 && weekday !== 4 && day % 9 !== 1;
    const startHour = day === 5 ? 14 : 12 + ((day - 1) % 4);
    const endHour = day === 5 ? 22 : 20 + ((day - 1) % 3);
    const startMinute = day === 5 ? '00' : day % 2 === 0 ? '30' : '00';
    const endMinute = day === 5 ? '10' : day % 2 === 0 ? '30' : '10';

    entries.push({
      id: `mock-schedule-${dd}`,
      personId: 'mock-person-1',
      date,
      enabled,
      start: `${String(startHour).padStart(2, '0')}:${startMinute}`,
      end: `${String(endHour).padStart(2, '0')}:${endMinute}`,
    });
  }
  return entries;
}

export const MOCK_FIXTURE: MockState = {
  selectedPersonId: 'mock-person-1',
  people: [{ id: 'mock-person-1', name: '여자친구', relation: '연인' }],
  schedules: buildScheduleFixture(),
  places: [
    { id: 'mock-place-origin', personId: 'mock-person-1', kind: 'origin', label: '샘플 근무지', address: { road: '테스트 도로 1' }, coordinate: { x: 127, y: 37.5 }, providerPlaceId: 'mock-provider-origin' },
    { id: 'mock-place-destination', personId: 'mock-person-1', kind: 'destination', label: '샘플 집', address: { road: '테스트 도로 2' }, coordinate: { x: 126.9, y: 37.4 }, providerPlaceId: 'mock-provider-destination' },
  ],
  accessPoints: [
    { id: 'mock-access-bus', personId: 'mock-person-1', providerId: 'mock-stop-id', placeKind: 'origin', mode: 'BUS', name: '샘플 정류장 A', displayCode: 'QA-1001', walkMinutes: 3, selected: true },
    { id: 'mock-access-subway', personId: 'mock-person-1', providerId: 'mock-station-id', placeKind: 'origin', mode: 'SUBWAY', name: '샘플 환승역', line: '샘플선 A', walkMinutes: 7, selected: true },
  ],
  routePreferences: [{ id: 'mock-route-pref', personId: 'mock-person-1', originPlaceKind: 'origin', destinationPlaceKind: 'destination', viaAccessPointIds: ['mock-access-bus', 'mock-access-subway'] }],
  routeCandidates: [
    { id: 'mock-route-fast', personId: 'mock-person-1', totalMinutes: 38, transferCount: 2, walkMinutes: 7, steps: [{ type: 'WALKING', label: '출발지 → 샘플 정류장 A' }, { type: 'BUS', label: '샘플 정류장 A → 샘플 환승역' }, { type: 'SUBWAY', label: '샘플 환승역 → 샘플 도착역' }, { type: 'WALKING', label: '샘플 도착역 → 도착지' }] },
    { id: 'mock-route-simple', personId: 'mock-person-1', totalMinutes: 44, transferCount: 1, walkMinutes: 11, steps: [{ type: 'SUBWAY', label: '샘플 출발역 → 샘플 도착역' }] },
  ],
  todaySnapshots: [{ personId: 'mock-person-1', eta: { personId: 'mock-person-1', status: 'LIVE', arrivalTime: '23:18', freshnessMinutes: 1 }, shiftEnd: '22:10', routeCandidateId: 'mock-route-fast' }],
  importBatches: [{ id: 'mock-import-1', reviewItems: [{ id: 'mock-review-1', personId: 'mock-person-1', date: '2026-10-06', existing: { start: '10:00', end: '19:00' }, imported: { start: '11:00', end: '20:00' }, resolution: 'NEW' }] }],
  committedImportBatchIds: [],
  notifications: { permission: 'default', rules: { shiftEnd: true, etaChange: false } },
};

export class MockStateStore {
  private version = 0;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly state: MockState) {}
  read(): MockState { return this.state; }
  mutate(mutator: (state: MockState) => void): void {
    mutator(this.state);
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getVersion(): number { return this.version; }
}
