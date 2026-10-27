import { validPolicy } from "./policy-validation";
import { digest } from "../auth/crypto";
import { handleDocuments } from "../documents/service";
import {
  PrivateError,
  privateJson,
  readJson,
  type Principal,
  type PrivateEnv,
} from "../auth/contracts";
import { CaseRepository } from "./repository";
import {
  isRecordKind,
  validatePayload,
  type CaseRecord,
  type CasePayload,
} from "../../../src/modules/injury/domain/records";
import {
  caseDeadlines,
  benefitOverlapWarnings,
} from "../../../src/modules/injury/domain/deadlines";
import { validDate } from "../../../src/modules/injury/domain/dates";
import { reviewAnalysis, resolveAnalysisSeed } from "../../../src/modules/injury/materials/model";
import { handleAnalysisReceipts, assertReceiptCurrent, receiptApplyGuard } from "./analysis-receipts";
import {
  summarizeLedger,
  type PaymentEvent,
  type LegalPolicy,
} from "../../../src/modules/injury/domain/calculations";
const now = () => new Date().toISOString();
export async function ownCase(
  env: PrivateEnv,
  p: Principal,
): Promise<{ id: string; owner_id: string }> {
  // Single configured case, owned by the provisioned member. No user-supplied owner ID.
  const row = await env.DB.prepare(
    "SELECT p.id,p.owner_id FROM case_profiles p JOIN auth_users u ON p.owner_id=u.id WHERE u.role='member' AND u.disabled=0 LIMIT 1",
  ).first<{ id: string; owner_id: string }>();
  if (!row) throw new PrivateError(503, "CASE_NOT_PROVISIONED");
  return row;
}
export async function handleCase(
  request: Request,
  env: PrivateEnv,
  p: Principal,
  path: string[],
  driveFetch: typeof fetch = fetch,
): Promise<Response> {
  const profile = await ownCase(env, p),
    repo = new CaseRepository(env.DB, p, profile.id);
  if (path[0] === "consent") {
    const owner = p.id === profile.owner_id;
    if (request.method === "GET") {
      const consent = await env.DB.prepare(
        "SELECT admin_access,purpose,retention,revision,updated_at FROM case_consents WHERE case_id=?1",
      )
        .bind(profile.id)
        .first();
      return privateJson({
        owner,
        consent: owner ? consent : null,
        adminAccess: !!consent?.admin_access,
      });
    }
    if (request.method === "PUT" && owner) {
      await repo.authorize();
      const body = await readJson(request);
      if (
        typeof body.adminAccess !== "boolean" ||
        typeof body.purpose !== "string" ||
        body.purpose.length > 500 ||
        typeof body.retention !== "string" ||
        body.retention.length > 300 ||
        !Number.isInteger(body.revision)
      )
        throw new PrivateError(400, "INVALID_CONSENT");
      if (body.adminAccess && (!body.purpose.trim() || !body.retention.trim()))
        throw new PrivateError(400, "CONSENT_DETAILS_REQUIRED");
      const row = await env.DB.prepare(
        `UPDATE case_consents SET admin_access=?5,purpose=?6,retention=?7,revision=revision+1,updated_by=?2,updated_at=?8 WHERE case_id=?1 AND revision=?9 AND ${repo.acl()} RETURNING revision`,
      )
        .bind(
          ...repo.args(),
          body.adminAccess ? 1 : 0,
          body.purpose,
          body.retention,
          now(),
          Number(body.revision),
        )
        .first();
      if (!row) {
        await repo.authorize();
        throw new PrivateError(409, "REVISION_CONFLICT");
      }
      return privateJson(row);
    }
    throw new PrivateError(403, "OWNER_ONLY");
  }
  await repo.authorize();
  if (path[0] === "analysis-receipts")
    return handleAnalysisReceipts(request,env,p,repo,path.slice(1));
  if (path[0] === "documents")
    return handleDocuments(
      request,
      env,
      p,
      repo,
      p.id === profile.owner_id,
      path.slice(1),
      driveFetch,
    );
  if (!path.length && request.method === "GET") {
    const records = await repo.list(),
      policies = await repo.policies();
    const payments = (
      await env.DB.prepare(
        "SELECT * FROM case_payment_events WHERE case_id=?1 ORDER BY event_date,id",
      )
        .bind(profile.id)
        .all()
    ).results;
    const documents = (
      await env.DB.prepare(
        "SELECT id,filename,mime,bytes,sha256,status,created_at FROM case_documents WHERE case_id=?1 ORDER BY created_at DESC",
      )
        .bind(profile.id)
        .all()
    ).results;
    await repo.authorize();
    return privateJson({
      caseId: profile.id,
      actors: (
        await env.DB.prepare(
          "SELECT id,role FROM auth_users WHERE disabled=0",
        ).all<{ id: string; role: string }>()
      ).results.map((u) => ({
        id: u.id,
        name: u.role === "admin" ? "관리자" : "신이본",
      })),
      owner: p.id === profile.owner_id,
      records,
      policies,
      payments,
      documents,
      deadlines: caseDeadlines(records, undefined, policies),
      overlaps: benefitOverlapWarnings(records),
    });
  }
  if (path[0] === "records" && path[1]) {
    if(path[1].startsWith("analysis-receipt-")) throw new PrivateError(404,"RECORD_NOT_FOUND");
    if (path[2] === "restore" && request.method === "POST") {
      const body = await readJson(request);
      if (!Number.isSafeInteger(body.revision))
        throw new PrivateError(400, "INVALID_RECORD");
      await repo.restore(path[1], Number(body.revision));
      return privateJson({ ok: true });
    }
    if (path[2] === "history" && request.method === "GET")
      return privateJson({ history: await repo.history(path[1]) });
    if (path.length === 2 && request.method === "GET")
      return privateJson({ record: await repo.get(path[1]) });
    if (path.length === 2 && request.method === "PUT") {
      const body = await readJson(request);
      if (!isRecordKind(body.kind) || typeof body.revision !== "number")
        throw new PrivateError(400, "INVALID_RECORD");
      return privateJson({
        record: await repo.save(
          path[1],
          body.kind,
          body.payload,
          body.revision,
        ),
      });
    }
    if (path.length === 2 && request.method === "DELETE") {
      const body = await readJson(request);
      if (typeof body.revision !== "number")
        throw new PrivateError(400, "INVALID_RECORD");
      await repo.archive(path[1], body.revision);
      return privateJson({ ok: true });
    }
  }
  if (path[0] === "audit" && request.method === "GET") {
    return privateJson({
      events: (
        await env.DB.prepare(
          `SELECT actor_id,action,target_id,outcome,created_at FROM case_audit WHERE case_id=?1 AND ${repo.acl()} ORDER BY created_at DESC LIMIT 200`,
        )
          .bind(...repo.args())
          .all()
      ).results,
    });
  }
  if (path[0] === "payments" && request.method === "POST") {
    const b = await readJson(request);
    const claim = await repo.get(String(b.claimId ?? ""));
    if (claim.kind !== "benefit_claim" || claim.archivedAt)
      throw new PrivateError(400, "INVALID_CLAIM");
    const type = String(b.eventType),
      amount = Number(b.amount),
      days = Number(b.recognizedDays ?? 0);
    if (
      !["decision", "deposit", "decision_adjustment", "refund"].includes(
        type,
      ) ||
      !Number.isSafeInteger(amount) ||
      Math.abs(amount) > 100000000000 ||
      !Number.isInteger(days) ||
      Math.abs(days) > 1500 ||
      !validDate(b.eventDate)
    )
      throw new PrivateError(400, "INVALID_PAYMENT");
    if (
      (type !== "decision_adjustment" && (amount < 0 || days < 0)) ||
      (["deposit", "refund"].includes(type) && days !== 0)
    )
      throw new PrivateError(400, "INVALID_PAYMENT");
    const source = await repo.get(String(b.sourceRecordId ?? ""));
    if (
      (source.payload.certainty !== "official" &&
        source.payload.certainty !== "documented") ||
      !source.payload.sourceIds.length
    )
      throw new PrivateError(400, "PAYMENT_SOURCE_REQUIRED");
    if (
      ["decision", "decision_adjustment"].includes(type) &&
      source.payload.certainty !== "official"
    )
      throw new PrivateError(400, "OFFICIAL_SOURCE_REQUIRED");
    const corrects =
      typeof b.correctsId === "string" && b.correctsId ? b.correctsId : null;
    if (["decision_adjustment", "refund"].includes(type) && !corrects)
      throw new PrivateError(400, "CORRECTION_REFERENCE_REQUIRED");
    if (corrects) {
      const old = await env.DB.prepare(
        "SELECT event_type FROM case_payment_events WHERE case_id=?1 AND claim_id=?2 AND id=?3",
      )
        .bind(profile.id, claim.id, corrects)
        .first<{ event_type: string }>();
      if (
        !old ||
        (type === "refund" && old.event_type !== "deposit") ||
        (type === "decision_adjustment" &&
          !["decision", "decision_adjustment"].includes(old.event_type))
      )
        throw new PrivateError(400, "INVALID_CORRECTION");
    }
    const key = String(b.reference ?? "").trim();
    if (key.length < 3 || key.length > 150)
      throw new PrivateError(400, "REFERENCE_REQUIRED");
    const id = crypto.randomUUID();
    const found = await env.DB.prepare(
      "SELECT * FROM case_payment_events WHERE case_id=?1 AND dedupe_key=?2",
    )
      .bind(profile.id, key)
      .first();
    if (found) {
      if (
        found.claim_id === claim.id &&
        found.event_type === type &&
        found.amount === amount &&
        found.recognized_days === days &&
        found.event_date === b.eventDate &&
        found.source_record_id === source.id &&
        found.corrects_id === corrects
      )
        return privateJson({ id: found.id, duplicate: true });
      throw new PrivateError(409, "PAYMENT_REFERENCE_CONFLICT");
    }
    const inserted = await env.DB.prepare(
      `INSERT INTO case_payment_events SELECT ?5,?1,?6,?7,?8,?9,?10,?11,?12,?13,?2,?14 WHERE ${repo.acl()} ON CONFLICT(case_id,dedupe_key) DO NOTHING RETURNING id`,
    )
      .bind(
        ...repo.args(),
        id,
        claim.id,
        type,
        amount,
        days,
        b.eventDate,
        source.id,
        corrects,
        key,
        now(),
      )
      .first();
    if (!inserted) {
      await repo.authorize();
      throw new PrivateError(409, "PAYMENT_REFERENCE_CONFLICT");
    }
    return privateJson({ id }, 201);
  }

  if (path[0] === "policies" && request.method === "POST") {
    if (p.role !== "admin") throw new PrivateError(403, "ADMIN_ONLY");
    const b = await readJson(request);
    const candidates =
      path[1] === "import" &&
      b.version === "cbh-policy/v1" &&
      b.approved === true
        ? b.policies
        : path.length === 1
          ? [b.policy]
          : null;
    if (
      !Array.isArray(candidates) ||
      !candidates.length ||
      candidates.length > 10 ||
      !candidates.every(validPolicy)
    )
      throw new PrivateError(400, "INVALID_POLICY");
    const policies = candidates as LegalPolicy[];
    if (
      new Set(policies.map((p) => p.key + ":" + p.version)).size !==
      policies.length
    )
      throw new PrivateError(400, "INVALID_POLICY");
    const statements = [];
    for (const policy of policies) {
      const existing = (await repo.policies()).find(
        (p) => p.key === policy.key && p.version === policy.version,
      );
      if (existing) {
        const fields = [
          "effectiveFrom",
          "effectiveTo",
          "status",
          "sourceUrl",
          "checkedAt",
        ] as const;
        if (
          fields.some((k) => existing[k] !== policy[k]) ||
          Object.keys({ ...existing.values, ...policy.values }).some(
            (k) => existing.values[k] !== policy.values[k],
          )
        )
          throw new PrivateError(409, "POLICY_VERSION_CONFLICT");
        continue;
      }
      statements.push(
        env.DB.prepare(
          `INSERT INTO case_policies SELECT ?5,?6,?7,?8,?9,?10,?11,?12,?13,?2,?14 WHERE ${repo.acl()} RETURNING id`,
        ).bind(
          ...repo.args(),
          crypto.randomUUID(),
          policy.key,
          policy.version,
          policy.effectiveFrom,
          policy.effectiveTo,
          policy.status,
          policy.sourceUrl,
          policy.checkedAt,
          JSON.stringify(policy.values),
          now(),
        ),
      );
    }
    try {
      const result = statements.length ? await env.DB.batch(statements) : [];
      await repo.authorize();
      return privateJson({
        inserted: result.reduce((n, r) => n + (r.results?.length ?? 0), 0),
        duplicateSafe: true,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /UNIQUE constraint failed: case_policies/.test(error.message)
      )
        throw new PrivateError(409, "POLICY_VERSION_CONFLICT");
      throw error;
    }
  }

  if ((path[0] === "import" || path[0] === "analysis") && request.method === "POST") {
    let body = await readJson(request);
    let applicationReceiptId: string | null = null;
    if (path[0] === "analysis") {
      if (body.approved !== true) throw new PrivateError(400, "INVALID_ANALYSIS");
      const {receiptId,...draft}=body;
      if(receiptId!==undefined&&typeof receiptId!=="string") throw new PrivateError(400,"INVALID_ANALYSIS");
      applicationReceiptId=typeof receiptId==="string"?receiptId:null;
      const received=applicationReceiptId?await assertReceiptCurrent(repo,applicationReceiptId):null;
      try {
        const reviewed=reviewAnalysis(draft);
        if(received) {
          const allowed=new Set(reviewAnalysis(received).result.suggestions.map(s=>JSON.stringify(s)));
          if(reviewed.result.suggestions.some(s=>!allowed.has(JSON.stringify(s)))) throw Error("RECEIPT_RESULT_CHANGED");
        }
        body={...await resolveAnalysisSeed(reviewed,digest),approved:true};
      } catch { throw new PrivateError(400,"INVALID_ANALYSIS"); }
    }
    if (
      body.version !== "cbh-case-seed/v1" ||
      body.approved !== true ||
      !Array.isArray(body.records) ||
      !body.records.length ||
      body.records.length > 80
    )
      throw new PrivateError(400, "INVALID_IMPORT");
    const rows: Array<{ id: string; kind: string; payload: CasePayload }> = [];
    for (const entry of body.records) {
      if (!entry || !isRecordKind(entry.kind))
        throw new PrivateError(400, "INVALID_RECORD");
      let payload: CasePayload;
      try {
        payload = validatePayload(entry.kind, entry.payload);
      } catch {
        throw new PrivateError(400, "INVALID_RECORD");
      }
      rows.push({
        id:
          "import-" +
          (await digest(JSON.stringify({ kind: entry.kind, payload }))).slice(
            0,
            48,
          ),
        kind: entry.kind,
        payload,
      });
    }
    // One bounded preflight query covers the complete batch. Per-record source
    // lookups exceed Workers Free's query allowance for ordinary large imports.
    const documentIds=[...new Set(rows.flatMap(r=>[...r.payload.sourceIds,...(r.payload.data.sourceDocument?[String(r.payload.data.sourceDocument)]:[])]))];
    const planned=new Map(rows.map(row=>[row.id,row.kind]));
    const allLinks=rows.flatMap(r=>["employmentId","claimId","relatedId","relatedMessage"].flatMap(key=>r.payload.data[key]?[{id:String(r.payload.data[key]),kind:key==="employmentId"?"employment":key==="claimId"?"benefit_claim":"*"}]:[]));
    for(const row of rows) for(const key of ["employmentId","claimId","relatedId","relatedMessage"]){
      const id=String(row.payload.data[key]??"");
      if(!id||!planned.has(id))continue;
      const kind=planned.get(id);
      if((key==="employmentId"&&kind!=="employment")||(key==="claimId"&&kind!=="benefit_claim")||(key==="relatedMessage"&&kind!=="content")) throw new PrivateError(400,"INVALID_LINK");
    }
    const links=allLinks.filter(link=>!planned.has(link.id));
    const validation=await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM json_each(?5) j WHERE NOT EXISTS(SELECT 1 FROM case_documents d WHERE d.id=j.value AND d.case_id=?1 AND d.status='ready')) missing_documents,
      (SELECT COUNT(*) FROM json_each(?6) j WHERE NOT EXISTS(SELECT 1 FROM case_records r WHERE r.id=json_extract(j.value,'$.id') AND r.case_id=?1 AND r.archived_at IS NULL AND r.id NOT LIKE 'analysis-receipt-%')) missing_links,
      (SELECT COUNT(*) FROM json_each(?6) j WHERE json_extract(j.value,'$.kind')<>'*' AND EXISTS(SELECT 1 FROM case_records r WHERE r.id=json_extract(j.value,'$.id') AND r.case_id=?1 AND r.kind<>json_extract(j.value,'$.kind'))) wrong_kind
      WHERE ${repo.acl()}`).bind(...repo.args(),JSON.stringify(documentIds),JSON.stringify(links)).first<{missing_documents:number;missing_links:number;wrong_kind:number}>();
    if(!validation){await repo.authorize();throw new PrivateError(403,"CASE_ACCESS_DENIED");}
    if(validation.missing_documents) throw new PrivateError(400,"VERIFIED_DOCUMENT_REQUIRED");
    if(validation.missing_links) throw new PrivateError(404,"RECORD_NOT_FOUND");
    if(validation.wrong_kind) throw new PrivateError(400,"INVALID_LINK");
    // A stale ACL/source/link must abort the entire D1 batch, not silently skip
    // one row. SQLite json('') deliberately raises inside the invalid CASE branch.
    const result = await env.DB.batch(
      rows.map((row) =>
        env.DB.prepare(
          `INSERT INTO case_records SELECT ?5,?1,?6,
          CASE WHEN ${repo.acl()} AND (?9 IS NULL OR ${receiptApplyGuard()})
          AND NOT EXISTS(SELECT 1 FROM json_each(?7,'$.sourceIds') j WHERE NOT EXISTS(SELECT 1 FROM case_documents d WHERE d.id=j.value AND d.case_id=?1 AND d.status='ready'))
          AND (COALESCE(json_extract(?7,'$.data.sourceDocument'),'')='' OR EXISTS(SELECT 1 FROM case_documents d WHERE d.id=json_extract(?7,'$.data.sourceDocument') AND d.case_id=?1 AND d.status='ready'))
          AND NOT EXISTS(SELECT 1 FROM json_each(?7,'$.data') link WHERE link.key IN ('employmentId','claimId','relatedId','relatedMessage') AND link.value<>'' AND NOT EXISTS(SELECT 1 FROM case_records linked WHERE linked.id=link.value AND linked.case_id=?1 AND linked.archived_at IS NULL AND linked.id NOT LIKE 'analysis-receipt-%' AND (link.key<>'employmentId' OR linked.kind='employment') AND (link.key<>'claimId' OR linked.kind='benefit_claim')))
          THEN ?7 ELSE json('') END,1,?2,?8,NULL
          ON CONFLICT(id) DO NOTHING RETURNING id`,
        ).bind(
          ...repo.args(),
          row.id,
          row.kind,
          JSON.stringify(row.payload),
          now(),
          applicationReceiptId,
        ),
      ),
    );
    await repo.authorize();
    return privateJson({
      inserted: result.reduce((n, r) => n + (r.results?.length ?? 0), 0),
      duplicateSafe: true,
    });
  }
  if (path[0] === "export" && request.method === "GET") {
    await repo.audit("export", profile.id);
    const records = await repo.list(),
      policies = await repo.policies();
    const rows = async (table: string) =>
      (
        await env.DB.prepare(
          `SELECT * FROM ${table} WHERE case_id=?1 AND ${repo.acl()}`,
        )
          .bind(...repo.args())
          .all()
      ).results;
    const payments = await rows("case_payment_events"),
      revisions = (await rows("case_revisions")).filter(r=>!String(r.record_id).startsWith("analysis-receipt-"));
    const documents = (
      await env.DB.prepare(
        `SELECT id,filename,mime,bytes,sha256,drive_file_id,drive_revision,folder_id,status,created_by,created_at,updated_at FROM case_documents WHERE case_id=?1 AND ${repo.acl()}`,
      )
        .bind(...repo.args())
        .all()
    ).results;
    await repo.authorize();
    return privateJson({
      version: "cbh-case/v1",
      exportedAt: now(),
      records,
      policies,
      payments,
      revisions,
      documents,
    });
  }
  throw new PrivateError(404, "NOT_FOUND");
}
