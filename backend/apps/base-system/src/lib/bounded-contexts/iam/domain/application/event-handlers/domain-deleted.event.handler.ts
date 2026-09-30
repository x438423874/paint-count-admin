import { Logger } from '@nestjs/common';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';


import { DomainDeletedEvent } from '../../domain/events/domain-deleted.event';

@EventsHandler(DomainDeletedEvent)
export class DomainDeletedHandler implements IEventHandler<DomainDeletedEvent> {

  async handle(event: DomainDeletedEvent) {
    Logger.log(
      `Domain deleted, Event is ${JSON.stringify(event)}`,
      '[domain] DomainDeletedHandler',
    );
  }
}
