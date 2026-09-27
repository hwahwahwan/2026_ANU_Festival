import { Transform } from 'class-transformer';

/**
 * 앞뒤 공백을 제거하고 유니코드를 NFC로 정규화한다.
 * iOS 등에서 한글이 자모 분리(NFD)로 입력되어도 저장/조회 양쪽에서
 * 동일한 바이트로 비교되도록 생성 DTO와 조회 DTO에 동일하게 적용해야 한다.
 */
export function NormalizeText(): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  );
}
