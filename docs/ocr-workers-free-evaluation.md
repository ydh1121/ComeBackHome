# Workers Free OCR evaluation

This is an isolated provider evaluation on PR92. It does not activate cloud OCR
in the product, deploy a Worker, update D1, send messages or change billing.

On 2026-10-13 the owner supplied screenshots showing **Workers Free / Current
plan**, confirmed negligible prior usage, and required free-only execution.
The dedicated Actions secret now reads the Workers AI catalog (HTTP 200); billing
subscription metadata needs another permission (HTTP 403). No billing permission
expansion is requested. Exact account Neurons have not been measured. The billing
cost of $0 is not treated as zero Neurons.

The dated one-time runner uses the provider-enforced Workers Free daily limit,
the fixed, documented Free-eligible model allowlist and no AI Gateway or paid fallback. It reserves
at most 8,000 Neurons using returned token usage at the published model rates,
or the model's full context/output ceiling when usage is absent. These are
**pricing estimates/reservations**, not a measured account Neurons delta. Every
HTTP failure, quota response or uncertain network outcome stops without retry.
The same-date gate expires the owner evidence; run attempts after the first are
blocked. The original private probe and its explicit dashboard-quota gates are
preserved byte-for-byte inside the archived corpus; they are not invoked here.

The owner's earlier Meta License/AUP approval authorizes the official initial
`{"prompt":"agree"}` request. Its real response must be recorded before image
evaluation. No license approval is inferred from a catalog response.

The original v2 archive is copied verbatim to
`test/fixtures/import/free-ocr-evaluation-v2.zip`:

- archive SHA-256: `6ef21653700982396adf75d32e0fd892c939fcfc3453a4d0ca389bb2ba08965a`
- independent scorer SHA-256: `c673e7337cb65896057c543e07a599ed55050f221f74bcb1d6ded9fc94485004`
- 12 explicitly synthetic PNGs / 336 truth cells; no real employee data

The existing scorer is unchanged. The baseline uses the original prompt; subsequent prompt/serialization variants
are recorded separately. The model receives an image and source identifier,
never ground truth. Missing or
malformed JSON stays missing; dates, names and approval flags are not repaired
using expected values. Output limits are explicitly recorded in the runner.
Raw responses stay in process memory. Only hashes, timings, token usage and
independent aggregate/per-image metrics reach logs. There is no artifact upload.

API execution, accuracy, reviewed import software, original private screenshots,
production and real iPhone acceptance remain separate judgments.

## Historical 14:05 KST denial (resolved at 15:25 KST)

- Read-only run `38346720248`, attempt 2 / job `115134832055`: catalog HTTP 200,
  Llama Vision listed; subscription metadata HTTP 403 / error code 10000.
- Evaluation run `38348918544` / job `115136612608`, source `e12840c`:
  official Meta agreement POST returned **HTTP 403 in 441 ms**. The first runner
  did not retain numeric error codes from failed HTTP bodies. Do not infer the
  exact missing permission from this response or confuse it with an OpenAI
  safety-tool rejection. No alternate credential, endpoint or model was tried.
- Image requests **0**; license request attempted **1**, successful license
  acceptance **unconfirmed**; independent model accuracy, tokens and actual
  Neurons **NOT MEASURED**. The original log's 336 missing-cell score is an
  unexecuted scorer result, not measured 0% model accuracy. The runner now emits
  a null aggregate for this case and retains safe numeric HTTP diagnostics for
  any future owner-authorized execution. It has not been rerun.
- Original/private images in repository/CI **0**; production writes **0**.
  The dated automatic trigger has already been consumed; reruns are blocked.

The original permission follow-up is superseded by the successful official API
response below. Do not request these same permissions again.

The next providers (Gemini / OCR.space Engine 3) have no authenticated execution
path available in this session. No public playground or guessed credential is
used as a fallback. Cloud OCR and complete product acceptance remain blocked.

## Owner-confirmed permission evidence, 15:25 KST

The owner's new screenshot shows both **Workers AI:Edit** and **Workers AI:Read**
for their account, and the owner explicitly instructed execution to continue.
Do not repeat the instruction to add these already-visible permissions.
The screenshot does not expose a token value or prove which token bytes are in
Actions; no credential is extracted or compared through logs.

The new dated attempt keeps the same URL, payload, credential reference, Python
HTTP client and default request headers. The only request-path change is better
failure reporting: numeric error markers from JSON or edge text, content type,
response hash/length and a validated Cloudflare Ray ID. No raw error body is
printed. An edge denial must not be worked around by rotating the user agent,
credentials, endpoint or network. The attempt still stops on any HTTP failure;
no retry occurs within the runner. Existing Meta owner approval is retained.

Actual read/edit resume, run `38356883322` / job `115161747063` at `7e34c11`:
the **same official licence request succeeded (HTTP 200, 7,514 ms)**, with API
usage 2 input / 256 output tokens. At the published rate this is a 15.751028
Neuron estimate; actual billed Neurons are not measured. The previous 403 did
not recur; its historical root cause is still unknown. Do not request the same
permissions again or report authentication as the current blocker.

The first full synthetic image request did not return a response within 120,064
ms. Its completion/consumption is unknown and its 942.292992-Neuron worst-case
reservation is retained. Zero model image responses were obtained; the scorer's
missing-cell output is not measured recognition accuracy.

The next bounded diagnostic uses the **existing v2 probe's day-crop method**:
concatenate the synthetic A image's employee-name column with its first date
group, retaining the original source-region coordinates. This is a new,
materially smaller input with max 1,024 output tokens, not an automatic repeat
of the timed-out full-image request. It skips the already-successful licence
operation, carries the prior 958.044020-Neuron reservation, makes at most one
request and stops on failure. It reports only that three-cell subset, separately
from original full-image/v2 accuracy. It cannot establish layout discovery or
production acceptance. Original images, truth and independent scorer are unchanged.

Day-crop run `38357728022` / job `115164408343` at `35ecc51`: **HTTP200 in30,907ms**,
2,031 input/1,024 output tokens, estimated71.925542 Neurons. It reached the output
cap and did not produce valid complete JSON. Authentication and image execution
work; structured OCR output is not yet accepted. Cumulative known-token estimate
87.676570 plus the unknown-request reservation942.292992 totals1029.969562 Neurons.

The next single-call experiment changes only the serialization contract: a
14-position array per cell avoids repeated JSON keys/source identifiers. A
lossless mapper restores the original evaluator's field names. It preserves
every model-produced value, including wrong dates/names/row/group/status/approval
flags; no ground-truth correction or partial-JSON salvage occurs. The prior
known and unknown consumption is carried forward; licence acceptance is not
repeated. This remains a three-cell known-template diagnostic, not a replacement
for the 12-source/336-cell evaluation or product integration acceptance.

Compact Korean-instruction pilot `38358341886` / job `115166380831` at `c7e6762`
also returned HTTP200 (31,587ms), 2,147 input/1,024 output tokens, but incomplete
or invalid JSON. Its pricing estimate is72.437102 Neurons; cumulative reservation
is1102.406664 including the original unknown full-image request. No field
recognition accuracy is established from these invalid outputs.

One final bounded syntax diagnostic uses English instructions with the same
14-field contract and source crop, max1536 output tokens. It reports only syntax
shape, known key presence, generic parser error and token/timing metadata, never
raw OCR text. JSON Mode is not enabled: the official supported-model list does
not include this Llama Vision model. The same independent scorer remains the
judge of any complete parsed values; missing/incorrect output is not repaired.
Reference: https://developers.cloudflare.com/workers-ai/features/json-mode/

Official references:

- https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
- https://developers.cloudflare.com/workers-ai/platform/pricing/

## 22:25 KST syntax finding and full-image method

English diagnostic run `38404633180` / job `115320913617`, source `43e2a5a`,
returned HTTP200 in21,649ms:1,886 input/464 output tokens, estimate36.850012
Neurons. It did not hit its1,536-token cap. The output has explanatory prose
and one fenced block with balanced delimiters, but the strict original parser
rejected the whole response. Raw OCR text was not logged or retained. Balanced
delimiters alone do not prove valid JSON or recognition accuracy.

The complete-JSON reader now accepts one complete JSON object, either directly
or inside exactly one closed JSON fence. It rejects partial JSON, multiple
blocks, JSON outside the fence, duplicate keys and non-JSON constants. Named
records and compact arrays map without correcting any model-produced value.
Incorrect source IDs, dates, names, times and review flags remain incorrect.

A new full-image method uses English instructions, max3,072 output tokens and
this parser on the original12 PNGs. It is explicitly separate from the timed-out
Korean baseline and known-template crop pilots. Prior usage/reservation
1,139.256676 Neurons is carried forward; licence acceptance is not repeated.
Any HTTP/timeout/output-contract failure or insufficient conservative budget
stops the sequence without retry. A full336-cell aggregate is produced only
when all12 images complete; otherwise only the attempted subset is reported.
The evaluator, ground truth, original images and acceptance requirements remain
unchanged. This method is not product integration or private-original acceptance.

## Full-image Llama result and bounded Cloudflare Gemma4 comparison

Run `38405347734` / job `115323394237` at `8cd6708` stopped on the
first original A image after120,106ms without an HTTP response. Consumption
is unknown; reserve753.386496 Neurons, carrying cumulative1,892.643172.
The full336-cell aggregate is null, and the unparsed21-cell missing count is
not a measured recognition accuracy. No identical automatic retry occurs.

The same authenticated Cloudflare account can evaluate the separate hosted
`@cf/google/gemma-4-26b-a4b-it` candidate under Workers Free. Cloudflare explicitly
lists Vision and a256,000-token context; current pricing lists9,091/27,273
Neurons per million input/output tokens and does not include Gemma4 among the
paid-billing-only models. Google publishes Gemma4 under Apache2.0. This is a
Cloudflare-hosted comparison, not a Google AI Studio/Gemini call or a paid fallback.
No new licence-acceptance, billing, Gateway or deployment operation is performed.

Before any Gemma inference the runner GETs its official input schema and requires
messages, image_url, max_completion_tokens and response_format support. Schema
failure stops before images. Requests use native /ai/run, one in-memory base64
image in user content, json_object format and3,072 max completion tokens.
The existing complete-JSON parser and unchanged independent scorer remain in use.
Each request reserves the entire documented context plus capped output at the
Gemma rates; missing usage retains that reservation. Cumulative8,000 budget,
date/account/branch gates, stop-on-failure and no-retry remain unchanged.

Sources checked2026-10-13:
- https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/api/resources/ai/subresources/models/subresources/schema/methods/get/
- https://blog.google/intl/ko-kr/company-news/technology/gemma-4-kr/

Gemma initial run `38406403822` / job `115327039866` at `26b9d45`:
official schema GET HTTP200 confirmed all four required multimodal/format fields.
The A image inference returned HTTP200 in20,950ms,592 input/3,072 completion
tokens,89.164528 estimated Neurons, finish_reason=length and no final text.
No recognition accuracy is established. Cumulative reservation1,981.807700.
The returned metadata did not capture reasoning-token detail, so reasoning
exhaustion is a hypothesis, not a measured diagnosis.

Cloudflare's official Gemma4 example specifies
`chat_template_kwargs: {enable_thinking: false}`. The next request configuration
applies that documented flag, keeps3,072 maximum completion tokens, and verifies
chat_template_kwargs in the schema. No thought text is read as OCR output or
published; only the presence boolean is recorded. This changes a concrete
configuration omission instead of increasing token/time budgets or repairing
partial output. Prior usage is retained.
Source: https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/

## First complete actual v2 evaluation — measured, quality not accepted

Gemma4 nonthinking run `38406839538` / job `115328555593` at `d67e6d5`
completed all12 original synthetic images with HTTP200 and complete parsed JSON.
Independent unchanged scorer:336 truth cells,328 predictions,8 missing,0
unmatched/duplicate positions. Date/row/column97.6190%; weekday52.0833%;
name76.7857%; status97.3214%; SHIFT start82.4451%,end78.0564%,break50.4702%.
Review-required boolean was true in237/336;91 aligned predictions were not
explicitly review-required. One blank was classified SHIFT;8 blanks were omitted.
These are measured failures, not waived gates. No predictions were stored or
activated in the product, and no real user approval was bypassed.

Usage:6,884 input +17,103 completion tokens;529.032563-Neuron pricing estimate.
Latency9,981–44,516ms,mean31,622ms,total379,464ms. Cumulative reservation
2,510.840263 includes all previous known usage and both unknown full-image calls.
Exact account/billed Neurons remain unmeasured. Required software CI at the same
HEAD: run38406847120,12/12 SUCCESS plus one conditional oracle skipped. API
workflow success only means evaluation completed; it does not accept OCR quality.

One final Cloudflare full-corpus variant in this execution restores the original
Korean OCR_PROMPT.txt verbatim and requests named JSON-schema fields instead of
positional arrays. This tests output/normalization ambiguity without using truth
values to fix predictions. The schema constrains field types/enumerated states,
not names, dates, times, employee count or the review_required value (false remains
allowed and scored as a failure). All12 unmodified images and the original scorer
remain the same. Max completion6144 accounts for repeated field names; at the
Gemma rate the entire context+output reservation remains within the cumulative
8000 ceiling. Reasoning stays disabled; one failure stops without retry. If this
variant fails quality, the model remains rejected and the next provider needs
authenticated free-tier access; no further prompt-fitting in this execution.
