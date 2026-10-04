import { unauthenticated } from '../http/errors.js';

// The gateway turns a request into a caller: { tenantId, actor: { type, id }, scopes }.
// Until the credential checks are added it recognises nobody, so every
// protected route is refused. This is deliberate: the server fails closed.
export function createClosedGateway() {
  return {
    async resolve() {
      throw unauthenticated();
    }
  };
}
