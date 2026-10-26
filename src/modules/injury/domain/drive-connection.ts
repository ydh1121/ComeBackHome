export function driveConnectionNotice(result: string | null): string {
  const messages: Record<string, string> = {
    connected: "Google 동의 절차에서 돌아왔습니다. 아래 연결 상태를 확인하고 보관 폴더를 선택해 주세요.",
    cancelled: "Google Drive 연결을 취소했습니다. 필요할 때 다시 연결할 수 있습니다.",
    expired: "이전 연결 요청이 만료됐거나 이미 처리됐습니다. 아래 연결 상태를 확인하고, 연결되지 않았다면 Google Drive 연결을 다시 눌러 주세요. 키를 다시 등록할 필요는 없습니다.",
    "session-ended": "연결 도중 앱 로그인 상태가 바뀌었습니다. 신이본 계정으로 로그인한 뒤 Google Drive 연결을 다시 시작해 주세요.",
    "owner-only": "Google Drive 연결은 산재 소유자인 신이본 계정(yvonne)에서 진행해 주세요.",
    "account-changed": "기존에 연결한 Google 계정과 다릅니다. 원본 보관에 사용하던 Google 계정으로 다시 연결해 주세요.",
    "not-configured": "서버의 Google Drive 설정을 확인해야 합니다. 이미 등록한 키를 다시 만들지는 마세요.",
    "provider-unavailable": "Google과 연결하는 도중 응답을 받지 못했습니다. 아래 연결 상태를 확인하고 잠시 후 다시 연결해 주세요. 계속되면 관리자에게 알려 주세요.",
    "response-unavailable": "Google의 연결 응답을 읽지 못했습니다. 연결 완료 여부를 확인한 뒤 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.",
    "storage-unavailable": "서버에서 연결 정보를 확인하거나 저장하는 중 문제가 생겼습니다. 아래 연결 상태를 확인해 주세요. 키를 다시 만들지 말고 관리자에게 알려 주세요.",
    "key-unavailable": "서버에서 보관용 인증정보를 열지 못했습니다. 키를 새로 만들거나 기존 키를 바꾸지 말고 관리자에게 알려 주세요.",
    "service-unavailable": "서버에서 Google Drive 연결을 처리하지 못했습니다. 연결 상태를 확인해 주세요. 계속되면 관리자에게 알려 주세요.",
    failed: "Google Drive 연결을 완료하지 못했습니다. Google Drive 연결을 다시 시작해 주세요. 계속 실패하면 이 문구만 전달해 주세요.",
  };
  return result && Object.hasOwn(messages, result) ? messages[result] : "";
}
