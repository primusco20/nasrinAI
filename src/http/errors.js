// An error that is safe to show to the caller. Anything else becomes a
// generic 500 and its details stay in the server log.

export class HttpError extends Error {
  constructor(status, code, publicMessage, extra = {}) {
    super(publicMessage);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    this.extra = extra;
  }
}

export const unauthenticated = () =>
  new HttpError(401, 'unauthenticated', 'Sign in, start a guest session, or use a valid key.');
export const forbidden = (msg = 'You are not allowed to do that.') => new HttpError(403, 'forbidden', msg);
export const notFound = () => new HttpError(404, 'not_found', 'Not found.');
