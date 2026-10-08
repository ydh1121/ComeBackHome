import type { WorkerEnv } from './runtime-types';

// Read-only proof: WebCrypto signs a fixed nonce with the server VAPID
// private key and verifies against the public key. No key bytes escape.
function base64urlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
function bytesToBase64url(bytes: Uint8Array): string {
  let raw = '';
  for (const value of bytes) raw += String.fromCharCode(value);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function verifyVapidKeyPair(env: WorkerEnv): Promise<boolean> {
  try {
    const publicKey = (env.VAPID_PUBLIC_KEY ?? '').trim();
    const privateKey = (env.VAPID_PRIVATE_KEY ?? '').trim();
    const publicBytes = base64urlToBytes(publicKey);
    const privateBytes = base64urlToBytes(privateKey);
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 ||
        privateBytes.length !== 32) return false;

    const privateJwk: JsonWebKey = {
      kty: 'EC', crv: 'P-256',
      x: bytesToBase64url(publicBytes.slice(1, 33)),
      y: bytesToBase64url(publicBytes.slice(33, 65)),
      d: bytesToBase64url(privateBytes),
      ext: false, key_ops: ['sign'],
    };
    const privateCrypto = await crypto.subtle.importKey(
      'jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const publicCrypto = await crypto.subtle.importKey(
      'raw', publicBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const nonce = new TextEncoder().encode('ComeBackHome VAPID key-pair self-check v1');
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, privateCrypto, nonce);
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicCrypto, signature, nonce);
  } catch {
    return false;
  }
}
