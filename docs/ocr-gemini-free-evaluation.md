# Gemini Free OCR evaluation readiness

Cloudflare evaluation is complete with measured quality failures. No external
model is selected. The next provider in the agreed order is the Gemini Developer
API, with the stable `gemini-3.8-flash` candidate. This document prepares that
evaluation; it does not claim API execution, accuracy or integration acceptance.

The official model/pricing and REST reference checked on2026-10-13 list image
input, structured text output, the standard Free tier, LOW thinking and supported
`generateContent`. The prepared request uses inline PNG data, one candidate,
max8,192 output tokens, `responseJsonSchema`, LOW thinking and `store:false`.
No Files API upload, cache, tools, search, paid fallback or SDK is involved.
Free-tier data-use terms make the existing explicitly synthetic corpus the only
permitted input here; no original employee image is included.

## Required access, still closed

1. An owner-created Gemini API key in this repository's Actions secret
   `GEMINI_API_KEY`, for the intended Google AI Studio project. Never paste it
   into chat, source, logs or a query string.
2. Current owner evidence that **that same project** is on the Gemini API Free
   tier. A Cloudflare Workers Free screenshot does not establish Google billing.

Setup locations:
- https://aistudio.google.com/api-keys
- https://github.com/ydh1121/ComeBackHome/settings/secrets/actions

The committed workflow leaves `CBH_GEMINI_FREE_PROJECT_CONFIRMED=false` and the
proof date empty. Its normal push runs only offline boundary checks and a
zero-network preflight that reports booleans, not secret values. It can establish
key presence, not key validity or billing status. Inference requires reviewed
same-day proof, the exact repository/PR92 branch, run_attempt1 and the explicit
`[cbh-gemini-free-eval]` commit prefix. The key is scoped to the two provider steps,
not checkout or offline tests. The operator records proof before opening those
guards; the owner does not need to edit source code. Adding a secret alone does
not automatically start inference.

## Bounded independent evaluation

`scripts/evaluate-gemini-free.py` reuses the original hash-verified12-image/336-cell
archive and independent field scorer. It sends the original Korean prompt and
image source ID, never ground truth. The schema constrains types, not expected
names/dates/times/counts or approval flags. Complete JSON parsing never repairs
model values. Only aggregate/per-image metrics, hashes, numeric HTTP diagnostics,
latency and returned token counters leave process memory; raw text stays private.

At most12 inference requests, with30-second minimum start spacing,120-second
request timeout, no redirects, no retries and immediate stop on HTTP/quota,
truncation or output-contract failure. Same-day proof is rechecked immediately
before each request, including after pacing across UTC midnight. A full aggregate
requires all12 images; partial scores remain separate. `store:false` avoids the
optional API interaction store; it does not override the provider's Free-tier
data-use terms. No rate limit or unknown billing state is treated as permission
to switch to a paid project.

`scripts/verify-free-ocr-guards.py` checks closed access gates, midnight expiry,
quota stop/no retry, secret/error redaction, strict parsing and preservation of
incorrect model values. These offline tests make zero network calls and make no
recognition-accuracy claim. Required product regression remains separate.

Official references:
- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/structured-output

OCR_SOFTWARE_ACCEPTED and FULL_PRODUCT_SOFTWARE_ACCEPTED remain PARTIAL/BLOCKED.
RELEASE_HOLD_UNTIL_OWNER_APPROVAL remains unchanged.
