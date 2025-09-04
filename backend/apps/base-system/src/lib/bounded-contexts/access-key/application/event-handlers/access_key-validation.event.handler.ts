import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { EVENT_API_KEY_VALIDATED } from '@lib/constants/event-emitter-token.constant';
import { ApiKeyValidationEvent } from '@lib/infra/guard/api-key/events/api-key-validation.event';

@Injectable()
export class ApiKeyValidationEventHandler {
  private readonly logger = new Logger(ApiKeyValidationEventHandler.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent(EVENT_API_KEY_VALIDATED)
  async handle(payload: ApiKeyValidationEvent) {
    //TODO
    this.logger.log(
      `Handling API key validation event, payload: ${JSON.stringify(payload)}`,
    );
  }
}
