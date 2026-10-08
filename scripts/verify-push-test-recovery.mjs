import assert from 'node:assert/strict';
import webPush from 'web-push';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const vite=await createServer({root,appType:'custom',logLevel:'error',server:{middlewareMode:true}});
try{
  const api=await vite.ssrLoadModule('/worker/api.ts');
  const serviceModule=await vite.ssrLoadModule('/src/application/services/ApplicationActions.ts');
  const errors=await vite.ssrLoadModule('/src/features/notifications/pushErrors.ts');
  const configModule=await vite.ssrLoadModule('/worker/push-delivery-readiness.ts');
  const dbSubscriptions=[];
  const db={
    prepare(query){
      if(!query.includes('push_subscriptions'))throw Error('Unexpected D1 table query');
      return {
        async all(){return {results:dbSubscriptions};},
        async first(){return null;},
        async run(){throw Error('No D1 writes permitted in recovery verification');},
        bind(){return this;},
      };
    },
    async batch(){throw Error('No D1 batch writes');},
  };
  const vapid=webPush.generateVAPIDKeys();
  const env={
    DB:db, VAPID_SUBJECT:'mailto:owner@example.invalid',
    VAPID_PUBLIC_KEY:vapid.publicKey, VAPID_PRIVATE_KEY:vapid.privateKey,
    WEB_PUSH_TTL_SECONDS:'300',PUSH_DELIVERY_ENABLED:'1',
    PROVIDER_RUNTIME_ENABLED:'0',
  };
  const configured=configModule.inspectPushDeliveryConfig(env);
  assert.deepEqual(configured,{ready:true,missing:[]},
    'Test delivery must not require Kakao or ETA provider runtime');
  let response=await api.handleApiRequest(
    new Request('https://come-back-home.pages.dev/api/notifications/readiness'),
    env,null,
  );
  assert.equal(response.status,200);
  let body=await response.json();
  assert.equal(body.vapidConfigured,true);
  assert.equal(body.pushTransportConfigured,true);
  assert.equal(body.vapidKeyPairValid,true);
  assert.equal(body.pushDeliveryReady,false);
  assert.equal(body.activeSubscriptionCount,0);
  assert.equal(body.scheduledNotificationReady,false);
  assert.ok(body.scheduledMissing.includes('KAKAO_REST_API_KEY'));
  assert.equal(JSON.stringify(body).includes(env.VAPID_PRIVATE_KEY),false,
    'Read-only readiness leaked private key');
  assert.equal(JSON.stringify(body).includes('https://push.'),false);

  response=await api.handleApiRequest(
    new Request('https://come-back-home.pages.dev/api/notifications/test',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({endpoint:'https://push.example.invalid/not-registered'}),
    }),env,null,
  );
  assert.equal(response.status,404,'Test push must independently reach subscription check');
  body=await response.json();
  assert.equal(body.reason,'SUBSCRIPTION_NOT_REGISTERED');

  const state={permission:'default',subscription:null};
  const repo={
    async getSettings(){return {...state,rules:{shiftEnd:false,etaChange:false}};},
    async setPermission(x){state.permission=x;},
    async setSubscription(x){state.subscription=x;},
    async setRules(){},
  };
  let permission='granted',requests=0,connected=null,compatible=true,upserts=0,checks=0,sends=0;
  const current={
    endpoint:'https://push.example.invalid/device',
    expirationTime:null,
    keys:{p256dh:'fake-p256dh',auth:'fake-auth'},
  };
  const permissionProvider={
    async getPermission(){return permission;},
    async requestPermissionFromUserGesture(){requests++;return permission;},
  };
  const browser={
    async getCurrent(){return connected;},
    async subscribe(){connected=current;return current;},
    async unsubscribe(){connected=null;},
    async isCompatible(){return compatible;},
  };
  const transport={
    async checkRegistered(){checks++;return upserts>0;},
    async upsert(x){assert.equal(x.endpoint,current.endpoint);upserts++;},
    async remove(){},
  };
  const gateway={async sendTestNotification(){sends++;}};
  const service=new serviceModule.NotificationService(
    repo,permissionProvider,browser,gateway,transport,
  );
  await service.syncCurrentSubscription();
  assert.equal(state.permission,'granted');
  assert.equal(state.subscription,null);
  await assert.rejects(service.sendTestNotification(),e=>e.reason==='NO_SUBSCRIPTION');
  assert.equal(sends,0);
  await service.connectPushFromUserGesture();
  assert.equal(requests,0,'Granted permission must not prompt again');
  assert.equal(upserts,1);
  assert.equal(state.permission,'subscribed');
  assert.equal(state.subscription?.endpoint,current.endpoint);
  await service.sendTestNotification();
  assert.equal(sends,1);
  compatible=false;
  await service.syncCurrentSubscription();
  assert.equal(state.permission,'stale');
  compatible=true;
  await service.connectPushFromUserGesture();
  assert.equal(state.permission,'subscribed');
  assert.equal(upserts,2,'Explicit stale reconnect must re-register');
  assert.equal(errors.categorizePushError(new errors.PushClientError('NO_PERMISSION')),
    'NO_PERMISSION');
  assert.equal(errors.PUSH_FAILURE_MESSAGES.PUSH_PROVIDER_REJECTED.includes('거부'),true);
  console.log(JSON.stringify({
    result:'PASS',testEndpointWithoutKakao:'HTTP_404_SUBSCRIPTION_NOT_REGISTERED',
    providerCalls:0,actualPushSends:0,readonlyReadiness:true,vapidConfigured:true,
    scheduledReady:false,subscriptionReconciled:true,grantedNoSubscription:true,
    staleReconnection:true,clientMockSends:sends,safeReasonCodes:true,
  }));
}finally{await vite.close();}
