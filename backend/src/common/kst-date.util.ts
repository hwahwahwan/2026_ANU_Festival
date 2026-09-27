/**
 * Asia/Seoul(KST) 기준 날짜 처리 유틸리티.
 *
 * Asia/Seoul은 연중 DST 없이 UTC+9 고정 오프셋을 사용하므로, 별도 timezone
 * 라이브러리(luxon/date-fns-tz 등, 현재 package.json에 없음) 없이도 Node 내장
 * Intl API와 고정 오프셋 문자열 파싱만으로 정확한 KST 날짜/경계를 계산할 수 있다.
 *
 * Sales 도메인(`payment_confirmed_at` + Asia/Seoul 집계)과 공통 환경변수 검증
 * (`config/env.validation.ts`의 `FESTIVAL_START_AT`/`FESTIVAL_END_AT`, KST 달력
 * 날짜 형식) 양쪽에서 같은 규칙을 써야 하므로 `common/`에 둔다.
 */
const KST_TIME_ZONE = 'Asia/Seoul';
const KST_FIXED_OFFSET = '+09:00';
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` 형식만 허용한다(값이 실제로 존재하는 달력 날짜인지는 별도 검사). */
export const KST_DATE_STRING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// en-CA locale은 날짜만 포맷할 때 'YYYY-MM-DD' 형식을 사용한다.
const kstDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: KST_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export interface DateRange {
  from: Date;
  to: Date;
}

/** 주어진 시각을 Asia/Seoul 기준 캘린더 날짜 문자열(YYYY-MM-DD)로 변환한다. */
export function toKstDateString(instant: Date): string {
  return kstDateFormatter.format(instant);
}

/**
 * Asia/Seoul 기준 캘린더 날짜(YYYY-MM-DD)를 그 날의 `[from, to)` UTC 시각
 * 범위로 변환한다(03_API명세서.md/003_백엔드2_운영실시간.md §23의 `[from, to)`
 * 규칙). `dateString`은 `isValidKstDateString()`을 통과한 값이어야 한다 — 이
 * 함수는 형식을 다시 검증하지 않는다(호출부에서 이미 검증했다고 가정).
 */
export function kstDateStringToRange(dateString: string): DateRange {
  const from = new Date(`${dateString}T00:00:00${KST_FIXED_OFFSET}`);
  return { from, to: new Date(from.getTime() + MS_PER_DAY) };
}

/**
 * `value`가 `YYYY-MM-DD` 형식이면서 실제로 존재하는 KST 달력 날짜인지
 * 검증한다. 정규식만으로는 `2026-02-30`처럼 존재하지 않는 날짜를 걸러내지
 * 못하므로, 한 번 변환한 뒤 같은 문자열로 되돌아오는지 다시 확인한다(JS
 * `Date`는 존재하지 않는 날짜를 다음 달로 자동 이월시키기 때문).
 */
export function isValidKstDateString(value: string): boolean {
  if (!KST_DATE_STRING_PATTERN.test(value)) {
    return false;
  }

  const { from } = kstDateStringToRange(value);
  return !Number.isNaN(from.getTime()) && toKstDateString(from) === value;
}
