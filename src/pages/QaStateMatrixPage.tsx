import { useEffect, useState } from 'react';
import { useApplicationServices, useApplicationVersion } from '../app/ApplicationServicesContext';
import type { TodayOverviewQueryResult } from '../application/queries/ComeBackHomeQueries';
import type { NotificationSettings, TransitAccessPoint } from '../domain/models';
import { useOnlineStatus } from '../shared/runtime/useOnlineStatus';
import './qa-page.css';

type State = {
  status: 'loading' | 'ready' | 'error';
  today?: TodayOverviewQueryResult;
  notifications?: NotificationSettings;
  access?: TransitAccessPoint[];
};

function currentLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + month + '-' + day;
}

export function QaStateMatrixPage() {
  const services = useApplicationServices();
  const version = useApplicationVersion();
  const online = useOnlineStatus();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    const personId = services.actions.personSelection.getSelectedPersonId();
    Promise.all([
      services.queries.getTodayOverview(currentLocalDate()),
      services.queries.getNotificationSettings(),
      personId ? services.queries.getTransitAccess(personId, 'origin', 'all') : Promise.resolve([]),
    ]).then(([today, notifications, access]) => {
      if (active) setState({ status: 'ready', today, notifications, access });
    }).catch(() => {
      if (active) setState({ status: 'error' });
    });
    return () => { active = false; };
  }, [services, version]);

  if (state.status === 'loading') return <section className="qa-page"><div className="qa-message">상태 점검 정보를 불러오는 중</div></section>;
  if (state.status === 'error') return <section className="qa-page"><div className="qa-message">상태 점검 정보를 불러오지 못했습니다.</div></section>;

  const origin = state.access ?? [];
  const etaTime = state.today?.eta?.arrivalTime ?? '—';
  const filters = [
    ['전체', origin],
    ['지하철', origin.filter((point) => point.mode === 'SUBWAY')],
    ['버스', origin.filter((point) => point.mode === 'BUS')],
    ['결과 없음', [] as TransitAccessPoint[]],
  ] as const;

  return (
    <section className="qa-page" data-route="/__qa/states" data-page="StateMatrix" data-state={online ? 'READY' : 'OFFLINE'}>
      <h1 className="page-title">상태 점검</h1>

      <div className="matrix">
        <div className="matrix-row matrix-head"><div>영역</div><div>상태</div><div>확인</div></div>
        {[
          ['오늘','ETA / OFFLINE','완료'],
          ['일정','조회 / 빈 상태 / 편집 저장','완료'],
          ['가져오기','파일 / 사람 연결 / 구조 / 충돌','완료'],
          ['사람','목록 / 추가 / 수정 / 상세','완료'],
          ['이동 경로','장소 / 경로 / 교통 / 검색','완료'],
          ['알림','권한 / 규칙 / 테스트','완료'],
        ].map((row) => <div className="matrix-row" key={row[0]}>{row.map((cell) => <div key={cell}>{cell}</div>)}</div>)}
      </div>

      <div className="eta-qa">
        <div className="eta-qa-title">오늘 · 도착 시간 상태</div>
        <div className="eta-qa-grid">
          {[
            ['실시간','1분 전',etaTime],
            ['정보 지연','12분 전',etaTime],
            ['평균값','실시간 정보 없음',etaTime],
            ['계산 불가','경로 정보 없음','—'],
          ].map((row) => <div className="eta-qa-row" key={row[0]}><b>{row[0]}</b><span>{row[1]}</span><strong>{row[2]}</strong></div>)}
        </div>
      </div>

      <div className="filter-qa">
        <div className="filter-qa-title">일정 · 보기 상태</div>
        <div className="filter-qa-grid">
          {[
            ['1일','상세 세로 목록'],
            ['1주','7일 압축 목록'],
            ['2주','7열 × 2주 그리드'],
            ['1개월','월간 7열 캘린더'],
          ].map((row) => <div className="filter-qa-card" key={row[0]}><div className="filter-qa-chip">{row[0]}</div><div className="filter-qa-row">{row[1]}</div></div>)}
        </div>
      </div>

      <div className="filter-qa">
        <div className="filter-qa-title">근처 교통 · 필터 상태</div>
        <div className="filter-qa-grid">
          {filters.map(([label, items]) => (
            <div className="filter-qa-card" key={label}>
              <div className="filter-qa-chip">{label}</div>
              {items.length ? items.map((point) => <div className="filter-qa-row" key={point.id}>{point.mode === 'BUS' ? '버스' : '지하철'} · {point.userLabel || point.name}</div>) : <div className="filter-qa-empty">조건에 맞는 교통 없음</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="runtime-qa">
        <div><b>네트워크</b><span>{online ? 'ONLINE' : 'OFFLINE'}</span></div>
        <div><b>알림 권한</b><span>{state.notifications?.permission ?? 'unknown'}</span></div>
      </div>
      <div className="data-source-qa">
        Application boundary: queries/actions · persistence: {services.runtime.persistence} · provider: {services.runtime.providerData}
      </div>
    </section>
  );
}
