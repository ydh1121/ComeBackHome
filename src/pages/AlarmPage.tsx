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
  const computed = useMemo(() => {
    try { return { plan: scope && schedule.status === 'ready' ? buildClockAlarmPlan(schedule.entries, scope, now, schedule.personId ?? 'none') : null, invalid: false }; }
    catch { return { plan: null, invalid: true }; }
  }, [scope, schedule, now]);
  const plan = computed.plan;
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
    {computed.invalid ? <p role="alert">일정의 날짜와 출퇴근시간을 확인해 주세요.</p> : null}
    <ul className="alarm-targets">{plan?.targets.map(target => <li key={target.id}>{alarmDisplayDate(target.fireAt)} {target.clockTime} · {target.kind === 'START_MINUS_90' ? '출근 준비' : '퇴근 후'}</li>)}</ul>
    {plan && !plan.targets.length ? <p>앞으로 24시간 안에 설정할 알람이 없습니다.</p> : null}
    <button className="cta secondary" onClick={() => setNow(new Date())}>일정 다시 계산</button>
    <details><summary>단축어 설정 방법</summary>
      <p><a href="/guides/iphone-clock-setup.html" target="_blank" rel="noreferrer">단축어 만들기: 액션 순서와 입력값</a></p>
      <p>기기 시간대는 서울로 설정하고, 매일 또는 일정 변경 후 다시 동기화해 주세요. 특정 알람음은 시계 앱에서 직접 선택해야 합니다.</p>
      {plan ? <p>이 사람의 연동 식별자 <code style={{overflowWrap:'anywhere'}}>{plan.scope}</code></p> : null}
      <p>안내의 개인 알람 보호 절차까지 구성한 후 아래 항목을 체크해 주세요.</p>
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
