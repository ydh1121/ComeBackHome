import { useRef, useState } from "react";
import { privateRequest } from "../../auth/client";
import { summarizeLedger } from "../domain/calculations";
import { todaySeoul } from "../domain/dates";
import type { CaseData } from "./types";
import "../materials/management-ux.css";
export const money = (value: number | null) =>
  value === null ? "아직 확인하지 않았어요" : Math.round(value).toLocaleString("ko-KR") + "원";
export function PaymentsPanel({
  data,
  reload,
}: {
  data: CaseData;
  reload: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [type, setType] = useState("decision"),
    [claimId, setClaimId] = useState(""),
    [step,setStep] = useState(0),
    [message,setMessage] = useState(""),
    [saveAttempted,setSaveAttempted] = useState(false),
    [review,setReview] = useState({amount:"",date:"",days:"",reference:""});
  const formRef=useRef<HTMLFormElement>(null),lock=useRef(false),draftReference=useRef("entry-"+crypto.randomUUID());
  const claims = data.records.filter(
      (r) => r.kind === "benefit_claim" && !r.archivedAt,
    ),
    sources = data.records.filter(
      (r) =>
        r.payload.sourceIds.length &&
        !r.archivedAt &&
        (["decision", "decision_adjustment"].includes(type)
          ? r.payload.certainty === "official"
          : ["documented", "official"].includes(r.payload.certainty)),
    );
  const selectedClaim=claims.some(c=>c.id===claimId)?claimId:claims.length===1?claims[0].id:"";
  const correction=["refund","decision_adjustment"].includes(type);
  const eventNames:Record<string,string>={decision:"기관에서 정한 금액",deposit:"통장에 들어온 돈",decision_adjustment:"결정 금액·일수 정정",refund:"돌려준 돈"};
  const validateStep=(index:number)=>{
    const fields=formRef.current?.querySelectorAll<HTMLInputElement|HTMLSelectElement>(`[data-payment-step="${index}"] input,[data-payment-step="${index}"] select`);
    for(const field of fields??[])if(!field.checkValidity()){setStep(index);const details=field.closest('details');if(details)details.open=true;requestAnimationFrame(()=>field.reportValidity());return false;}
    return true;
  };
  const next=()=>{
    if(!validateStep(step))return;
    if(step===1&&formRef.current){const f=new FormData(formRef.current);setReview({amount:String(f.get("amount")??""),date:String(f.get("date")??""),days:String(f.get("days")??""),reference:String(f.get("reference")??"")});}
    setError("");setStep(v=>Math.min(2,v+1));
  };
  return (
    <section className="payment-workspace" aria-label="받을 돈과 받은 돈">
      <h2>받을 돈과 받은 돈</h2>
      <p className="management-explanation">예상한 금액, 기관에서 정한 금액, 실제 들어온 돈을 나누어 확인해요.</p>
      {claims.map((claim) => {
        const d = claim.payload.data,
          events = data.payments.filter((e) => e.claim_id === claim.id);
        const sum = summarizeLedger(
          {
            benefitType: String(d.benefitType),
            dailyRate: typeof d.dailyRate === "number" ? d.dailyRate : null,
            allocatedDays:
              typeof d.allocatedDays === "number" ? d.allocatedDays : null,
            expectedAmount:
              typeof d.expectedAmount === "number" ? d.expectedAmount : null,
            officialRemainingDays:
              typeof d.officialRemainingDays === "number"
                ? d.officialRemainingDays
                : null,
          },
          events.map((e) => ({
            id: e.id,
            eventType: e.event_type,
            amount: e.amount,
            recognizedDays: e.recognized_days,
          })),
        );
        return (
          <article className="private-card" key={claim.id}>
            <h3>{claim.payload.title}</h3>
            <dl className="ledger-grid">
              {(
                [
                  ["예상 총액", money(sum.expectedTotal)],
                  ["기관에서 정한 금액", money(sum.approvedTotal)],
                  ["실제 들어온 돈", money(sum.actualPaid)],
                  ["결정됐지만 아직 안 들어온 돈", money(sum.approvedOutstanding)],
                  ["아직 결정되지 않은 예상액", money(sum.conditionalRemaining)],
                  ["기관이 인정한 날짜 수", sum.recognizedDays + "일"],
                  [
                    "남은 날짜 수",
                    sum.remainingDays === null
                      ? "아직 계산되지 않았어요"
                      : sum.remainingDays + "일",
                  ],
                  ["받을 수 있는 기간의 마지막 날", String(d.expiresAt ?? "확인 필요")],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {sum.needsReconciliation || sum.overpayment > 0 ? (
              <p role="alert">
                결정된 금액·입금액·날짜 수가 서로 맞지 않아요. 아래 내역을 확인해 주세요.
              </p>
            ) : null}
            <details>
              <summary>지급·정정 내역 {events.length}건</summary>
              {events.map((e) => (
                <p key={e.id}>
                  {e.event_date} · {eventNames[e.event_type]} · {money(e.amount)} · {e.recognized_days}일
                </p>
              ))}
            </details>
          </article>
        );
      })}
      {!claims.length ? (
        <div className="payment-empty">
          <h3>아직 정리한 청구 내역이 없어요</h3>
          <p>통지서나 입금 내역을 받았다면 먼저 자료함에 보관해 주세요. 아래 ‘기록 추가’에서 어떤 급여에 관한 내용인지 정리한 뒤 연결할 수 있어요.</p>
          <a href="/injury?section=documents">자료함 열기</a>
        </div>
      ) : (
        <details className="private-card payment-entry">
          <summary>받은 통지서·입금 내역 추가</summary>
          <form ref={formRef} noValidate onSubmit={async(e)=>{
            e.preventDefault();if(lock.current)return;if(step<2){next();return;}
            if(![0,1,2].every(validateStep))return;
            const f=e.currentTarget,d=new FormData(f);
            lock.current=true;setBusy(true);setError("");setMessage("");setSaveAttempted(true);
            try{
              await privateRequest("private/case/payments","POST",{
                claimId:selectedClaim,eventType:type,amount:Number(d.get("amount")),
                recognizedDays:["deposit","refund"].includes(type)?0:Number(d.get("days")),
                eventDate:d.get("date"),sourceRecordId:d.get("source"),correctsId:d.get("corrects"),reference:String(d.get("reference")??"").trim()||draftReference.current,
              });
              f.reset();draftReference.current="entry-"+crypto.randomUUID();setStep(0);setType("decision");setSaveAttempted(false);setMessage("내역을 저장했어요. 기존 내역도 그대로 남아 있어요.");
              try{await reload();}catch{setMessage("내역은 저장됐어요. 목록을 다시 불러오려면 새로고침해 주세요.");}
            }catch(err){setError((err as Error).message.replace(/\s*\([A-Z_]+\)/g, "").replace(/오류 코드: [A-Z_]+/g, "")+" 입력한 내용은 그대로예요. 응답이 끊겼다면 다시 저장해 처리 결과를 확인할 수 있어요.");}
            finally{lock.current=false;setBusy(false);}
          }}>
            <p className="payment-progress">{step+1} / 3 · {['내역 선택','금액과 날짜','근거 확인'][step]}</p>
            <fieldset className="payment-step" data-payment-step="0" hidden={step!==0} disabled={busy}>
              <h3>무엇을 확인했나요?</h3>
              <div className="payment-choices">{(['decision','deposit'] as const).map(value=><button type="button" className="secondary" key={value} aria-pressed={type===value} onClick={()=>{setType(value);setError('');setMessage('');}}>{eventNames[value]}</button>)}</div>
              <details open={correction}><summary>이전 내역을 정정하거나 돈을 돌려줬어요</summary><div className="payment-choices">{(['decision_adjustment','refund'] as const).map(value=><button type="button" className="secondary" key={value} aria-pressed={type===value} onClick={()=>{setType(value);setError('');setMessage('');}}>{eventNames[value]}</button>)}</div></details>
              <label>어떤 급여에 관한 내용인가요?<select value={selectedClaim} required onChange={e=>setClaimId(e.target.value)}><option value="">급여 선택</option>{claims.map(r=><option key={r.id} value={r.id}>{r.payload.title}</option>)}</select></label>
            </fieldset>
            <fieldset className="payment-step" data-payment-step="1" hidden={step!==1} disabled={busy}>
              <h3>{eventNames[type]}을 확인해 주세요</h3>
              <label>{type==='decision_adjustment'?'달라진 금액 (줄었다면 - 표시)':'확인한 금액 (원)'}<input name="amount" type="number" step="1" min={type==='decision_adjustment'?-100000000000:0} max={100000000000} required/></label>
              {!['deposit','refund'].includes(type)&&<label>{type==='decision_adjustment'?'달라진 날짜 수 (줄었다면 - 표시)':'기관이 인정한 날짜 수'}<input name="days" type="number" step="1" min={type==='decision_adjustment'?-1500:0} max={1500} defaultValue={0}/></label>}
              <label>통지서·입금 내역의 날짜<input name="date" type="date" defaultValue={todaySeoul()} required/></label>
              <details><summary>번호를 따로 기록할게요 (선택)</summary><label>통지서·거래 내역에 적힌 번호<input name="reference" minLength={3} maxLength={150}/></label></details>
              <p className="management-explanation">저장이 실패해도 입력한 내용은 유지돼요. 같은 화면에서 다시 시도하면 중복으로 저장되지 않아요.</p>
            </fieldset>
            <fieldset className="payment-step" data-payment-step="2" hidden={step!==2} disabled={busy}>
              <h3>확인한 자료와 연결할게요</h3>
              <dl className="payment-review"><div><dt>내역</dt><dd>{eventNames[type]}</dd></div><div><dt>금액</dt><dd>{money(Number(review.amount))}</dd></div><div><dt>날짜</dt><dd>{review.date}</dd></div></dl>
              <label>이 내용을 확인한 기록<select name="source" required><option value="">원본이 연결된 기록 선택</option>{sources.map(r=><option value={r.id} key={r.id}>{r.payload.title}</option>)}</select></label>
              {!sources.length&&<p className="management-explanation">연결할 수 있는 근거 기록이 아직 없어요. <a href="/injury?section=documents">자료함에서 원본을 확인</a>하고 기록에 연결해 주세요. 지금은 저장하지 않았어요.</p>}
              {correction&&<label>바로잡을 이전 내역<select name="corrects" required><option value="">이전 내역 선택</option>{data.payments.filter(p=>p.claim_id===selectedClaim&&(type==='refund'?p.event_type==='deposit':['decision','decision_adjustment'].includes(p.event_type))).map(p=><option value={p.id} key={p.id}>{p.event_date} · {eventNames[p.event_type]} · {money(p.amount)}</option>)}</select></label>}
              <p className="management-explanation">확인한 내역만 저장해요. 정정할 때도 이전 내역은 지우지 않아요.</p>
            </fieldset>
            <div className="private-actions">{step>0&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setStep(v=>v-1);setError('');}}>이전</button>}<button type="button" className="secondary" disabled={busy} onClick={()=>{formRef.current?.reset();draftReference.current='entry-'+crypto.randomUUID();setStep(0);setType('decision');setError('');setMessage(saveAttempted?'입력을 취소했어요. 저장을 시도한 내역은 목록에서 처리 결과를 확인해 주세요.':'취소했어요. 내역은 저장하지 않았어요.');setSaveAttempted(false);}}>취소</button>{step<2?<button type="button" disabled={busy} onClick={next}>다음</button>:<button disabled={busy||!sources.length}>{busy?'저장 중…':'확인한 내역 저장'}</button>}</div>
            <p role="alert">{error}</p><p role="status">{message}</p>
          </form>
        </details>
      )}
    </section>
  );
}
