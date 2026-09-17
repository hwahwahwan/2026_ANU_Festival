import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import {
  NestOrderEventPublisher,
  ORDER_EVENT_PUBLISHER,
} from './order-event.publisher';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    {
      provide: ORDER_EVENT_PUBLISHER,
      useClass: NestOrderEventPublisher,
    },
  ],
  exports: [ORDER_EVENT_PUBLISHER],
})
export class DomainEventsModule {}
