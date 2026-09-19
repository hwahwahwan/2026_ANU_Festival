import { IsBoolean, IsInt, Min, ValidateIf } from 'class-validator';

export class UpdateMenuDto {
  /**
   * @IsOptional() 대신 ValidateIf를 쓴다 — @IsOptional()은 값이 null일 때도
   * @IsInt()/@IsBoolean() 검증을 건너뛰어 { "price": null } 같은 요청이
   * 아무것도 바뀌지 않은 채 200으로 통과해버린다. 필드가 없을 때(undefined)만
   * 건너뛰고, null을 포함한 다른 값은 그대로 검증에 걸려 400이 되게 한다.
   */
  @ValidateIf((dto) => dto.price !== undefined)
  @IsInt()
  @Min(0)
  price?: number;

  @ValidateIf((dto) => dto.isAvailable !== undefined)
  @IsBoolean()
  isAvailable?: boolean;
}
