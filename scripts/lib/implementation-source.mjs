import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const owners = JSON.parse(await readFile(new URL('../../test/portable-adapters.json', import.meta.url), 'utf8'));
/** Static contracts inspect the application adapter AND its extracted implementation.
 * Runtime tests continue importing the application entrypoint. verify:portable
 * separately verifies these ownership edges, independence and executable behavior. */
export async function readImplementationSource(file) {
  const absolute = file instanceof URL ? fileURLToPath(file) : resolve(root, file);
  const path = relative(root, absolute).replaceAll('\\', '/');
  return (await Promise.all([path, ...(owners[path] ?? [])].map(p => readFile(resolve(root, p), 'utf8')))).join('\n');
}
