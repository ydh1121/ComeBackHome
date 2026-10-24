import {
  isRecordKind,
  validatePayload,
  type CasePayload,
  type RecordKind,
} from "./records";

export interface CaseSeed {
  version: "cbh-case-seed/v1";
  records: Array<{ kind: RecordKind; payload: CasePayload }>;
}

// Use the same record rules for the review screen and server. Approval is never
// taken from a file: only the separate save action may authorize the request.
export function reviewCaseSeed(value: unknown): CaseSeed {
  if (!value || typeof value !== "object") throw Error("INVALID_IMPORT");
  const candidate = value as { version?: unknown; records?: unknown };
  if (
    candidate.version !== "cbh-case-seed/v1" ||
    !Array.isArray(candidate.records) ||
    !candidate.records.length ||
    candidate.records.length > 80
  )
    throw Error("INVALID_IMPORT");
  return {
    version: "cbh-case-seed/v1",
    records: candidate.records.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") throw Error("INVALID_RECORD");
      const record = entry as { kind?: unknown; payload?: unknown };
      if (!isRecordKind(record.kind)) throw Error("INVALID_RECORD");
      return {
        kind: record.kind,
        payload: validatePayload(record.kind, record.payload),
      };
    }),
  };
}
