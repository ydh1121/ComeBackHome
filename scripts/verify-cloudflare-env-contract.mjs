import { readFile } from 'node:fs/promises';

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
const doc = await readFile(new URL('../docs/CLOUDFLARE_ENVIRONMENT_CONTRACT.md', import.meta.url), 'utf8');

const required = [
  'KAKAO_REST_API_KEY',
  'SEOUL_BUS_SERVICE_KEY',
  'SEOUL_OPENAPI_KEY',
  'SEOUL_SUBWAY_API_KEY',
  'VAPID_PRIVATE_KEY',
  'PRESENCE_EVENT_INGEST_TOKEN',
  'VAPID_PUBLIC_KEY',
  'VAPID_SUBJECT',
  'WEB_PUSH_TTL_SECONDS',
  'NOTIFICATION_RETRY_DELAYS_SECONDS',
  'PROVIDER_RUNTIME_ENABLED',
  'PUSH_DELIVERY_ENABLED',
  'VITE_CBH_RUNTIME',
  'VITE_CBH_PROVIDER_RUNTIME',
  'VITE_CBH_VAPID_PUBLIC_KEY',
];

for (const name of required) {
  expect(new RegExp('^' + name + '=', 'm').test(env), '.env.example missing ' + name);
  expect(doc.includes(name), 'environment contract missing ' + name);
}

for (const secret of [
  'KAKAO_REST_API_KEY=',
  'SEOUL_BUS_SERVICE_KEY=',
  'SEOUL_OPENAPI_KEY=',
  'SEOUL_SUBWAY_API_KEY=',
  'VAPID_PRIVATE_KEY=',
  'PRESENCE_EVENT_INGEST_TOKEN=',
]) {
  const line = env.split(/\r?\n/).find((item) => item.startsWith(secret));
  expect(line === secret, '.env.example must not contain a value for ' + secret.slice(0, -1));
}

expect(
  /^PROVIDER_RUNTIME_ENABLED=0$/m.test(env),
  '.env.example must keep provider runtime disabled',
);
expect(
  /^PUSH_DELIVERY_ENABLED=0$/m.test(env),
  '.env.example must keep push delivery disabled',
);
expect(
  /^VITE_CBH_RUNTIME=mock$/m.test(env),
  '.env.example must keep client runtime on mock before activation',
);
expect(
  /^VITE_CBH_PROVIDER_RUNTIME=mock$/m.test(env),
  '.env.example must keep client provider runtime on mock before activation',
);
expect(
  /^VITE_CBH_VAPID_PUBLIC_KEY=$/m.test(env),
  '.env.example must not commit a real public key value',
);
expect(gitignore.includes('.env.*'), '.gitignore must ignore derived env files');
expect(gitignore.includes('!.env.example'), '.gitignore must explicitly allow .env.example');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Cloudflare environment contract verification passed');
