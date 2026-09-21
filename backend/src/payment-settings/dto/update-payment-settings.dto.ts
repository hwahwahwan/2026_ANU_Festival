import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * 문자열이면 앞뒤 공백을 제거하고, 아니면 그대로 둔다(타입 검증은 뒤이은
 * @IsString이 담당한다). ValidationPipe의 transform:true 덕분에 이 결과가
 * Controller/Service에 그대로 전달되므로, trim 결과가 곧 저장되는 값이다 —
 * 공백만 있는 값("   ")은 trim 후 빈 문자열이 되어 @IsNotEmpty에 걸린다.
 */
function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdatePaymentSettingsDto {
  @Transform(({ value }) => trimIfString(value))
  @IsString()
  @IsNotEmpty()
  bankName!: string;

  /**
   * 계좌번호는 문자열이다(앞자리 0 보존 목적, 001_백엔드_공통.md §14
   * PaymentSettingsView). 숫자 타입으로 변환하지 않는다.
   */
  @Transform(({ value }) => trimIfString(value))
  @IsString()
  @IsNotEmpty()
  accountNumber!: string;

  @Transform(({ value }) => trimIfString(value))
  @IsString()
  @IsNotEmpty()
  accountHolder!: string;
}
