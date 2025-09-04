import { AccessKeyCreatedHandler } from './access_key-created.event.handler';
import { AccessKeyDeletedHandler } from './access_key-deleted.event.handler';
import { ApiKeyValidationEventHandler } from './access_key-validation.event.handler';

export const EventHandlers = [
  AccessKeyCreatedHandler,
  AccessKeyDeletedHandler,
  ApiKeyValidationEventHandler,
];
