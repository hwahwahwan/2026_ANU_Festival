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
import { NormalizeText } from '../../common/transforms/normalize-text.transform';
import { CUSTOMER_NAME_MAX_LENGTH } from '../constants/order-validation.constants';

const PHONE_REGEX = /^01[016789]-?\d{3,4}-?\d{4}$/;

export class CreateOrderDto {
  @IsUUID()
  orderRequestId!: string;

  @NormalizeText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
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
