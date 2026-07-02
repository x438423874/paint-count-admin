import { FastifyRequest } from 'fastify';

export interface AuthenticatedRequest extends FastifyRequest {
  user: {
    uid: string;
    username: string;
    domain: string;
  };
}
