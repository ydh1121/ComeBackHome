# Analysis exchange and reviewed application

The ordinary user path is documented in [자료·메모 사용 안내](materials-help.md). It uses a copied request and a JSON file/pasted reply. It requires no new API key or paid provider. The optional receiver described below is for a separately configured HTTP-capable tool; a normal ChatGPT conversation cannot automatically call it.

Status: implementation and exact-head acceptance are tracked in [materials closeout](materials-batch-acceptance.md). This contract does not assert a live external-tool integration, real-source application or real-iPhone acceptance.

## Result format

`cbh-analysis/v1` continues to accept `memo` and `task` suggestions. `cbh-analysis/v2` additionally accepts existing specialist records and proposed document categories. At most 40 suggestions, 20 document moves and 180,000 UTF-8 JSON bytes are accepted.

```json
{
  "version": "cbh-analysis/v2",
  "suggestions": [
    {
      "type": "memo",
      "title": "확인할 내용",
      "body": "원본에서 확인한 내용과 아직 모르는 내용을 구분합니다.",
      "sourceIds": []
    },
    {
      "type": "task",
      "title": "필요한 서류 확인",
      "body": "담당 기관에 추가 서류가 필요한지 문의합니다.",
      "sourceIds": []
    },
    {
      "type": "record",
      "kind": "agency_request",
      "title": "발급할 서류",
      "body": "발급 여부를 확인할 참고 기록입니다.",
      "sourceIds": [],
      "data": { "status": "needed" }
    }
  ]
}
```

The example is synthetic and contains no private source. `sourceIds` must contain actual document IDs from the selected, verified case sources; a memo-only proposal can use an empty array. Do not invent IDs. Optional `dueDate` on a `task` is a recommended review date in `YYYY-MM-DD`, not an official or legal deadline.

For `type: record`, `kind` and `data` use [RECORD_SPECS](../../src/modules/injury/domain/records.ts). The generated request lists the current fields and options. Required facts that are unknown must remain a memo/question instead of a fabricated structured record. References to existing records must target an active record of the correct kind in the same case. To link new suggestions in one batch, give a suggestion a unique `ref` (a letter followed by at most 47 letters, digits, underscores or hyphens), then use `@ref` in `employmentId`, `claimId`, `relatedId` or `relatedMessage`. The server orders dependencies, resolves deterministic IDs and rejects missing, circular or wrong-kind references. The review UI selects required parents with their children; repeated or reordered imports preserve existing edits.

All 19 existing kinds are supported: `content`, `task`, `intake`, `employer_opinion`, `agency_request`, `treatment`, `benefit_claim`, `unemployment_activity`, `expense`, `disability`, `additional_claim`, `employment`, `paid_day`, `resignation`, `payroll`, `exposure`, `simulation`, `severance_leave`, `incident`.

Normalization always produces `certainty: reported`. Official states and protected fields are retained in readable proposed text, with conservative status/verification values in the structured record. They cannot activate confirmed diagnoses, official periods, verified paid-day counts, official/legal deadlines or policies. The exact held-field policy is in [analysis-model.ts](../../src/modules/injury/materials/analysis-model.ts). Financial ledger events are not part of this format. Source-backed official updates and actual deposits continue through their existing review screens.

A v2 result may contain `documentMoves: [{"documentId":"<selected-document-id>","category":"medical"}]`. Allowed categories are `application`, `medical`, `employment`, `payments`, `correspondence`, `other`. A moves-only result may have an empty `suggestions` array. The placeholder is illustrative; replace it with a selected document ID. A move proposal is not authorization to move.

## Ordinary application

The review UI validates the result, displays the destination and normalized values, and lets the user choose which entries to save. The logged-in, same-origin request to `POST /api/private/case/analysis` contains the selected result plus a UI-issued `approved: true`. Approval supplied inside an uploaded file has no authority. A received result may also include its `receiptId` so the server can check it against the stored proposal and current sources.

The server validates ACL, verified source membership and cross-record references. It inserts new records atomically with duplicate-safe IDs; it does not overwrite existing records. A result cannot update the append-only ledger, policies or an original document.

Drive organization is a separate logged-in, same-origin call:

```json
{
  "approved": true,
  "proposals": [{ "documentId": "<selected-document-id>", "category": "medical" }]
}
```

Send it to `POST /api/private/case/documents/organize` only after the user reviews files and destinations. One approval processes up to 20 files sequentially; each API request accepts one proposal to stay within the Free plan's external-request limit. The API returns per-file `organized` or `failed` outcomes; a partial result is not batch atomicity. Received proposals include `receiptId` and must still match current sources and the staged categories. Only app-managed category folders directly inside the configured private root are allowed. File content, identity/link and permissions remain unchanged. An encrypted operation journal permits reconciliation after an ambiguous remote response or a post-move D1 failure. `GET /api/private/case/documents/{id}/organization` reports a pending category without exposing the journal. Stop or navigation cancels scheduling; retry reconciles the same category without deleting an original. Conditional movement requires a strong ETag; when v3 omits it, verified v2 metadata with identical revision/version/parent supplies a conditional v2 patch. If these checks fail, no move is made.

## Optional authenticated receiver

[OpenAPI for result submission](analysis-return.openapi.json) describes the only capability-authenticated ingress. It is an integration contract, not a preinstalled ChatGPT Action or a connected provider.

| Operation | Authentication and effect |
|---|---|
| `POST /api/private/case/analysis-receipts` | Existing login, same origin and case ACL. Body: `{documentIds: [...], notes: [{id, revision}]}`. Up to 20 documents and 40 notes; at least one source. Creates a receipt bound to the issuing user/session, auth epoch, source hashes/sizes and note revisions. |
| `GET /api/private/case/analysis-receipts` | Existing login and creator ownership. Lists at most 30 recent receipts without bearer secrets. |
| `GET /api/private/case/analysis-receipts/{id}` | Existing login and creator ownership. Returns the staged normalized result only when current authorization and sources remain valid; otherwise marks it stale. |
| `POST /api/private/case/analysis-receipts/{id}/revoke` | Existing login, same origin and creator ownership. Cancels the capability. |
| `POST /api/private/analysis-return/{id}` | `Authorization: Bearer <issued-token>`, `Content-Type: application/json`. Accepts one valid v1/v2 result for review. No browser-session cookie authority is granted to this ingress. |

The grant response contains `id`, `token`, `endpoint` and `expiresAt`. The token has 256 bits of randomness, is returned once, is stored only as a hash on the server and expires after one hour. At most five unexpired waiting grants are permitted per creator/case. The UI keeps the returned token in memory and removes it from the displayed panel when closed; lists and result reads do not reveal it.

The callback rechecks the issuing account, session, authorization epoch, consent and sources. Logout, password/session revocation, revoked case access, stale notes or changed document metadata prevent acceptance. It accepts only source IDs within the grant. It cannot read/download a source, apply records, move Drive files, change permissions or write payment events.

Successful receipt returns HTTP `202` with `accepted: true`, `reviewRequired: true` and `duplicate: false`. Retrying the same normalized result during the grant lifetime returns `duplicate: true`; a different second result is rejected. Expired/revoked grants return `410`; invalid bearer authentication returns `401`; changed sources or a conflicting result return `409`. Invalid schema/source scope is rejected with `400`. Requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` are rejected; this is not a public cross-origin browser API.

The receiver stores a draft in the existing private record/history infrastructure, hidden from ordinary records and exports. Staging is not user approval. The user subsequently selects **답변 가져와 검토** and explicitly saves selected entries. Draft history follows existing case retention; expiry disables the token and does not claim secure deletion of retained drafts.

## Configuring a capable caller

1. Select the source files/memos in the PWA and use **분석 도구 연결 · 선택사항 → 선택한 자료의 답변 받을 연결 만들기**.
2. Give the returned endpoint and bearer token only to the trusted HTTP integration. Set its request body to the result schema above. Keep the token out of URLs, public prompts, Git, ordinary documents and logs.
3. If using a separately configured tool/Action, ensure it can perform an authenticated server-side POST and that its authentication configuration can use this short-lived grant. Importing the OpenAPI alone does not configure authentication or give the tool access to private originals. If it cannot use the grant, use JSON file/paste instead.
4. Submit the JSON before expiry. A `202` means the draft arrived; it does not mean the case changed.
5. Return to the PWA, choose **받은 답변 확인 → 답변 가져와 검토**, and review/save. Apply any file-organization proposal separately.

No new Cloudflare secret, database migration, paid inference or public sharing is required for this exchange. No external tool is called automatically by the PWA.
