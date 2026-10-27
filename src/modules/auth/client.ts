export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(errorText(code));
  }
}
export function errorText(code: string): string {
  const texts: Record<string, string> = {
    LOGIN_REQUIRED: "다시 로그인해 주세요.",
    LOGIN_FAILED: "아이디 또는 비밀번호를 확인해 주세요.",
    AUTH_PASSWORD_RUNTIME_UNSUPPORTED:
      "서버 실행 환경에서 현재 비밀번호 검증 방식을 지원하지 않습니다. 계정이나 비밀번호를 다시 등록하지 마세요. 서버 수정이 필요합니다.",
    AUTH_NOT_READY: "서버의 로그인 설정을 확인해야 합니다. 계정 등록을 반복하지 마세요.",
    CLIENT_UPDATE_REQUIRED: "로그인 기능이 업데이트됐습니다. 앱을 완전히 닫았다가 다시 열어 주세요.",
    AUTH_PASSWORD_RECORD_INVALID: "서버의 비밀번호 등록 상태 확인이 필요합니다. 계정 파일을 다시 실행하지 마세요.",
    AUTH_PASSWORD_UPGRADE_REQUIRED: "로그인 준비가 갱신됐습니다. 로그인 버튼을 다시 눌러 주세요.",
    PRIVATE_SERVICE_UNAVAILABLE:
      "서버에서 로그인·자료 요청을 처리하지 못했습니다. 계정 등록이나 비밀번호 변경을 반복하지 마세요. 오류 코드: PRIVATE_SERVICE_UNAVAILABLE",
    TRY_LATER: "시도가 많습니다. 15분 후 다시 시도해 주세요.",
    PASSWORD_INVALID:
      "새 비밀번호는 15~128자이며 기존 비밀번호와 달라야 합니다.",
    PASSWORD_INCORRECT: "현재 비밀번호를 확인해 주세요.",
    PASSWORD_CHANGE_REQUIRED: "임시 비밀번호를 먼저 변경해 주세요.",
    REVISION_CONFLICT:
      "다른 기기에서 먼저 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.",
    CASE_ACCESS_DENIED: "신이본 계정에서 관리자 열람 동의를 설정해야 합니다.",
    CASE_NOT_PROVISIONED: "계정·산재 자료 공간 초기 설정이 필요합니다.",
    DRIVE_NOT_CONFIGURED: "Google Drive 연결 설정이 아직 적용되지 않았습니다.",
    DRIVE_RECONNECT: "문서를 보관하는 Google 계정을 다시 연결해 주세요.",
    DRIVE_FOLDER_REQUIRED: "먼저 비공개 보관 폴더를 선택해 주세요.",
    PRIVATE_FOLDER_REQUIRED: "공유되지 않은 내 Drive 폴더를 선택해 주세요.",
    DRIVE_NOT_PRIVATE:
      "파일의 공유 권한이 바뀌었습니다. 비공개 상태를 확인해 주세요.",
    DRIVE_INTEGRITY_FAILED:
      "원본 확인이 일치하지 않습니다. 파일을 보존하고 다시 확인해 주세요.",
    DRIVE_REVISION_CHANGED:
      "Drive의 원본 버전이 변경됐습니다. 처음 보관한 원본을 복원하거나 새 문서로 등록해 주세요.",
    UPLOAD_RETRY:
      "다른 전송 상태가 확인됐습니다. 다시 시도하면 이어서 전송합니다.",
    POLICY_VERSION_CONFLICT:
      "같은 버전 이름의 다른 정책이 있습니다. 새 버전 이름으로 저장해 주세요.",
    INVALID_REFUND: "반환액이 연결한 입금의 남은 금액을 초과합니다.",
    NEGATIVE_DECISION_BALANCE:
      "정정 후 결정액이나 인정일수가 음수가 됩니다. 정정값을 확인해 주세요.",
    DRIVE_FILE_MISSING:
      "Drive에서 원본을 찾지 못했습니다. 원본을 복원한 뒤 다시 확인해 주세요.",
    OFFICIAL_SOURCE_REQUIRED:
      "기관 확정 상태에는 확인된 원본 문서를 연결해 주세요.",
    PAYMENT_SOURCE_REQUIRED: "지급 근거가 되는 원본 연결 기록을 선택해 주세요.",
    VERIFIED_DOCUMENT_REQUIRED: "보관 확인이 끝난 원본만 연결할 수 있습니다.",
    INVALID_ANALYSIS: "분석 결과의 형식과 내용을 확인해 주세요. 저장하지 않았어요.",
    INVALID_ANALYSIS_SOURCES: "분석할 파일과 메모를 다시 선택해 주세요.",
    ANALYSIS_SOURCES_CHANGED: "분석을 준비한 뒤 자료가 바뀌었어요. 최신 자료로 다시 요청해 주세요.",
    ANALYSIS_SOURCE_NOT_ALLOWED: "이번 요청에 선택하지 않은 원본이 포함되어 있어요. 연결 자료를 확인해 주세요.",
    ANALYSIS_RECEIPT_INVALID: "답변을 받을 연결 정보가 맞지 않아요. 앱에서 새 연결을 만들어 주세요.",
    ANALYSIS_RECEIPT_EXPIRED: "답변을 받을 시간이 지났거나 연결이 취소됐어요. 새 연결을 만들어 주세요.",
    ANALYSIS_RECEIPT_REVOKED: "로그인 상태가 바뀌어 이 연결을 사용할 수 없어요. 다시 로그인해 새 연결을 만들어 주세요.",
    ANALYSIS_RECEIPT_NOT_FOUND: "이 계정에서 확인할 수 있는 분석 요청이 아니에요.",
    ANALYSIS_RECEIPT_ALREADY_USED: "이미 답변을 받은 연결이에요. 다른 답변은 새 연결로 보내 주세요.",
    ANALYSIS_RECEIPT_LIMIT: "기다리는 연결이 많아요. 사용하지 않는 연결을 취소한 뒤 다시 만들어 주세요.",
    ANALYSIS_RESULT_NOT_READY: "아직 검토할 답변이 도착하지 않았어요.",
    INVALID_ORGANIZATION: "정리할 파일과 보관 분야를 다시 확인해 주세요.",
    ORGANIZATION_ONE_FILE_PER_REQUEST: "한 번에 선택한 파일을 차례로 정리해요. 앱을 새로고침한 뒤 다시 시도해 주세요.",
    APPROVAL_REQUIRED: "내용을 확인한 뒤 저장 또는 정리 버튼을 눌러 주세요.",
    DOCUMENT_NOT_VERIFIED: "원본 보관 확인을 마친 뒤 폴더를 정리할 수 있어요.",
    DRIVE_ORGANIZATION_PENDING: "이 파일은 앞서 시작한 정리가 남아 있어요. 같은 분야로 다시 시도해 주세요.",
    DRIVE_ORGANIZATION_RETRY: "정리 결과를 확인하지 못했어요. 원본은 유지되니 같은 요청으로 다시 시도해 주세요.",
    DRIVE_ARCHIVE_BOUNDARY: "파일이나 폴더 위치가 바뀌었어요. 연결한 비공개 보관 폴더 안에 있는지 확인해 주세요.",
    DRIVE_CONCURRENT_CHECK_UNAVAILABLE: "Drive에서 원본의 최신 버전을 확인하지 못해 이동을 멈췄어요. 잠시 후 같은 요청으로 다시 확인해 주세요.",
    REQUEST_TOO_LARGE: "자료가 너무 길어요. 일부를 나눠서 저장해 주세요.",
    INVALID_FILE: "PDF·PNG·JPG·WebP 파일을 최대 20MB까지 선택할 수 있습니다.",
    FILE_TYPE_MISMATCH: "파일 내용과 확장자가 일치하지 않습니다.",
    WORKSPACE_ACCESS_REQUIRED: "기존 일정 자료의 접근 설정이 필요합니다.",
    WRITES_DISABLED: "현재 저장이 중지되어 있습니다.",
    ARCHIVE_FOLDER_LOCKED:
      "원본 보존을 위해 보관 폴더 변경은 별도 이전 절차가 필요합니다.",
  };
  return (
    texts[code] ??
    `처리하지 못했습니다 (${code}). 입력과 연결 상태를 확인해 주세요.`
  );
}
export async function privateRequest<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const value = await response
    .json()
    .catch(() => ({ error: "SERVICE_UNAVAILABLE" }));
  if (!response.ok) {
    if (value.error === "LOGIN_REQUIRED")
      window.dispatchEvent(new Event("cbh-auth-expired"));
    throw new ApiError(value.error ?? "SERVICE_UNAVAILABLE", response.status);
  }
  return value as T;
}
