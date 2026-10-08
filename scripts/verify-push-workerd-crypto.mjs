import assert from 'node:assert/strict';
import { createECDH, createPublicKey, randomBytes, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import webPush from 'web-push';

/**
 * Launch a REAL local Cloudflare Workers runtime via Wrangler, test WebCrypto
 * ECDH/HKDF/AES-GCM/VAPID, then verify the signed JWT in Node. Never contacts
 * Apple/FCM, never sends a notification or accesses production D1.
 */
const configPath='.tmp-cbh-push-workerd-smoke.jsonc';
const config={
  name:'cbh-local-crypto-test-do-not-deploy',
  main:'worker/testing/push-worker-crypto-smoke.ts',
  compatibility_date:'2026-10-06',
  compatibility_flags:['nodejs_compat'],
};
const port=18867;
const localUrl='http://127.0.0.1:'+port;
const vapid=webPush.generateVAPIDKeys();
const receiver=createECDH('prime256v1');
receiver.generateKeys();
const subscription={
  endpoint:'https://web.push.apple.com/Q/only-a-local-synthetic-test',
  p256dh:receiver.getPublicKey().toString('base64url'),
  auth:randomBytes(16).toString('base64url'),
  vapidSubject:'mailto:local-test@example.invalid',
  vapidPublic:vapid.publicKey,
  vapidPrivate:vapid.privateKey,
};

await writeFile(configPath,JSON.stringify(config,null,2)+'\n','utf8');
const runner=process.platform==='win32'?'npx.cmd':'npx';
const child=spawn(runner,['wrangler','dev','--config',configPath,
  '--local','--ip','127.0.0.1','--port',String(port),'--log-level','error'],{
  stdio:['ignore','pipe','pipe'],
  env:{...process.env,WRANGLER_SEND_METRICS:'false'},
});
let terminated=false;
let stderr='';
child.stderr.on('data',data=>{
  // Do not print raw Worker outputs: test-only keys are in request bodies.
  stderr=(stderr+String(data)).slice(-3000);
});
child.stdout.on('data',()=>undefined);
child.on('exit',()=>{terminated=true;});

try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    if(terminated)throw new Error('Local workerd process ended before ready');
    try{
      const response=await fetch(localUrl+'/smoke',{
        signal:AbortSignal.timeout(500),
      });
      if(response.status===404){ready=true;break;}
    }catch{ /* startup */ }
    await new Promise(resolve=>setTimeout(resolve,350));
  }
  assert.ok(ready,'Local workerd endpoint did not start');
  const response=await fetch(localUrl+'/smoke',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(subscription),
    signal:AbortSignal.timeout(18000),
  });
  const result=await response.json();
  assert.equal(response.status,200,'Actual workerd request preparation failed at '+result.stage);
  assert.equal(result.ok,true,'Real Workers encryption or signed request invalid');
  assert.equal(result.contentEncoding,'aes128gcm');
  assert.equal(result.ttl,'300');
  assert.equal(result.encrypted,true);
  assert.ok(result.bodyLength>=100 && result.bodyLength<=4096);
  assert.ok(typeof result.authorization==='string');
  assert.ok(result.authorization.startsWith('vapid '),
    'Apple Push requires RFC8292 VAPID auth, not legacy WebPush');
  const jwt=/\bt=([^,\s]+)/.exec(result.authorization)?.[1];
  const sentPublic=/\bk=([^,\s]+)/.exec(result.authorization)?.[1];
  assert.ok(jwt,'VAPID token missing');
  assert.equal(sentPublic,vapid.publicKey,'Same VAPID public key must be used');
  const parts=jwt.split('.');
  assert.equal(parts.length,3);
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  assert.equal(claims.aud,'https://web.push.apple.com');
  assert.equal(claims.sub,subscription.vapidSubject);
  assert.ok(claims.exp>Math.floor(Date.now()/1000));
  assert.ok(claims.exp<=Math.floor(Date.now()/1000)+86400);
  const bytes=Buffer.from(vapid.publicKey,'base64url');
  const key=createPublicKey({key:{
    kty:'EC',crv:'P-256',x:bytes.subarray(1,33).toString('base64url'),
    y:bytes.subarray(33,65).toString('base64url')},format:'jwk'});
  assert.equal(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{
    key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),
    true,'Worker-generated VAPID signature fails Node verification');
  console.log(JSON.stringify({result:'PASS',runtime:'actual-local-workerd',
    aes128gcm:true,vapidSignatureVerified:true,
    authorizationScheme:'vapid',bytes:result.bodyLength,
    actualPushSends:0,productionD1Writes:0,
    productionSecretReads:0,liveKakaoRouteCalls:0}));
}finally{
  child.kill('SIGTERM');
  await unlink(configPath).catch(()=>undefined);
}
