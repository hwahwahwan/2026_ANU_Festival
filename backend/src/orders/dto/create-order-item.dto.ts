import { Transform } from 'class-transformer';
import { IsInt, IsUUID, Min } from 'class-validator';

export class CreateOrderItemDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsUUID()
  menuId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}
