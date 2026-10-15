import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({appType:'custom',logLevel:'error',server:{middlewareMode:true}});
try {
  const {buildClockAlarmPlan,validateClockAlarmPlan}=await vite.ssrLoadModule('/src/features/alarms/alarm-plan.ts');
  const {prepareClockReceiver,recordClockCreation}=await vite.ssrLoadModule('/src/features/alarms/clock-receiver.ts');
  const now=new Date('2026-12-31T23:50:00+09:00');
  const entry={id:'work',personId:'person-one',date:'2027-01-01',enabled:true,start:'01:30',end:'08:00'};
  const plan=buildClockAlarmPlan([entry],'install-clock-1',now);
  assert.deepEqual(plan.targets.map(x=>x.clockTime),['00:00','08:30']);
  assert.equal(plan.targets[0].fireAt,'2026-12-31T15:00:00.000Z');
  const options={now,expectedScope:plan.scope,deviceUtcOffset:'+0900'};
  const blank={schema:'cbh-clock-ledger/v1',scope:plan.scope,receipts:[],pending:null};
  const personal={handle:'personal',label:'평소 기상',clockTime:'07:00',enabled:true,repeating:true};
  const spoof={...personal,handle:'spoof',label:plan.scope+'직접 만든 개인 알람'};
  const first=prepareClockReceiver(plan,blank,[personal,spoof],options);
  assert.equal(first.create.length,2);assert.equal(first.remove.length,0);assert.equal(first.deviceApplied,false);
  let ledger=blank;const alarms=[personal,spoof];
  for(const target of first.create){
    ledger={...ledger,pending:{operation:'CREATE',label:target.label}};
    assert.throws(()=>prepareClockReceiver(plan,ledger,alarms,options),/LEDGER_REVIEW/,'interrupted creation cannot silently create duplicates');
    alarms.push({handle:'native-'+alarms.length,label:target.label,clockTime:target.clockTime,enabled:true,repeating:false});
    ledger=recordClockCreation(ledger,target,alarms);
  }
  const again=prepareClockReceiver(plan,ledger,alarms,options);
  assert.deepEqual([again.create.length,again.remove.length,again.enable.length],[0,0,0],'same sync is idempotent');
  const manuallyDeleted=alarms.filter(a=>a.handle!=='native-2');
  const restore=prepareClockReceiver(plan,ledger,manuallyDeleted,options);
  assert.deepEqual(restore.create.map(t=>t.label),[plan.targets[0].label]);
  const restoredAlarm={handle:'restored',label:plan.targets[0].label,clockTime:plan.targets[0].clockTime,enabled:true,repeating:false};
  const restoredLedger=recordClockCreation({...ledger,pending:{operation:'CREATE',label:plan.targets[0].label}},plan.targets[0],[...manuallyDeleted,restoredAlarm]);
  assert.equal(restoredLedger.receipts.length,2,'recreation replaces the old receipt instead of appending a duplicate');
  const afterRestore=prepareClockReceiver(plan,restoredLedger,[...manuallyDeleted,restoredAlarm],options);
  assert.deepEqual([afterRestore.create.length,afterRestore.remove.length,afterRestore.enable.length],[0,0,0]);
  const changed=buildClockAlarmPlan([{...entry,start:'02:00'}],'install-clock-1',now);
  const delta=prepareClockReceiver(changed,ledger,alarms,options);
  assert.deepEqual(delta.remove.map(x=>x.handle),['native-2']);assert.equal(delta.create[0].clockTime,'00:30');
  const off=buildClockAlarmPlan([{...entry,enabled:false}],'install-clock-1',now);
  const offDelta=prepareClockReceiver(off,ledger,alarms,options);
  assert.deepEqual(offDelta.remove.map(x=>x.handle),['native-2','native-3']);assert.equal(offDelta.create.length,0);
  assert.equal(prepareClockReceiver(off,blank,[personal],options).remove.length,0,'empty deletion skips native action');
  const disabled=alarms.map(a=>a.handle==='native-2'?{...a,enabled:false}:a);
  assert.deepEqual(prepareClockReceiver(plan,ledger,disabled,options).enable.map(x=>x.handle),['native-2']);
  assert.throws(()=>prepareClockReceiver(plan,blank,alarms,options),/UNOWNED_TARGET/,'lost ledger cannot adopt matching labels');
  assert.throws(()=>prepareClockReceiver(plan,ledger,[...alarms,{...alarms[2],handle:'other'}],options),/AMBIGUOUS_OWNED/);
  assert.throws(()=>prepareClockReceiver(plan,ledger,alarms.map(a=>a.handle==='native-2'?{...a,clockTime:'01:00'}:a),options),/CHANGED_OUTSIDE/);
  assert.throws(()=>prepareClockReceiver(plan,ledger,alarms,{...options,deviceUtcOffset:'+0000'}),/TIMEZONE/);
  assert.throws(()=>prepareClockReceiver(plan,ledger,alarms,{...options,expectedScope:'CBH:another-install:person-one:'}),/INVALID_ALARM_PLAN/);
  const mutations=[p=>p.targets.push(p.targets[0]),p=>p.targets[0].clockTime='13:00',p=>p.targets[0].kind='DELETE_ALL',
    p=>p.targets[0].workDate='2027-02-30',p=>p.targets[0].id='arbitrary',p=>p.targets[0].label='personal',
    p=>p.targets[0].fireAt='2027-01-03T00:00:00Z',p=>p.deviceApplied=true,p=>p.requiresDailySync=false,
    p=>p.targets[0].fireAt='2026-12-31T14:59:01Z'];
  for(const mutate of mutations){const bad=structuredClone(plan);mutate(bad);assert.throws(()=>validateClockAlarmPlan(bad,now));}
  assert.throws(()=>validateClockAlarmPlan(plan,new Date(now.getTime()+300000)),/STALE/);
  const closeToRing=new Date('2026-12-31T23:59:00+09:00');
  const soon=buildClockAlarmPlan([entry],'install-clock-1',closeToRing);
  assert.throws(()=>validateClockAlarmPlan(soon,new Date('2027-01-01T00:00:00+09:00')),/INVALID_ALARM_TARGET/,'an elapsed alarm is rejected even while the five-minute input is valid');
  assert.throws(()=>buildClockAlarmPlan([{...entry,start:'25:00'}],'install-clock-1',now),/INVALID_ALARM_SCHEDULE/);
  assert.throws(()=>buildClockAlarmPlan([{...entry,date:'2027-02-30'}],'install-clock-1',now),/INVALID_ALARM_SCHEDULE/);
  const overnight=buildClockAlarmPlan([{...entry,date:'2026-12-31',start:'22:00',end:'02:00'}],'install-clock-1',now);
  assert.deepEqual(overnight.targets.map(x=>[x.clockTime,x.workDate]),[['02:30','2026-12-31']]);
  console.log('CBH_CLOCK_RECEIVER_CONTRACT_PASS midnight overnight OFF changed duplicate expiry timezone ownership disabled journal failure collision personal_untouched native_actions=0');
} finally {await vite.close();}
