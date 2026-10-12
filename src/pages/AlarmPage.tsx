import { useMemo, useState } from 'react';
import { useSelectedSchedule } from '../features/schedule/useSelectedSchedule';
import { alarmDisplayDate, buildClockAlarmPlan, clockShortcutUrl } from '../features/alarms/alarm-plan';
import { BackButton } from '../shared/components/BackButton';
import '../pages/notification-page.css';

function installationId(): string {
  const key = 'cbh:clock-installation:v1';
  const previous = localStorage.getItem(key);
  if (previous && /^[a-zA-Z0-9-]{8,64}$/.test(previous)) return previous;
  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}
export function AlarmPage() {
  const schedule = useSelectedSchedule();
  const [now, setNow] = useState(() => new Date());
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState('');
  const [scope] = useState(() => { try { return installationId(); } catch { return null; } });
  const plan = useMemo(() => scope && schedule.status === 'ready' ? buildClockAlarmPlan(schedule.entries, scope, now, schedule.personId ?? 'none') : null, [scope, schedule, now]);
  const download = () => {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ComeBackHome-clock-plan.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <section className="notification-page" data-page="AlarmPage" data-device-applied="false">
    <BackButton fallbackTo="/settings" /><h1 className="page-title">iPhone 시계 알람</h1>
    <p>출근 90분 전, 퇴근 30분 후에 울릴 알람입니다. 휴무는 제외합니다.</p>
    <p>단축어 설정이 필요합니다. 앱에서 알람 적용 여부는 확인할 수 없습니다.</p>
    {!scope ? <p role="alert">기기 저장소를 사용할 수 없어 개인 알람 보호용 식별자를 저장하지 못했습니다.</p> : null}
    {schedule.status === 'error' ? <p role="alert">일정을 불러오지 못했습니다.</p> : null}
    <ul className="alarm-targets">{plan?.targets.map(target => <li key={target.id}>{alarmDisplayDate(target.fireAt)} {target.clockTime} · {target.kind === 'START_MINUS_90' ? '출근 준비' : '퇴근 후'}</li>)}</ul>
    {plan && !plan.targets.length ? <p>앞으로 24시간 안에 설정할 알람이 없습니다.</p> : null}
    <button className="cta secondary" onClick={() => setNow(new Date())}>일정 다시 계산</button>
    <details><summary>단축어 설정 방법</summary>
      <ol>
        <li>단축어 앱에서 ‘ComeBackHome 알람 동기화’를 만들고 텍스트 입력을 사전으로 변환합니다.</li>
        <li>데이터의 유효시간과 Asia/Seoul 시간대를 확인합니다. 만료됐으면 중단하고 앱에서 다시 계산합니다.</li>
        <li>‘알람 찾기’ 결과를 단축어가 직접 생성한 앱 알람의 고유 레이블·시각 기록과 대조합니다. CBH 기기 식별자도 일치해야 합니다.</li>
        <li>필요 없는 앱 소유 알람만 선택해 ‘알람 삭제’에 전달합니다. 일치 항목이 0개면 삭제 동작을 실행하지 않습니다. 개인 알람은 포함하지 않습니다.</li>
        <li>targets의 시각·레이블로 누락된 알람을 생성하고 앱의 대상 ID·레이블·시각을 기록합니다. 같은 알람은 중복 생성하지 않습니다.</li>
        <li>기기의 시간대를 서울로 설정합니다. 시계 알람은 날짜를 지정할 수 없으므로 24시간 안의 항목만 받습니다. 매일 또는 일정 변경 후 다시 동기화합니다.</li>
      </ol>
      <p>설정과 실제 알람 동작은 iPhone에서 별도 확인해야 합니다.</p>
    </details>
    <button className="cta secondary" disabled={!plan} onClick={download}>알람 데이터 다운로드</button>
    <label className="alarm-confirm"><input type="checkbox" checked={configured} onChange={event => setConfigured(event.target.checked)} />개인 알람 보호 절차를 포함한 단축어를 설정했습니다.</label>
    <button className="cta" disabled={!plan || !configured} onClick={() => {
      if (!plan) return;
      if (Date.parse(plan.expiresAt) <= new Date().getTime()) { setError('데이터가 만료됐습니다. 일정을 다시 계산해 주세요.'); return; }
      window.location.href = clockShortcutUrl(plan);
    }}>단축어에서 확인하고 적용</button>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
