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
the fixed Llama 3.2 Vision endpoint and no AI Gateway or paid fallback. It reserves
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

The existing scorer is unchanged. The model receives the original prompt, a
source image identifier and the full image only, never ground truth. Missing or
malformed JSON stays missing; dates, names and approval flags are not repaired
using expected values. Output limits are explicitly recorded in the runner.
Raw responses stay in process memory. Only hashes, timings, token usage and
independent aggregate/per-image metrics reach logs. There is no artifact upload.

API execution, accuracy, reviewed import software, original private screenshots,
production and real iPhone acceptance remain separate judgments.

Official references:

- https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
