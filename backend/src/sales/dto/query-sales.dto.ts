import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `MaxLength`는 기존 `LoginAdminDto`에는 없지만(과거에 추가되지 않았을 뿐,
 * 두 DTO 정책이 서로 다른 것은 아니다) 여기서는 추가한다 — 매 요청마다 argon2
 * 해시 검증을 하므로, 비정상적으로 긴 문자열을 비밀번호로 보내 해싱 비용을
 * 낭비시키는 것을 막기 위함이다. 128자는 실제 사람이 입력할 비밀번호보다
 * 충분히 넉넉한 값이다.
 */
export class QuerySalesDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
