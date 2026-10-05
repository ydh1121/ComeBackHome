const WIDTH = 1735;
const HEIGHT = 270;
const NAME_COLUMN_RIGHT = 87;
const DAY_WIDTH = (WIDTH - NAME_COLUMN_RIGHT) / 7;

function token(text, x, y, width, height, confidence = 0.98) {
  return { text, x, y, width, height, confidence };
}

function centeredToken(text, cx, cy, width, height, confidence = 0.98) {
  return token(text, cx - width / 2, cy - height / 2, width, height, confidence);
}

function dayCenter(index) {
  return NAME_COLUMN_RIGHT + DAY_WIDTH * (index + 0.5);
}

function subCenter(dayIndex, subIndex) {
  const left = NAME_COLUMN_RIGHT + DAY_WIDTH * dayIndex;
  return left + DAY_WIDTH * ((subIndex + 0.5) / 3);
}

function rowCenter(index) {
  return 121.5 + index * 27;
}

export function buildScheduleImageLayoutFixture() {
  const tokens = [];
  const dates = [
    '2026-08-17',
    '2026-08-18',
    '2026-08-19',
    '2026-08-20',
    '2026-08-21',
    '2026-08-22',
    '2026-08-23',
  ];

  for (let day = 0; day < 7; day += 1) {
    tokens.push(centeredToken(dates[day], dayCenter(day), 40, 102, 18));
    tokens.push(centeredToken('출근', subCenter(day, 0), 94, 38, 18));
    tokens.push(centeredToken('퇴근', subCenter(day, 1), 94, 38, 18));
    tokens.push(centeredToken('쉬는시간', subCenter(day, 2), 94, 58, 18));
  }

  // Real source format may contain red notes between date and column labels.
  // These are intentionally synthetic and must never become schedule data.
  tokens.push(centeredToken('대체공휴일', dayCenter(0), 67, 86, 18, 0.99));
  tokens.push(centeredToken('실습11/17.5', dayCenter(1), 67, 100, 18, 0.99));
  tokens.push(centeredToken('스케줄확정', dayCenter(5), 67, 90, 18, 0.99));

  const people = ['직원A', '직원B', '직원C', '테스트직원', '직원D', '직원E'];
  people.forEach((name, row) => {
    tokens.push(centeredToken(name, 43, rowCenter(row), 62, 18, row === 3 ? 0.97 : 0.95));
  });

  // Target synthetic row mirrors the observed table semantics:
  // blank/off, 12-23.5, blank/off, 12-23.5, 11-23.5, 10.5-20.5, 10.5-20.
  const targetRow = 3;
  const target = [
    null,
    ['12', '23.5', '1'],
    null,
    ['12', '23.5', '1'],
    ['11', '23.5', '1'],
    ['10.5', '20.5', '1'],
    ['10.5', '20', '1'],
  ];

  target.forEach((values, day) => {
    if (!values) return;
    values.forEach((value, sub) => {
      tokens.push(centeredToken(value, subCenter(day, sub), rowCenter(targetRow), 42, 18, 0.96));
    });
  });

  // Additional non-target rows keep the fixture multi-person and ensure row isolation.
  [
    { row: 0, day: 0, values: ['14', '23.5', '1'] },
    { row: 1, day: 1, values: ['9', '14', ''] },
    { row: 2, day: 2, values: ['9.5', '21', '1'] },
    { row: 4, day: 4, values: ['9', '21.5', '1'] },
    { row: 5, day: 5, values: ['12', '23.5', '1'] },
  ].forEach(({ row, day, values }) => {
    values.forEach((value, sub) => {
      if (!value) return;
      tokens.push(centeredToken(value, subCenter(day, sub), rowCenter(row), 42, 18, 0.94));
    });
  });

  return {
    width: WIDTH,
    height: HEIGHT,
    tokens,
  };
}
