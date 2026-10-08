import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Pages populates CF_PAGES_COMMIT_SHA during its Git-linked build. When it is
// missing (local/CI), use the checked-out Git revision. Never include secrets.
const environmentSha = (process.env.CF_PAGES_COMMIT_SHA ?? '').trim();
let gitSha = '';
try {
  gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // Filesystem-only production build is possible, report unknown honestly.
}
const valid = /^[0-9a-f]{40}$/i;
const sha = valid.test(environmentSha) ? environmentSha.toLowerCase() :
  valid.test(gitSha) ? gitSha.toLowerCase() : 'unknown';
writeFileSync(new URL('../worker/build-revision.ts', import.meta.url),
  "// Generated at build time. Commit SHA only; no secrets.\n" +
  "export const BUILD_COMMIT_SHA = " + JSON.stringify(sha) + ";\n");
console.log('CBH_BUILD_COMMIT_ID=' + (sha === 'unknown' ? 'UNKNOWN' : sha.slice(0, 12)));
