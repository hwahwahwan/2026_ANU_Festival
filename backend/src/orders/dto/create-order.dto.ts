import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from './create-order-item.dto';

const PHONE_REGEX = /^01[016789]-?\d{3,4}-?\d{4}$/;

export class CreateOrderDto {
  @IsUUID()
  orderRequestId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  customerName!: string;

  @IsString()
  @Matches(PHONE_REGEX, {
    message: '휴대폰 번호 형식이 올바르지 않습니다.',
  })
  customerPhone!: string;

  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
