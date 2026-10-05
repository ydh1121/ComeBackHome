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

export function transformImageLayout(layout, {
  scaleX = 1,
  scaleY = 1,
  offsetX = 0,
  offsetY = 0,
} = {}) {
  return {
    width: layout.width * scaleX + Math.max(0, offsetX),
    height: layout.height * scaleY + Math.max(0, offsetY),
    tokens: layout.tokens.map((item) => ({
      ...item,
      x: item.x * scaleX + offsetX,
      y: item.y * scaleY + offsetY,
      width: item.width * scaleX,
      height: item.height * scaleY,
    })),
  };
}

export function buildScheduleImageLayoutFixture({ targetRow = 3 } = {}) {
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

  tokens.push(centeredToken('대체공휴일', dayCenter(0), 67, 86, 18, 0.99));
  tokens.push(centeredToken('실습11/17.5', dayCenter(1), 67, 100, 18, 0.99));
  tokens.push(centeredToken('스케줄확정', dayCenter(5), 67, 90, 18, 0.99));

  const basePeople = ['직원A', '직원B', '직원C', '직원D', '직원E', '직원F'];
  const people = [...basePeople];
  people[targetRow] = '테스트직원';

  people.forEach((name, row) => {
    tokens.push(centeredToken(name, 43, rowCenter(row), 62, 18, row === targetRow ? 0.97 : 0.95));
  });

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

  [
    { row: 0, day: 0, values: ['14', '23.5', '1'] },
    { row: 1, day: 1, values: ['9', '14', ''] },
    { row: 2, day: 2, values: ['9.5', '21', '1'] },
    { row: 4, day: 4, values: ['9', '21.5', '1'] },
    { row: 5, day: 5, values: ['12', '23.5', '1'] },
  ].filter((item) => item.row !== targetRow).forEach(({ row, day, values }) => {
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

export function buildRowOrientedScheduleLayoutFixture() {
  const width = 1000;
  const height = 360;
  const tokens = [];

  // Deliberately nonstandard column order: date | end | person | start.
  const columns = {
    date: 120,
    end: 350,
    person: 610,
    start: 860,
  };

  tokens.push(centeredToken('근무표 안내 2026', 500, 28, 170, 20, 0.97));
  tokens.push(centeredToken('날짜', columns.date, 80, 60, 20));
  tokens.push(centeredToken('퇴근', columns.end, 80, 60, 20));
  tokens.push(centeredToken('성명', columns.person, 80, 60, 20));
  tokens.push(centeredToken('출근', columns.start, 80, 60, 20));

  const rows = [
    ['2026-09-01', '23.5', '직원A', '11'],
    ['2026-09-02', '20', '테스트직원', '10.5'],
    ['2026-09-03', '21.5', '직원B', '9'],
  ];

  rows.forEach((values, index) => {
    const cy = 135 + index * 62;
    tokens.push(centeredToken(values[0], columns.date, cy, 110, 20, 0.96));
    tokens.push(centeredToken(values[1], columns.end, cy, 55, 20, 0.96));
    tokens.push(centeredToken(values[2], columns.person, cy, 100, 20, 0.97));
    tokens.push(centeredToken(values[3], columns.start, cy, 55, 20, 0.96));
  });

  return { width, height, tokens };
}


export function buildSparseCalendarDateScheduleLayoutFixture({ targetRow = 3 } = {}) {
  const base = buildScheduleImageLayoutFixture({ targetRow });
  const keptDates = new Set([
    '2026-08-17',
    '2026-08-18',
    '2026-08-21',
  ]);

  const tokens = base.tokens.filter((item) => {
    if (/^2026-08-\d{2}$/.test(item.text)) {
      return keptDates.has(item.text);
    }
    if (item.text === '직원A') return false;
    return true;
  });

  const weekdays = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ];

  weekdays.forEach((label, day) => {
    tokens.push(centeredToken(label, dayCenter(day), 16, 82, 18, 0.95));
  });

  // Compact date evidence is valid calendar evidence even when punctuation OCR is lost.
  tokens.push(centeredToken('20260822', dayCenter(5), 40, 94, 18, 0.9));

  // Keep the first row as a geometric row anchor while making its identity unsafe.
  tokens.push(centeredToken('a', 25, rowCenter(0), 12, 12, 0.51));
  tokens.push(centeredToken('ACH', 55, rowCenter(0), 36, 14, 0.85));

  return {
    ...base,
    tokens,
  };
}
