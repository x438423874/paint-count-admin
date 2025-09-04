export class ApiKeyValidationEvent {
  constructor(
    public readonly apiKey: string,
    public readonly validateOptions: {
      algorithm?: string;
      algorithmVersion?: string;
      apiVersion?: string;
      timestamp?: string;
      nonce?: string;
      signature?: string;
      requestParams?: Record<string, any>;
    },
    public readonly isValid: boolean,
  ) {}
}
