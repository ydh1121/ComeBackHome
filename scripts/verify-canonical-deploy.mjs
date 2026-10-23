import assert from 'node:assert/strict';
import { deployCanonicalPages } from './deploy-canonical-pages.mjs';
const sha='a'.repeat(40);
const env={GITHUB_REPOSITORY:'ydh1121/ComeBackHome',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,GITHUB_TOKEN:'fixture',CLOUDFLARE_API_TOKEN:'fixture',CLOUDFLARE_ACCOUNT_ID:'fixture'};
const record={id:'existing-project-deployment',environment:'production',deployment_trigger:{metadata:{commit_hash:sha}},latest_stage:{status:'success'}};
async function scenario({failed=false,advanced=false,reuse=false,ambiguous=false,missing=false,ready=true}={}) {
 let posts=0,reads=0,processed=false;
 const calls=[];
 const fetcher=async(url,init)=>{
  calls.push({url,method:init.method});
  assert(!url.includes('scheduler-tick')&&!url.includes('/d1/')&&!url.includes('/settings'),'no operational data requests');
  if(init.method==='POST') { posts++;assert(url.endsWith('/pages/projects/come-back-home/deployments'));assert.equal(init.body.get('branch'),'main');assert.equal(init.body.get('commit_hash'),sha);processed=true;return ambiguous?new Response('',{status:200}):Response.json({success:true,result:record}); }
  assert.equal(init.method,'GET');
  if(url.includes('/actions/runs?'))return Response.json({workflow_runs:[{id:1,name:'Phase 5G Local Integration',status:'completed',conclusion:failed?'failure':'success'}]});
  if(url.includes('/jobs?'))return Response.json({jobs:Array.from({length:12},()=>({conclusion:'success'}))});
  if(url.endsWith('/branches/main'))return Response.json({commit:{sha:advanced?'b'.repeat(40):sha}});
  if(url.endsWith('/api/health'))return Response.json({ok:true,commitSha:ready?sha:'b'.repeat(40)});
  if(url.includes('/deployments?')){
   const query=new URL(url).searchParams;
   assert.equal(query.get('env'),'production','Pages lookup must exclude previews');
   // Simulate the actual provider rejection that the original fixture missed.
   if(query.get('per_page')==='100')return Response.json({success:false,errors:[{code:1000}]},{status:400});
   return Response.json({success:true,result:(!missing&&(processed||reuse))?[record]:[]});
  }
  reads++;
  return Response.json({success:true,result:{name:'come-back-home',source:{config:{production_branch:'main',production_deployments_enabled:true}},canonical_deployment:(processed||reuse)?record:null}});
 };
 let result,error;
 try{result=await deployCanonicalPages({env,fetcher,sleep:async()=>{},attempts:2});}catch(e){error=e;}
 return {result,error,posts,reads,calls};
}
let r=await scenario();assert.equal(r.posts,1);assert.equal(r.result.exactHealth,true);
r=await scenario({reuse:true});assert.equal(r.posts,0);assert.equal(r.result.requested,false);
r=await scenario({failed:true});assert.equal(r.posts,0);assert.match(r.error.message,/CI failed/);
r=await scenario({advanced:true});assert.equal(r.posts,0);assert.match(r.error.message,/MAIN advanced/);
r=await scenario({ambiguous:true});assert.equal(r.posts,1);assert.equal(r.result.exactHealth,true);
r=await scenario({ambiguous:true,missing:true});assert.equal(r.posts,1);assert.match(r.error.message,/no second POST/);
r=await scenario({ready:false});assert.equal(r.posts,1);assert.match(r.error.message,/Exact canonical/);
await assert.rejects(deployCanonicalPages({env:{...env,GITHUB_REF:'refs/heads/other'},fetcher:()=>{throw Error('must not fetch');}}),/identity/);
console.log('PASS canonical deployment: required CI, MAIN lease, existing project, duplicate suppression, ambiguous POST reconciliation, exact health; no D1/scheduler operations');
