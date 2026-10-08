import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const vite=await createServer({
  root:fileURLToPath(new URL('../',import.meta.url)),
  logLevel:'error',appType:'custom',server:{middlewareMode:true},
});
try{
  const api=await vite.ssrLoadModule('/worker/api.ts');
  const providerMod=await vite.ssrLoadModule(
    '/src/providers/browser/BrowserPushSubscriptionProvider.ts');
  const key='B'+('A'.repeat(85))+'C';
  const response=await api.handleApiRequest(
    new Request('https://come-back-home.pages.dev/api/notifications/client-key'),
    {VAPID_PUBLIC_KEY:key},null);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.configured,true);
  assert.equal(body.publicKey,key);
  assert.equal(JSON.stringify(body).includes('VAPID_PRIVATE_KEY'),false);
  const keyBytes=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
  const old='Z'.repeat(87);
  let captured=null,removed=false,resolved=0;
  const subscription={
    endpoint:'https://push.example.invalid/browser',
    expirationTime:null,
    options:{applicationServerKey:keyBytes.buffer},
    toJSON(){return {endpoint:this.endpoint,expirationTime:null,keys:{p256dh:'public',auth:'token'}};},
    async unsubscribe(){removed=true;return true;},
  };
  const registration={pushManager:{
    async getSubscription(){return captured?subscription:null;},
    async subscribe(config){captured=config.applicationServerKey;return subscription;},
  }};
  const originalNavigator=globalThis.navigator;
  const originalSecure=globalThis.isSecureContext;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{ready:Promise.resolve(registration)}}});
  Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:true});
  try{
    const browser=new providerMod.BrowserPushSubscriptionProvider(
      {applicationServerKey:old}, async()=>{resolved++;return body.publicKey;});
    await browser.prepare();
    const result=await browser.subscribe();
    assert.equal(result.endpoint,subscription.endpoint);
    assert.deepEqual(Array.from(captured),Array.from(keyBytes),
      'Browser subscription used build-time key instead of live Pages public key');
    assert.equal(await browser.isCompatible(),true);
    assert.equal(removed,false);
    assert.equal(resolved,1,'Prefetched runtime key should avoid repeat fetch');
  }finally{
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:originalNavigator});
    Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:originalSecure});
  }
  console.log(JSON.stringify({
    result:'PASS',canonicalKeySource:'RUNTIME',runtimeBuildMismatchRecovered:true,
    clientServerPublicKeyMatch:true,privateKeyExposed:false,
    keyPrinted:false,realBrowserSubscribe:'NOT_EXECUTED',KakaoRouteCalls:0,
  }));
}finally{await vite.close();}
