import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

// Execute the production worker against an isolated CacheStorage contract.
// No network, registration removal, Push transmission or server data writes.
export async function verifyShellCache(){
 const stores=new Map(),handlers=new Map();
 const key=value=>typeof value==='string'?value:value.url;
 const caches={
  async open(name){
   if(!stores.has(name))stores.set(name,new Map());
   const entries=stores.get(name);
   return {async match(request){return entries.get(key(request))?.clone();},async put(request,response){entries.set(key(request),response.clone());},async addAll(urls){for(const url of urls)entries.set(url,new Response('shell'));}};
  },async keys(){return [...stores.keys()];},async delete(name){return stores.delete(name);}
 };
 const self={location:{origin:'https://local.test'},addEventListener:(type,handler)=>handlers.set(type,handler),skipWaiting:async()=>{},clients:{claim:async()=>{}}};
 let fetcher=async()=>new Response('network');
 runInNewContext(await readFile('public/sw.js','utf8'),{self,caches,URL,Response,fetch:request=>fetcher(request)});
 const lifecycle=async type=>{let done;handlers.get(type)({waitUntil:p=>{done=p;}});await done;};
 const message=async(enabled,clear=false)=>{let done,ack;handlers.get('message')({data:{type:'CBH_CACHE',enabled,clear},ports:[{postMessage:v=>{ack=v;}}],waitUntil:p=>{done=p;}});await done;assert.equal(ack?.ok,true);};
 const request=(path,mode='same-origin')=>({url:'https://local.test'+path,method:'GET',mode,destination:'script'});
 const get=req=>{let response;handlers.get('fetch')({request:req,respondWith:p=>{response=p;}});return response;};
 await (await caches.open('unrelated-app')).put('/keep',new Response('keep'));
 await lifecycle('install');await lifecycle('activate');
 assert.equal(get(request('/api/people')),undefined,'server API never enters shell cache');
 assert.equal(await (await get(request('/asset.js'))).text(),'network');
 fetcher=async()=>{throw Error('offline');};
 assert.equal(await (await get(request('/asset.js'))).text(),'network','enabled asset cache available');
 assert.equal(await (await get(request('/schedule','navigate'))).text(),'shell','enabled shell fallback');
 await message(false);
 assert.equal((await caches.keys()).some(name=>name.startsWith('cbh-shell-')),false,'OFF deletes only app shell caches');
 assert.equal(await (await (await caches.open('unrelated-app')).match('/keep')).text(),'keep');
 assert.equal(await (await (await caches.open('cbh-cache-preference-v1')).match('/__cbh_cache_preference__')).json(),false);
 await assert.rejects(()=>get(request('/asset.js')),/offline/,'OFF bypasses cached assets');
 assert.ok(handlers.has('push')&&handlers.has('notificationclick'),'Push handlers remain registered');
 await message(true);
 let resolveFetch,started;const start=new Promise(resolve=>{started=resolve;});
 fetcher=()=>{started();return new Promise(resolve=>{resolveFetch=resolve;});};
 const pending=get(request('/late.js'));await start;await message(true,true);resolveFetch(new Response('late'));await pending;
 assert.equal(await (await caches.open('cbh-shell-v5')).match(request('/late.js')),undefined,'clear prevents in-flight response from refilling cache');
 await (await caches.open('cbh-shell-v5')).put('/',new Response('old-shell'));
 let rejectFetch,begin;const beginning=new Promise(resolve=>{begin=resolve;});
 fetcher=()=>{begin();return new Promise((_,reject)=>{rejectFetch=reject;});};
 const navigation=get(request('/schedule','navigate'));await beginning;await message(false);rejectFetch(Error('offline'));
 assert.equal((await navigation).status,503,'OFF during navigation cannot reveal stale shell');
 console.log('CBH_SHELL_CACHE_PASS enabled_off_clear_late_response_api_excluded_push_preserved');
}
