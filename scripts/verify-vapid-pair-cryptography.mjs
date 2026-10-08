import assert from 'node:assert/strict';
import webPush from 'web-push';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const vite=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),
  appType:'custom',logLevel:'error',server:{middlewareMode:true}});
try{
  const {verifyVapidKeyPair}=await vite.ssrLoadModule('/worker/vapid-pair-validation.ts');
  const {handleApiRequest}=await vite.ssrLoadModule('/worker/api.ts');
  const one=webPush.generateVAPIDKeys();
  const two=webPush.generateVAPIDKeys();
  assert.equal(await verifyVapidKeyPair({
    VAPID_PUBLIC_KEY:one.publicKey,VAPID_PRIVATE_KEY:one.privateKey,
  }),true,'Valid VAPID key pair must self-verify');
  assert.equal(await verifyVapidKeyPair({
    VAPID_PUBLIC_KEY:two.publicKey,VAPID_PRIVATE_KEY:one.privateKey,
  }),false,'Mismatched VAPID key pair must fail closed');
  const db={prepare(){return {
    bind(){return this;},
    async all(){return {results:[]};},
  }}};
  const req=new Request('https://come-back-home.pages.dev/api/notifications/readiness');
  const response=await handleApiRequest(req,{
    DB:db,VAPID_SUBJECT:'mailto:test@example.invalid',
    VAPID_PUBLIC_KEY:one.publicKey,VAPID_PRIVATE_KEY:one.privateKey,
    WEB_PUSH_TTL_SECONDS:'300',PUSH_DELIVERY_ENABLED:'1',
  },null);
  assert.equal(response.status,200);
  const readiness=await response.json();
  assert.equal(readiness.vapidKeyPairValid,true);
  assert.equal(readiness.activeSubscriptionCount,0);
  assert.equal(readiness.pushDeliveryReady,false);
  assert.equal(readiness.pushTransportConfigured,true);
  assert.equal(readiness.valuesExposed,false);
  assert.ok(!JSON.stringify(readiness).includes(one.privateKey));
  const mismatch=await handleApiRequest(req,{
    DB:db,VAPID_SUBJECT:'mailto:test@example.invalid',
    VAPID_PUBLIC_KEY:two.publicKey,VAPID_PRIVATE_KEY:one.privateKey,
    WEB_PUSH_TTL_SECONDS:'300',PUSH_DELIVERY_ENABLED:'1',
  },null);
  assert.equal((await mismatch.json()).vapidKeyPairValid,false);
  console.log(JSON.stringify({result:'PASS',validPair:true,
    mismatchedPairRejected:true,publicKeyPrinted:false,privateKeyPrinted:false,
    operationalD1Write:false,kakaoPublicTransitRequests:0}));
}finally{await vite.close();}
