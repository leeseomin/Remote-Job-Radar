export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isD1ConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint|unique/i.test(error.message);
}
