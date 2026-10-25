# Password verification on Workers Free

## Verified failure

After the owner re-enabled authentication, read-only run [40216905788](https://github.com/ydh1121/ComeBackHome/actions/runs/40216905788) on MAIN `1b9684410e5355591143ee9d40a8fcbae3296bdb` returned `database: ready`, `passwordRuntime: unsupported`. This came from the exact native PBKDF2 iteration-cap error, not a wrong-password response. Local workerd permits operations the deployed runtime rejects. The diagnostic does not expose the actual cap number, user records or secrets.

## Versioned server relief

Use the [standard server relief pattern](https://doc.libsodium.org/password_hashing#server-relief): an expensive client password KDF followed by an independently salted server password KDF. This implementation uses built-in Web Crypto PBKDF2-SHA256 in both stages; it does not import libsodium or claim Argon2 support.

1. Same-origin, rate-limited `POST /api/auth/login-parameters` returns protocol `cbh-pbkdf2-relief/v1`, a 16-byte account salt and **600,000** client iterations. Private/no-store response, no account ID, hash or session.
2. The browser derives a 32-byte material from the entered password using 600,000 iterations. It rejects protocol/iteration downgrades or malformed salts. No raw password is sent to the API.
3. `POST /api/auth/login` sends that material and its salt over HTTPS. The server performs PBKDF2-SHA256 **10,000** iterations with a separate random 16-byte server salt, constant-time compares the verifier, and performs the existing account/epoch/session checks. It does not trust a client boolean or mint a session on preparation.
4. Only the server verifier is stored: base64 of marker `CBHSR01\0` (8 bytes), server salt (16), verifier (32). Existing `algorithm` remains `pbkdf2-sha256`, `iterations=600000` describes the retained client stage, and `salt_b64` is the client salt. Unknown formats fail closed. No schema migration, new service, provider secret or paid plan.

A database-only attacker must perform the expensive client KDF and server stage for each password guess. A stored 56-byte verifier cannot be submitted as 32-byte client material. The server stage is not a fallback retry at a lower password work factor. The client material **is a password-equivalent secret**: no logs, persistence, analytics, caching or public artifacts. HTTPS and same-origin CSRF protections remain required; this is not a challenge-response/PAKE protocol. The two fixed permitted login names are not secret, and this endpoint does not promise username non-enumeration.

The UI retains the 15–128-character/no-single-character-repeat/different-password rule. As in server-relief protocols, the server cannot prove the client's work or plaintext policy without the plaintext. It enforces the version, exact salts/material sizes, current server-verifier check, throttles and authorization. Do not claim server-side plaintext-strength enforcement. An authenticated malicious client can select weak material for its own account; it cannot update another account or bypass verification of the current credential.

## Existing Windows bootstrap and atomic upgrade

Keep the already provisioned Windows 600k hashes and temporary passwords. On a user-initiated preparation request, the server wraps the existing 32-byte verifier in the new server KDF before accepting network material. Compare-and-swap guards the original hash, salt, algorithm, iteration count, enabled user and authentication epoch. Upgrade and audit share one D1 transaction; failed audit rolls back. A concurrent password change wins; a second preparation reuses the resulting format. It never changes IDs, role, grants, case ownership, forced-change flag, sessions or existing schedule data.

This upgrade changes the stored representation, not the user's password. **Old bootstrap hashes/backups are password-equivalent under this protocol until the initial password is changed.** They were already private and must remain on the owner's protected PC, never shared with the assistant/Git/Drive. The original forced initial change remains mandatory; the new password receives fresh client and server salts, and all prior sessions are revoked. Do not rerun bootstrap SQL or silently reset accounts.

## Deployment and recovery boundary

No production credential query or administrative D1 mutation is performed by the diagnostic or deployment workflow. Representation upgrade happens only through the app when someone submits a permitted login name; it is not authentication and is rate limited. Exact source deployment and read-only runtime readiness are separate from the owner's actual login and Free CPU acceptance.

The canonical Pages adapter defaults to protected mode when `PRIVATE_WORK_ENABLED` is absent; explicit owner value `0` retains the previous rollout switch. No Wrangler/configuration workflow, dashboard variable, Drive secret or account settings are changed. The prior observation of disabled auth does not establish why the variable was missing/off.

Do not roll back to the old raw-password verifier after any row is wrapped: the old code cannot read this format. Roll forward with a compatible fix. A deliberate auth-off switch reopens legacy anonymous access and needs owner approval. Whole-DB restore or password reset needs separate approval and must never be an automatic remedy for login errors.

## Acceptance

- Independent Node vector, actual browser 600k calculations, strict version/format/downgrade rejection.
- Server cap simulation rejects native calls above 100k; all new server operations use the separate 10k stage. This tests the reported class of failure, not a claim that production exposed a 100k maximum.
- Atomic/idempotent upgrade, audit rollback, concurrent password/epoch changes, disabled/unknown users, CSRF, throttles, malformed/wrong materials, mandatory change, session revocation and secure cookies.
- Existing 103 private-work contracts, account-setup tests, Chromium/WebKit with isolated D1, all required product CI.
- Public readiness executes a fixed public vector through the **actual server stage** once per isolate. It does not test a private password, assert a successful login, or claim actual iPhone persistence/CPU metrics. Retain the old production diagnostic failure as historical evidence.
