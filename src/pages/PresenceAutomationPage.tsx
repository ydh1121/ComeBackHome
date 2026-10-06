import { useEffect, useMemo, useState } from 'react';
import { useApplicationServices } from '../app/ApplicationServicesContext';
import type { Person } from '../domain/models';
import { BackButton } from '../shared/components/BackButton';
import './presence-automation-page.css';

const PRESENCE_ENDPOINT = 'https://come-back-home.pages.dev/api/presence-events';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; configured: boolean; people: Person[] }
  | { status: 'error' };

type ValidationState = 'idle' | 'checking' | 'valid' | 'invalid';

function eventPayload(personId: string, type: 'LEFT_WORK' | 'ARRIVED_HOME'): string {
  const prefix = type === 'LEFT_WORK' ? 'left-work' : 'arrived-home';
  return JSON.stringify({
    eventId: prefix + '-[현재날짜-YYYYMMDDHHmmss]',
    personId,
    type,
  }, null, 2);
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export function PresenceAutomationPage() {
  const services = useApplicationServices();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [personId, setPersonId] = useState('');
  const [token, setToken] = useState('');
  const [validation, setValidation] = useState<ValidationState>('idle');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      services.actions.presenceAutomation.getStatus(),
      services.queries.listPeople(),
    ]).then(([status, people]) => {
      if (!active) return;
      setLoad({ status: 'ready', configured: status.configured, people });
      const selected = services.actions.personSelection.getSelectedPersonId();
      setPersonId(
        selected && people.some((person) => person.id === selected)
          ? selected
          : people[0]?.id ?? '',
      );
    }).catch(() => {
      if (active) setLoad({ status: 'error' });
    });
    return () => { active = false; };
  }, [services]);

  const selectedPerson = load.status === 'ready'
    ? load.people.find((person) => person.id === personId) ?? null
    : null;

  const authorization = useMemo(
    () => validation === 'valid' ? 'Bearer ' + token.trim() : '',
    [validation, token],
  );

  const validate = async () => {
    if (!token.trim()) return;
    setValidation('checking');
    const valid = await services.actions.presenceAutomation.validateToken(token).catch(() => false);
    setValidation(valid ? 'valid' : 'invalid');
  };

  const copy = async (key: string, value: string) => {
    await copyText(value);
    setCopied(key);
    window.setTimeout(() => setCopied((current) => current === key ? null : current), 1200);
  };

  if (load.status === 'loading') {
    return <section className="presence-automation-page"><div className="presence-message">자동화 설정을 불러오는 중</div></section>;
  }

  if (load.status === 'error') {
    return <section className="presence-automation-page"><div className="presence-message">자동화 설정을 불러오지 못했습니다.</div></section>;
  }

  return (
    <section className="presence-automation-page" data-page="PresenceAutomationPage" data-state={validation.toUpperCase()}>
      <BackButton fallbackTo="/settings" />
      <h1 className="page-title">퇴근 · 귀가 자동화</h1>
      <p className="presence-intro">
        iPhone 단축어의 위치 자동화를 사용해 회사에서 나갈 때와 집에 도착할 때 ComeBackHome으로 신호를 보냅니다.
      </p>

      <div className={'presence-ready-card' + (load.configured ? ' ready' : ' blocked')}>
        <b>{load.configured ? '서버 자동화 준비됨' : '서버 자동화 설정 필요'}</b>
        <span>{load.configured ? '인증 토큰을 확인한 뒤 단축어를 구성할 수 있습니다.' : '서버의 PRESENCE_EVENT_INGEST_TOKEN 설정이 필요합니다.'}</span>
      </div>

      <label className="presence-field">
        <span>대상 사람</span>
        <select value={personId} onChange={(event) => setPersonId(event.target.value)}>
          {load.people.map((person) => (
            <option value={person.id} key={person.id}>{person.name}{person.relation ? ' · ' + person.relation : ''}</option>
          ))}
        </select>
      </label>

      <label className="presence-field">
        <span>자동화 인증 토큰</span>
        <input
          type="password"
          value={token}
          autoComplete="off"
          placeholder="PRESENCE_EVENT_INGEST_TOKEN"
          onChange={(event) => {
            setToken(event.target.value);
            setValidation('idle');
          }}
        />
      </label>
      <button type="button" className="presence-validate" disabled={!load.configured || !token.trim() || validation === 'checking'} onClick={validate}>
        {validation === 'checking' ? '확인 중' : validation === 'valid' ? '토큰 확인됨' : '토큰 확인'}
      </button>
      {validation === 'invalid' ? <div className="presence-error" role="alert">토큰이 서버 설정과 일치하지 않습니다.</div> : null}

      {validation === 'valid' && selectedPerson ? (
        <>
          <div className="presence-copy-block">
            <div><span>요청 URL</span><code>{PRESENCE_ENDPOINT}</code></div>
            <button type="button" onClick={() => copy('url', PRESENCE_ENDPOINT)}>{copied === 'url' ? '복사됨' : '복사'}</button>
          </div>
          <div className="presence-copy-block">
            <div><span>Authorization 헤더 값</span><code>Bearer ••••••••</code></div>
            <button type="button" onClick={() => copy('auth', authorization)}>{copied === 'auth' ? '복사됨' : '복사'}</button>
          </div>

          <AutomationCard
            title="회사에서 나갈 때"
            trigger="단축어 개인용 자동화 → 떠날 때 → 근무지"
            payload={eventPayload(selectedPerson.id, 'LEFT_WORK')}
            copied={copied === 'left'}
            onCopy={() => copy('left', eventPayload(selectedPerson.id, 'LEFT_WORK'))}
          />
          <AutomationCard
            title="집에 도착할 때"
            trigger="단축어 개인용 자동화 → 도착할 때 → 집"
            payload={eventPayload(selectedPerson.id, 'ARRIVED_HOME')}
            copied={copied === 'home'}
            onCopy={() => copy('home', eventPayload(selectedPerson.id, 'ARRIVED_HOME'))}
          />

          <div className="presence-steps">
            <b>단축어 요청 구성</b>
            <ol>
              <li>위 위치 트리거를 선택하고 자동 실행으로 설정합니다.</li>
              <li>현재 날짜를 가져와 YYYYMMDDHHmmss 형식으로 포맷해 eventId의 대괄호 부분에 넣습니다.</li>
              <li>URL의 콘텐츠 가져오기에서 POST를 선택합니다.</li>
              <li>Authorization 헤더에 위 값을 넣고 요청 본문을 JSON으로 설정합니다.</li>
              <li>회사 이탈과 집 도착 자동화를 각각 저장합니다.</li>
            </ol>
          </div>
        </>
      ) : null}
    </section>
  );
}

function AutomationCard({
  title,
  trigger,
  payload,
  copied,
  onCopy,
}: {
  title: string;
  trigger: string;
  payload: string;
  copied: boolean;
  onCopy(): void;
}) {
  return (
    <div className="presence-automation-card">
      <div className="presence-automation-head">
        <div><b>{title}</b><span>{trigger}</span></div>
        <button type="button" onClick={onCopy}>{copied ? '복사됨' : 'JSON 복사'}</button>
      </div>
      <pre>{payload}</pre>
    </div>
  );
}
