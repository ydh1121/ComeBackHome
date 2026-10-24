// Synthetic compatibility probe only. Never accepts real credentials.
import { pbkdf2Sync, scryptSync } from 'node:crypto';
export default {
  async test() {
    const results = [];
    const password = 'synthetic-compatibility-vector';
    const salt = new Uint8Array(16).fill(42);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const probes = [
      ['webcrypto-pbkdf2-600k', () => crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, key, 256)],
      ['node-pbkdf2-600k', () => pbkdf2Sync(password, salt, 600000, 32, 'sha256')],
      ['node-scrypt-131072', () => scryptSync(password, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 })],
    ];
    for (const [name, run] of probes) {
      const started = Date.now();
      try { const value = await run(); results.push({ name, supported: true, bytes: value.byteLength, elapsedMs: Date.now() - started }); }
      catch (error) { results.push({ name, supported: false, error: String(error.message).slice(0, 300) }); }
    }
    console.log(JSON.stringify({ kind: 'local-workerd-compatibility', productionCpuVerified: false, results }));
  },
};
