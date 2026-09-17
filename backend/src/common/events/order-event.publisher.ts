import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderEventMap } from '../contracts/order-events';

export interface OrderEventPublisher {
  publish<K extends keyof OrderEventMap>(
    name: K,
    payload: OrderEventMap[K],
  ): void;
}

export const ORDER_EVENT_PUBLISHER = Symbol('ORDER_EVENT_PUBLISHER');

@Injectable()
export class NestOrderEventPublisher implements OrderEventPublisher {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  publish<K extends keyof OrderEventMap>(
    name: K,
    payload: OrderEventMap[K],
  ): void {
    this.eventEmitter.emit(name, payload);
  }
}
