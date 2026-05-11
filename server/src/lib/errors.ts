export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (msg = "not found") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
export const serverError = (msg: string, details?: unknown) => new HttpError(500, msg, details);
