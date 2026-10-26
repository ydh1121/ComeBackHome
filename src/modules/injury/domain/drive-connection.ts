export function driveConnectionNotice(result: string | null): string {
  const messages: Record<string, string> = {
    connected: "Google 동의 절차에서 돌아왔습니다. 아래 연결 상태를 확인하고 보관 폴더를 선택해 주세요.",
    cancelled: "Google Drive 연결을 취소했습니다. 필요할 때 다시 연결할 수 있습니다.",
    expired: "이전 연결 요청이 만료됐거나 이미 처리됐습니다. 아래 연결 상태를 확인하고, 연결되지 않았다면 Google Drive 연결을 다시 눌러 주세요. 키를 다시 등록할 필요는 없습니다.",
    "session-ended": "연결 도중 앱 로그인 상태가 바뀌었습니다. 신이본 계정으로 로그인한 뒤 Google Drive 연결을 다시 시작해 주세요.",
    "owner-only": "Google Drive 연결은 산재 소유자인 신이본 계정(yvonne)에서 진행해 주세요.",
    "account-changed": "기존에 연결한 Google 계정과 다릅니다. 원본 보관에 사용하던 Google 계정으로 다시 연결해 주세요.",
    "not-configured": "서버의 Google Drive 설정을 확인해야 합니다. 이미 등록한 키를 다시 만들지는 마세요.",
    failed: "Google Drive 연결을 완료하지 못했습니다. Google Drive 연결을 다시 시작해 주세요. 계속 실패하면 이 문구만 전달해 주세요.",
  };
  return result && Object.hasOwn(messages, result) ? messages[result] : "";
}
