import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const failures = [];
const page = await read('../src/pages/NotificationPage.tsx');
const settings = await read('../src/pages/SettingsPage.tsx');
const hook = await read('../src/features/notifications/useNotificationSettings.ts');
const service = await read('../src/application/services/ApplicationActions.ts');
const router = await read('../src/app/router.tsx');
const manifest = await read('../src/application/route-manifest.ts');
const providers = await read('../src/mocks/providers.ts');
const css = await read('../src/pages/notification-page.css');

for (const text of ['알림','예정 퇴근 시간에','도착 시간이 크게 바뀔 때','실제 퇴근을 감지했을 때','집 도착을 감지했을 때','테스트 알림','requestPermissionFromUserGesture','updateRules','sendTestNotification']) {
  if (!page.includes(text)) failures.push('notification page missing ' + text);
}
for (const text of ['PERMISSION_DEFAULT','PERMISSION_DENIED','PERMISSION_GRANTED','SUBSCRIBED','PERMISSION_ERROR']) {
  if (!page.includes(text)) failures.push('runtime state missing ' + text);
}
for (const text of ["permission === 'granted'","permission === 'subscribed'","permission === 'denied'","permission === 'error'"]) {
  if (!hook.includes(text)) failures.push('permission mapping missing ' + text);
}
if (!page.includes('permission-action') || !page.includes('onClick={requestPermission}')) failures.push('explicit permission user gesture missing');
if (!page.includes('disabled={!permissionView.enabled')) failures.push('test notification permission gate missing');
if (!service.includes("repository.setPermission('error')")) failures.push('permission error persistence missing');
if (!settings.includes("navigate('/notifications')")) failures.push('settings notification navigation missing');
for (const path of ['/notifications','/settings']) {
  if (!manifest.includes("'" + path + "'")) failures.push('manifest missing ' + path);
  if (!router.includes("'" + path + "'")) failures.push('router missing ' + path);
}
if (!providers.includes('MockNotificationPermissionProvider')) failures.push('mock permission provider missing');
if (!providers.includes('MockNotificationTestGateway')) failures.push('mock test gateway missing');
if (!css.includes('.notification-page .permission-row') || !css.includes('.notification-page .switch')) failures.push('notification styles missing');

for (const [name, source] of [['notification', page], ['settings', settings]]) {
  if (source.includes('/mocks/') || source.includes('/providers/')) failures.push(name + ' imports infrastructure');
  if (source.includes('contracts/repositories')) failures.push(name + ' imports repositories');
}
if (page.includes('serviceWorker') || page.includes('PushManager') || page.includes('.subscribe(')) failures.push('live PWA/push scope leaked into notification page');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('phase 4F notification workflow verification passed');
