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

// A dependency (database, sign-in service, model provider) failed. The detail
// is logged; the caller gets a plain "try again" with status 503.
export class UpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export const unauthenticated = () =>
  new HttpError(401, 'unauthenticated', 'Your session has ended. Please refresh the page or sign in again.');
export const forbidden = (msg = 'You are not allowed to do that.') => new HttpError(403, 'forbidden', msg);
export const notFound = () => new HttpError(404, 'not_found', 'Not found.');
