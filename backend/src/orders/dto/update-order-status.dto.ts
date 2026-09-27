import { IsIn } from 'class-validator';

const PATCHABLE_STATUSES = ['COOKING', 'READY', 'COMPLETED'] as const;

export type PatchableOrderStatus = (typeof PATCHABLE_STATUSES)[number];

export class UpdateOrderStatusDto {
  @IsIn(PATCHABLE_STATUSES)
  status!: PatchableOrderStatus;
}
