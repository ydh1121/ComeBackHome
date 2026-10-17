# Gemini Free OCR evaluation readiness

Cloudflare evaluation is complete with measured quality failures. Gemini's real
API authentication and one original synthetic image succeeded, but a subsequent
HTTP503 and bounded full-run timeout prevented complete-v2 acceptance. No external
model is selected. The Gemini execution gate is now closed; historical owner
Free-project proof is retained. OCR.space Engine3 is next in the agreed order.

The official model/pricing and REST reference checked on2026-10-13 list image
input, structured text output, the standard Free tier, LOW thinking and supported
`generateContent`. The prepared request uses inline PNG data, one candidate,
max8,192 output tokens, `responseJsonSchema`, LOW thinking and `store:false`.
No Files API upload, cache, tools, search, paid fallback or SDK is involved.
Free-tier data-use terms make the existing explicitly synthetic corpus the only
permitted input here; no original employee image is included.

## Required access and dated owner evidence

1. An owner-created Gemini API key in this repository's Actions secret
   `GEMINI_API_KEY`, for the intended Google AI Studio project. Never paste it
   into chat, source, logs or a query string.
2. Current owner evidence that **that same project** is on the Gemini API Free
   tier. A Cloudflare Workers Free screenshot does not establish Google billing.

Setup locations:
- https://aistudio.google.com/api-keys
- https://github.com/ydh1121/ComeBackHome/settings/secrets/actions

The initial readiness commit left `CBH_GEMINI_FREE_PROJECT_CONFIRMED=false` and the
proof date empty. Its normal push runs only offline boundary checks and a
zero-network preflight that reports booleans, not secret values. It can establish
key presence, not key validity or billing status. Inference requires reviewed
same-day proof, the exact repository/PR92 branch, run_attempt1 and the explicit
`[cbh-gemini-free-eval]` commit prefix. The key is scoped to the two provider steps,
not checkout or offline tests. The operator records proof before opening those
guards; the owner does not need to edit source code. Adding a secret alone does
not automatically start inference.

`CBH_GEMINI_EVALUATION_OPEN` is an additional explicit execution gate. It is
currently false after the final disposition below; closed preflight readiness is
not a claim that the owner's registered key or Free-project evidence is missing.

On2026-10-14 at10:30 KST the owner supplied two screenshots and instructed work
to continue. AI Studio shows the ComeBackHome project, one key and Free tier;
the repository screenshot shows `GEMINI_API_KEY` just registered. The private
project identifier is recorded only in the project SSOT. Screenshots and account
identity are not uploaded into the repository/CI. Evidence SHA-256:

- project/tier: `24693e0a6a12ef90be403b979a422250d1d7ff20f35566fe84f698fd15e1b60f`
- secret registration: `f855e347c6a26a49db37907c55f158a41e429f17f69676561855b91b879024a9`

The workflow now records owner confirmation and proof date2026-10-14. This
authorizes the existing bounded synthetic evaluation only. The screenshots do
not prove successful authentication, remaining quota or model accuracy; those
come from actual API responses. No billing permission or paid upgrade is added.

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

## First actual request and non-generating diagnosis

Run38496293534/job115632690440 at
`dba203abc678169ac80e7528df525bb74ec9e10e` confirmed every readiness check,
including key presence and same-day Free-project evidence. The first original A
image request returned **HTTP400 after62,362ms**. Error code400 is recorded, but
the initial reporter discarded the provider's error status/reason. No text,
usage or recognition accuracy was obtained; the full-v2 aggregate is null.
Authentication success cannot be inferred from secret presence or this response.
The original image request is not automatically repeated.

The next explicit `[cbh-gemini-free-probe]` run performs only official model GET
and, if the exact model/methods are confirmed, countTokens for the same synthetic
input/request contract. No generateContent request is issued. Any failure stops
without retry, redirect or model/key substitution. Error reporting now permits
only known status/reason/field labels; response bodies, key values and error
messages never enter logs. This diagnoses authentication/model/wire-format
separately and cannot establish OCR quality or product acceptance.

References: https://ai.google.dev/api/models and https://ai.google.dev/api/tokens

Run38514999336/job115691694904 at `fe5d0d0` passed both authenticated calls:
exact-model GET HTTP200/128ms and countTokens HTTP200/164ms,1,458 input tokens.
The exact model advertises generateContent and countTokens. No inference took
place. The owner need not register a new key. This does not validate generation
schema compilation or establish generation permission, quota or OCR accuracy.

Because the first generation error reason was discarded, one explicit
`[cbh-gemini-free-diagnose]` execution captures only allowlisted diagnostics from
the original A request. It is limited to one call, with no retry or automatic
full-corpus continuation. Original image/prompt/schema and scorer stay unchanged;
this separates an API defect from any quality experiment. A full-v2 aggregate
remains null even if this single request succeeds. No further identical request
is made without a concrete result and a documented next action.

The one-call diagnostic at `aaf6b70422a251ca53a8a5a72ad69977e5f62ef8`,
run38515239734/job115692444038, returned HTTP400/95,123ms with INVALID_ARGUMENT.
Its error-body SHA matches the standard JSON for the generic message
"Request contains an invalid argument." exactly. No field detail is available;
no key or account identity was read from the error. Usage and accuracy remain
unmeasured. No further identical generation request will be sent.

The next bounded complete-v2 evaluation isolates the documented schema-complexity
limitation. A Gemini-specific copy retains every required field, status enum,
nullable type and review boolean, but removes numeric/array range constraints
and expresses the optional bbox as an array-or-null type. Prompt,12 original
images,truth,scorer,model,LOW thinking,store:false and8,192 output cap are unchanged.
This is a hypothesis test, not a claim that the provider disclosed the cause.
Application/parser checks remain authoritative. No expected values or cell counts
are inserted and no prediction is repaired. One failed request immediately stops
the run; no automatic schema/model/paid fallback. Failed requests now leave the
attempted-subset score null instead of printing an unmeasured zero-accuracy table.

Run38515591438/job115693543858 at `f88ea9ae07de9773017f21910e570133813415a2`
confirmed generation with the simplified typed schema. Original A returned
HTTP200/14,852ms,STOP,21 predictions/21 aligned cells. All scored fields matched
21/21,including names,dates,start/end/break and review_required; safety errors0.
Returned usage:1,458 input+2,784 output=4,242 tokens. This is one-image accuracy,
not complete-v2 acceptance. Original B returned HTTP503/UNAVAILABLE in1,045ms,
without usage. The evaluator stopped as designed. Full aggregate remains null.

After recording the service failure and a cooldown of more than two minutes,
one explicit new full-corpus run uses exactly the successful simplified request
contract. It may issue at most12 calls and stops on the first error. This is a
bounded operator decision after a service-unavailable result, not an automatic
retry loop or schema/model fallback. The prior A result remains evidence and is
not combined with new predictions or used to tune the prompt. A full fresh run
keeps the original independent aggregate scorer intact. Cumulative pre-run
inference attempts4; known tokens4,242; three failed-request usages unknown.
Maximum cumulative generation attempts after this run16. No further identical
full-corpus run is scheduled in this execution if the provider fails again.

## Final disposition on2026-10-14

At `0d7087ee761bebe6bf39c61a994a62e713d88282`,run38515914099/job115694554876,
the bounded fresh corpus attempt timed out on original A after120,100ms. HTTP,
usage and completion are unknown; no predictions or full aggregate exist. The
prior21/21 A result remains valid one-image evidence. It does not establish the
other315 cells,OFF/BLANK/UNREADABLE behavior or reliable service completion.

Cumulative Gemini generation attempts5: two generic400s,one successful A,one503,
one timeout. Known returned tokens1,458 input+2,784 output=4,242; usage unknown for
the four failed requests. Model GET and countTokens each ran once separately.
Actual billed amount and account remaining quota are not measured; unknown usage
is not zero. No billing configuration,paid fallback or private-image request was
made. No further Gemini requests in this execution. The registered key need not
be replaced. No external recognizer was activated or wrote product/D1 data.

The next authenticated candidate requires an owner Free OCR.space key. The
closed one-image response-contract probe and exact owner setup instructions are
in `docs/ocrspace-free-readiness.md`. It reuses the original corpus/scorer and
does not claim that a new evaluation,Markdown adapter or product integration is
already accepted.

OCR_SOFTWARE_ACCEPTED and FULL_PRODUCT_SOFTWARE_ACCEPTED remain PARTIAL/BLOCKED.
RELEASE_HOLD_UNTIL_OWNER_APPROVAL remains unchanged.
