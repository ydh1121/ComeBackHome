import type {
  D1DatabaseLike,
  D1Bindable,
} from "../../../packages/portable/d1/types";
import { PrivateError, type Principal } from "../auth/contracts";
import {
  isRecordKind,
  validatePayload,
  type CasePayload,
  type CaseRecord,
  type RecordKind,
} from "../../../src/modules/injury/domain/records";
import type { LegalPolicy } from "../../../src/modules/injury/domain/calculations";
const instant = () => new Date().toISOString();
interface RecordRow {
  id: string;
  case_id: string;
  kind: RecordKind;
  payload_json: string;
  revision: number;
  updated_by: string;
  updated_at: string;
  archived_at: string | null;
}
function record(row: RecordRow): CaseRecord {
  return {
    id: row.id,
    caseId: row.case_id,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    revision: row.revision,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
export class CaseRepository {
  constructor(
    readonly db: D1DatabaseLike,
    readonly principal: Principal,
    readonly caseId: string,
  ) {}
  acl() {
    return `EXISTS(SELECT 1 FROM case_profiles p JOIN auth_users u ON u.id=?2
    WHERE p.id=?1 AND u.disabled=0 AND u.auth_epoch=?3 AND EXISTS(SELECT 1 FROM auth_sessions s CROSS JOIN auth_policy ap WHERE s.token_hash=?4 AND s.user_id=u.id AND s.auth_epoch=u.auth_epoch AND s.revoked_at IS NULL AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND julianday(s.last_seen_at)>julianday('now')-ap.idle_hours/24.0) AND (p.owner_id=u.id OR (u.role='admin' AND EXISTS(SELECT 1 FROM case_consents c WHERE c.case_id=p.id AND c.admin_access=1))))`;
  }
  args(): D1Bindable[] {
    return [
      this.caseId,
      this.principal.id,
      this.principal.authEpoch,
      this.principal.sessionHash,
    ];
  }
  async authorize(): Promise<void> {
    const row = await this.db
      .prepare(`SELECT id FROM case_profiles WHERE id=?1 AND ${this.acl()}`)
      .bind(...this.args())
      .first();
    if (!row) {
      await this.audit("access", null, "denied");
      throw new PrivateError(403, "CASE_ACCESS_DENIED");
    }
  }
  async audit(
    action: string,
    target: string | null,
    outcome = "allowed",
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO case_audit VALUES(?1,(SELECT id FROM case_profiles WHERE id=?2),?3,?4,?5,?6,?7)`,
      )
      .bind(
        crypto.randomUUID(),
        this.caseId,
        this.principal.id,
        action,
        target,
        outcome,
        instant(),
      )
      .run();
  }
  async list(): Promise<CaseRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM case_records WHERE case_id=?1 AND ${this.acl()} ORDER BY updated_at DESC,id`,
      )
      .bind(...this.args())
      .all<RecordRow>();
    await this.audit("list", null);
    return result.results.map(record);
  }
  async get(id: string): Promise<CaseRecord> {
    const row = await this.db
      .prepare(
        `SELECT * FROM case_records WHERE case_id=?1 AND ${this.acl()} AND id=?5`,
      )
      .bind(...this.args(), id)
      .first<RecordRow>();
    if (!row) throw new PrivateError(404, "RECORD_NOT_FOUND");
    return record(row);
  }
  async sources(payload: CasePayload): Promise<void> {
    for (const id of payload.sourceIds) {
      const row = await this.db
        .prepare(
          `SELECT id FROM case_documents WHERE case_id=?1 AND id=?5 AND status='ready' AND ${this.acl()}`,
        )
        .bind(...this.args(), id)
        .first();
      if (!row) throw new PrivateError(400, "VERIFIED_DOCUMENT_REQUIRED");
    }
    for (const field of [
      "employmentId",
      "claimId",
      "relatedId",
      "relatedMessage",
    ]) {
      const id = payload.data[field];
      if (id) {
        const linked = await this.get(String(id));
        if (
          (field === "employmentId" && linked.kind !== "employment") ||
          (field === "claimId" && linked.kind !== "benefit_claim")
        )
          throw new PrivateError(400, "INVALID_LINK");
      }
    }
    const id = payload.data.sourceDocument;
    if (id) {
      const row = await this.db
        .prepare(
          `SELECT id FROM case_documents WHERE case_id=?1 AND id=?5 AND status='ready' AND ${this.acl()}`,
        )
        .bind(...this.args(), String(id))
        .first();
      if (!row) throw new PrivateError(400, "VERIFIED_DOCUMENT_REQUIRED");
    }
  }
  async save(
    id: string,
    kind: RecordKind,
    payload: unknown,
    revision: number,
  ): Promise<CaseRecord> {
    if (
      !isRecordKind(kind) ||
      !Number.isInteger(revision) ||
      revision < 0 ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(id)
    )
      throw new PrivateError(400, "INVALID_RECORD");
    let p: CasePayload;
    try {
      p = validatePayload(kind, payload);
    } catch (e) {
      throw new PrivateError(
        400,
        e instanceof Error ? e.message : "INVALID_RECORD",
      );
    }
    await this.sources(p);
    const time = instant();
    const verifiedSources = `NOT EXISTS(SELECT 1 FROM json_each(?7,'$.sourceIds') j WHERE NOT EXISTS(SELECT 1 FROM case_documents d WHERE d.id=j.value AND d.case_id=?1 AND d.status='ready'))`;
    // Audit and immutable revision are emitted by the same SQL write/transaction.
    let saved: RecordRow | null;
    if (revision === 0) {
      saved = await this.db
        .prepare(
          `INSERT INTO case_records SELECT ?5,?1,?6,?7,1,?2,?8,NULL WHERE ${this.acl()} AND ${verifiedSources}
        ON CONFLICT(id) DO NOTHING RETURNING *`,
        )
        .bind(...this.args(), id, kind, JSON.stringify(p), time)
        .first<RecordRow>();
    } else {
      saved = await this.db
        .prepare(
          `UPDATE case_records SET payload_json=?7,revision=revision+1,updated_by=?2,updated_at=?8
        WHERE case_id=?1 AND ${this.acl()} AND ${verifiedSources} AND id=?5 AND kind=?6 AND revision=?9 AND archived_at IS NULL RETURNING *`,
        )
        .bind(...this.args(), id, kind, JSON.stringify(p), time, revision)
        .first<RecordRow>();
    }
    if (!saved) {
      await this.authorize();
      throw new PrivateError(409, "REVISION_CONFLICT");
    }
    return record(saved);
  }
  async archive(id: string, revision: number): Promise<void> {
    const row = await this.db
      .prepare(
        `UPDATE case_records SET archived_at=?6,revision=revision+1,updated_by=?2,updated_at=?6
      WHERE case_id=?1 AND ${this.acl()} AND id=?5 AND revision=?7 AND archived_at IS NULL RETURNING id`,
      )
      .bind(...this.args(), id, instant(), revision)
      .first();
    if (!row) {
      await this.authorize();
      throw new PrivateError(409, "REVISION_CONFLICT");
    }
  }
  async history(id: string) {
    await this.get(id);
    return (
      await this.db
        .prepare(
          `SELECT revision,payload_json,author_id,created_at FROM case_revisions WHERE case_id=?1 AND ${this.acl()} AND record_id=?5 ORDER BY revision DESC`,
        )
        .bind(...this.args(), id)
        .all()
    ).results.map((r) => ({
      revision: r.revision,
      payload: JSON.parse(String(r.payload_json)),
      authorId: r.author_id,
      createdAt: r.created_at,
    }));
  }
  async restore(id: string, revision: number): Promise<void> {
    const row = await this.db
      .prepare(
        `UPDATE case_records SET archived_at=NULL,revision=revision+1,updated_by=?2,updated_at=?6 WHERE case_id=?1 AND id=?5 AND revision=?7 AND archived_at IS NOT NULL AND ${this.acl()} RETURNING id`,
      )
      .bind(...this.args(), id, instant(), revision)
      .first();
    if (!row) {
      await this.authorize();
      throw new PrivateError(409, "REVISION_CONFLICT");
    }
  }
  async policies(): Promise<LegalPolicy[]> {
    await this.authorize();
    const rows = await this.db
      .prepare(
        "SELECT * FROM case_policies ORDER BY effective_from DESC,created_at DESC,id DESC",
      )
      .all<Record<string, unknown>>();
    return rows.results.map((r) => ({
      id: String(r.id),
      key: String(r.policy_key),
      version: String(r.version),
      effectiveFrom: String(r.effective_from),
      effectiveTo: String(r.effective_to),
      status: r.status as LegalPolicy["status"],
      sourceUrl: String(r.source_url),
      checkedAt: String(r.checked_at),
      values: JSON.parse(String(r.values_json)),
    }));
  }
}
