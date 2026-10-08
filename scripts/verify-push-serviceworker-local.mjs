import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const events=new Map(), received=[];
const origin='https://come-back-home.pages.dev';
let opened='';
const self={
  location:{origin},
  addEventListener(name,fn){events.set(name,fn);},
  registration:{
    async showNotification(title,options){received.push({title,options});},
  },
  clients:{
    async matchAll(){return [];},
    async openWindow(path){opened=path;return null;},
  },
  skipWaiting:async()=>{},
};
runInNewContext(source,{self,URL,Response,Promise,console,caches:{
  async open(){throw Error('Push QA must not use offline shell caches');},
  async keys(){return [];},
}});
assert.ok(events.has('push') && events.has('notificationclick'),
  'Production worker handlers must remain active');
const payload={title:'ComeBackHome',body:'테스트 알림입니다.',tag:'cbh:test',path:'/notifications'};
const waits=[];
events.get('push')({
  data:{json(){return payload;},text(){return JSON.stringify(payload);}},
  waitUntil(promise){waits.push(promise);},
});
await Promise.all(waits);
assert.equal(received.length,1,'Expected exactly one worker showNotification call');
assert.equal(received[0].title,payload.title);
assert.equal(received[0].options.body,payload.body);
assert.equal(received[0].options.tag,payload.tag);
assert.equal(received[0].options.data.path,payload.path);
const nav=[];
events.get('notificationclick')({
  notification:{data:{path:'/notifications'},close(){}},
  waitUntil(promise){nav.push(promise);},
});
await Promise.all(nav);
assert.equal(opened,'/notifications');
console.log(JSON.stringify({
  result:'PASS',workerPushEvent:'SIMULATED_PASS',
  showNotification:'SIMULATED_PASS',clickNavigation:'SIMULATED_PASS',
  realDelivery:'NOT_TESTED',realDevice:'NOT_TESTED',
  pushNetworkRequests:0,kakaoRouteRequests:0,
}));
