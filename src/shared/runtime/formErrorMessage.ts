export function formErrorMessage(error: string | null): string | null {
  if (!error) return null;
  if (/DUPLICATE_PERSON_NAME|UNIQUE constraint failed: people.name/.test(error))
    return '같은 이름의 직원이 이미 있습니다. 기존 직원을 선택하거나 이름을 확인하세요.';
  if (/INVALID_PERSON_NAME|Person name is required/.test(error))
    return '직원 이름을 1~100자로 입력하세요.';
  if (/SELECTED_PERSON_CHANGED/.test(error))
    return '작업 중 선택한 직원이 바뀌었습니다. 현재 직원을 확인하고 다시 저장하세요.';
  if (/INVALID_SCHEDULE_DATE|Schedule range is invalid/.test(error))
    return '날짜 또는 기간이 올바르지 않습니다. 날짜를 확인하세요.';
  if (/INVALID_SCHEDULE_CLOCK|start and end/.test(error))
    return '출퇴근시간을 올바른 시각으로 입력하세요.';
  if (/INVALID_BREAK_MINUTES/.test(error))
    return '쉬는시간은 0~720분 사이의 정수로 입력하거나 비워 주세요.';
  if (/SCHEDULE_BULK_LIMIT|Schedule range is too large/.test(error))
    return '한 번에 입력할 수 있는 기간은 최대 366일입니다.';
  if (/DUPLICATE_SCHEDULE_DATE/.test(error))
    return '같은 직원과 날짜의 일정이 중복됐습니다.';
  if (/NO_SCHEDULE_DATES_MATCH/.test(error))
    return '선택한 기간에 적용할 요일이 없습니다.';
  if (/SAVE_ALREADY_IN_PROGRESS/.test(error))
    return '현재 저장이 진행 중입니다.';
  if (/fetch|network|HTTP|Unexpected API|failed|failure|outage|service unavailable|오류/i.test(error))
    return '저장하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요. 입력 내용은 유지됩니다.';
  return '저장하지 못했습니다: ' + error;
}
