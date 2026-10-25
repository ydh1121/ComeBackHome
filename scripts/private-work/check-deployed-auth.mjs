import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Public same-origin reads only. No Cloudflare account API, cookie, secret,
// login attempt, account query, D1 write, provider call or scheduler tick.
export async function checkDeployedAuth({ sha, fetcher = fetch }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Exact deployment SHA required');
  const origin = 'https://come-back-home.pages.dev';
  const options = () => ({ method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
  const health = await fetcher(origin + '/api/health', options());
  const version = await health.json();
  if (!health.ok || version.ok !== true || version.commitSha !== sha) throw new Error('Exact deployed source not observed; auth probe skipped');
  const response = await fetcher(origin + '/api/auth/readiness', options());
  const result = await response.json().catch(() => null);
  if (response.status === 404 && result?.error === 'FEATURE_UNAVAILABLE') return { auth: 'disabled', loginAccepted: false, writes: 0 };
  const database = ['ready', 'unavailable'].includes(result?.database) ? result.database : 'unknown';
  const passwordRuntime = ['supported', 'unsupported', 'unavailable'].includes(result?.passwordRuntime) ? result.passwordRuntime : 'unknown';
  return { auth: response.status === 200 && database === 'ready' && passwordRuntime === 'supported' ? 'runtime-ready' : 'blocked', database, passwordRuntime, loginAccepted: false, writes: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkDeployedAuth({ sha: process.env.GITHUB_SHA });
    console.log(JSON.stringify(result));
    if (result.auth === 'blocked') process.exitCode = 1;
  } catch {
    // No raw provider response or environment is written to public Actions logs.
    console.error('Canonical auth runtime check unavailable; no writes or login attempts performed');
    process.exitCode = 1;
  }
}
