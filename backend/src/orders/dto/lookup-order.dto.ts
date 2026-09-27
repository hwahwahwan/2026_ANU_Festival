import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { NormalizeText } from '../../common/transforms/normalize-text.transform';
import {
  CUSTOMER_NAME_MAX_LENGTH,
  ORDER_NUMBER_MAX_LENGTH,
  ORDER_NUMBER_REGEX,
} from '../constants/order-validation.constants';

export class LookupOrderDto {
  @NormalizeText()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  customerName!: string;

  @IsString()
  @MaxLength(ORDER_NUMBER_MAX_LENGTH)
  @Matches(ORDER_NUMBER_REGEX, {
    message: '주문번호 형식이 올바르지 않습니다.',
  })
  orderNumber!: string;
}
