import type { CaseRecord } from "../domain/records";
import type { LegalPolicy } from "../domain/calculations";
import type { CaseDeadline } from "../domain/deadlines";
export interface DocumentInfo {
  id: string;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  status: string;
  created_at: string;
}
export interface PaymentInfo {
  id: string;
  claim_id: string;
  event_type: "decision" | "deposit" | "decision_adjustment" | "refund";
  amount: number;
  recognized_days: number;
  event_date: string;
  source_record_id: string;
  corrects_id: string | null;
  dedupe_key: string;
}
export interface CaseData {
  caseId: string;
  owner: boolean;
  records: CaseRecord[];
  policies: LegalPolicy[];
  documents: DocumentInfo[];
  payments: PaymentInfo[];
  deadlines: CaseDeadline[];
  overlaps: Array<{ left: string; right: string }>;
}
