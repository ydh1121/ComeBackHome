import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Existing project only. No settings, D1, scheduler or provider operations. */
export async function deployCanonicalPages({ env, fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)), attempts = 150 }) {
  const sha = env.GITHUB_SHA;
  if (env.GITHUB_REPOSITORY !== 'ydh1121/ComeBackHome' || env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Canonical MAIN identity required');
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID || !env.GITHUB_TOKEN) throw new Error('Existing deployment connection unavailable');
  const git = 'https://api.github.com/repos/ydh1121/ComeBackHome';
  const cf = 'https://api.cloudflare.com/client/v4/accounts/' + env.CLOUDFLARE_ACCOUNT_ID + '/pages/projects/come-back-home';
  async function json(url, token) {
    const response = await fetcher(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Deployment metadata GET failed: HTTP ' + response.status);
    const body = await response.json();
    if (url.startsWith(cf) && body.success !== true) throw new Error('Cloudflare metadata unavailable');
    return url.startsWith(cf) ? body.result : body;
  }
  let requiredRun, privateRun;
  for (let i = 0; i < attempts; i++) {
    const runs = await json(git + '/actions/runs?head_sha=' + sha + '&per_page=100', env.GITHUB_TOKEN);
    const exactRuns = runs.workflow_runs.filter(r => r.head_sha === sha);
    const run = exactRuns.filter(r => r.name === 'Phase 5G Local Integration' && r.event === 'push').sort((a,b) => b.id-a.id)[0];
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error('Required CI failed; deployment not requested');
      const { jobs } = await json(git + '/actions/runs/' + run.id + '/jobs?per_page=100', env.GITHUB_TOKEN);
      if (jobs.filter(j => j.conclusion === 'success').length !== 12 || jobs.some(j => !['success','skipped'].includes(j.conclusion))) throw new Error('Required 12-job acceptance mismatch');
      requiredRun = run.id;
    } else requiredRun = undefined;
    const privateCheck = exactRuns.filter(r => r.name === 'Private work modules (isolated only)' && ['push','workflow_dispatch'].includes(r.event)).sort((a,b) => b.id-a.id)[0];
    if (privateCheck?.status === 'completed') {
      if (privateCheck.conclusion !== 'success') throw new Error('Private module CI failed; deployment not requested');
      const { jobs } = await json(git + '/actions/runs/' + privateCheck.id + '/jobs?per_page=100', env.GITHUB_TOKEN);
      const expected = ['windows-password','contracts','browser-d1'];
      if (jobs.length !== expected.length || expected.some(name => jobs.filter(j => j.name === name && j.conclusion === 'success').length !== 1)) throw new Error('Private 3-job acceptance mismatch');
      privateRun = privateCheck.id;
    } else privateRun = undefined;
    if (requiredRun && privateRun) {
      break;
    }
    await sleep(10000);
  }
  if (!requiredRun) throw new Error('Required CI not completed; deployment not requested');
  if (!privateRun) throw new Error('Private module CI not completed; deployment not requested');
  const branch = await json(git + '/branches/main', env.GITHUB_TOKEN);
  if (branch.commit.sha !== sha) throw new Error('MAIN advanced; stale deployment not requested');
  const project = await json(cf, env.CLOUDFLARE_API_TOKEN);
  if (project.name !== 'come-back-home' || project.source?.config?.production_branch !== 'main' || project.source?.config?.production_deployments_enabled !== true) throw new Error('Canonical project configuration mismatch');
  const matches = d => d?.environment === 'production' && d.deployment_trigger?.metadata?.commit_hash === sha;
  // Pages rejected the GitHub-style 100-item query in production. Keep the
  // previously verified small page and exclude unrelated preview deployments.
  const deploymentListUrl = cf + '/deployments?env=production&per_page=5';
  const recent = await json(deploymentListUrl, env.CLOUDFLARE_API_TOKEN);
  let deployment = [project.canonical_deployment, ...recent].find(d => matches(d) && !['failure','canceled'].includes(d.latest_stage?.status));
  let requested = false;
  if (!deployment) {
    const form = new FormData(); form.set('branch','main'); form.set('commit_hash',sha); form.set('commit_dirty','false'); form.set('commit_message','Deploy accepted canonical source');
    // One POST only. An ambiguous response must be reconciled by GET, never retried blindly.
    const response = await fetcher(cf + '/deployments', { method:'POST', headers:{Authorization:'Bearer ' + env.CLOUDFLARE_API_TOKEN}, body:form, signal:AbortSignal.timeout(30000) }).catch(() => null);
    if (response?.status === 401 || response?.status === 403) throw new Error('Pages deployment permission denied');
    const body = await response?.json().catch(() => null);
    deployment = response?.ok && body?.success === true && body.result?.id ? body.result : null;
    requested = true;
    if (!deployment) {
      const observed = await json(deploymentListUrl, env.CLOUDFLARE_API_TOKEN);
      deployment = observed.find(matches);
      if (!deployment) throw new Error('Deployment response ambiguous; no second POST issued; HTTP ' + (response?.status ?? 0) + '; codes=' + (body?.errors ?? []).map(e => Number(e.code)).filter(Number.isFinite).join(','));
    }
    if (!matches(deployment)) throw new Error('Deployment identity mismatch');
  }
  const id = deployment.id;
  for (let i = 0; i < attempts; i++) {
    const p = await json(cf, env.CLOUDFLARE_API_TOKEN);
    const live = p.canonical_deployment;
    if (live?.id === id && matches(live) && live.latest_stage?.status === 'success') {
      const response = await fetcher('https://come-back-home.pages.dev/api/health', {method:'GET',cache:'no-store',signal:AbortSignal.timeout(10000)}).catch(() => null);
      const health = await response?.json().catch(() => null);
      if (response?.ok && health?.ok === true && health.commitSha === sha) return { deploymentId:id, commit:sha, requiredRun, privateRun, requested, exactHealth:true, settingsChanged:0, appWrites:0, schedulerTicksSent:0 };
    }
    const current = p.latest_deployment;
    if (current?.id === id && ['failure','canceled'].includes(current.latest_stage?.status)) throw new Error('Pages deployment did not succeed: ' + current.latest_stage.status);
    await sleep(10000);
  }
  throw new Error('Exact canonical deployment/health not observed');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await deployCanonicalPages({ env: process.env })));
}
