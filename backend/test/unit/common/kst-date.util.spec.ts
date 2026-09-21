import {
  isValidKstDateString,
  kstDateStringToRange,
  toKstDateString,
} from '../../../src/common/kst-date.util';

describe('toKstDateString', () => {
  it('KST 자정 직전 UTC 시각은 전날 날짜로 변환된다', () => {
    // 2026-09-17T23:59:59+09:00 == 2026-09-17T14:59:59.000Z
    expect(toKstDateString(new Date('2026-09-17T14:59:59.000Z'))).toBe(
      '2026-09-17',
    );
  });

  it('KST 자정 UTC 시각은 다음날 날짜로 변환된다', () => {
    // 2026-09-18T00:00:00+09:00 == 2026-09-17T15:00:00.000Z
    expect(toKstDateString(new Date('2026-09-17T15:00:00.000Z'))).toBe(
      '2026-09-18',
    );
  });

  it('연/월/일이 모두 두 자리로 패딩된다', () => {
    expect(toKstDateString(new Date('2026-01-05T01:00:00.000Z'))).toBe(
      '2026-01-05',
    );
  });
});

describe('kstDateStringToRange', () => {
  it('KST 자정을 정확한 UTC 시각으로 변환하고 [from, to)가 정확히 24시간이다', () => {
    const range = kstDateStringToRange('2026-09-18');

    expect(range.from.toISOString()).toBe('2026-09-17T15:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-18T15:00:00.000Z');
    expect(range.to.getTime() - range.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('toKstDateString과 kstDateStringToRange를 합성하면 원래 시각이 그 범위 안에 포함된다', () => {
    const instant = new Date('2026-09-18T10:00:00.000Z');
    const range = kstDateStringToRange(toKstDateString(instant));

    expect(instant.getTime()).toBeGreaterThanOrEqual(range.from.getTime());
    expect(instant.getTime()).toBeLessThan(range.to.getTime());
  });
});

describe('isValidKstDateString', () => {
  it.each([
    ['2026-09-20'],
    ['2026-01-01'],
    ['2026-12-31'],
    ['2024-02-29'], // 2024년은 윤년이라 2/29가 실제로 존재한다.
  ])('%s처럼 실제로 존재하는 YYYY-MM-DD 날짜는 유효하다', (value) => {
    expect(isValidKstDateString(value)).toBe(true);
  });

  it.each([
    ['2026-9-20', '월/일이 한 자리'],
    ['2026/09/20', '구분자가 다름'],
    ['20260920', '구분자 없음'],
    ['2026-09-20T00:00:00+09:00', '전체 타임스탬프'],
    ['not-a-date', '날짜가 아닌 문자열'],
    ['', '빈 문자열'],
    ['2026-02-30', '2월에 존재하지 않는 30일'],
    ['2026-13-01', '13월은 없음'],
    ['2025-02-29', '2025년은 윤년이 아니라 2/29가 없음'],
  ])('%s(%s)는 유효하지 않다', (value) => {
    expect(isValidKstDateString(value)).toBe(false);
  });
});
