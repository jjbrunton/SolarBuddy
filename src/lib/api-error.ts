import { NextResponse } from 'next/server';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string) {
    return new ApiError(message, 400);
  }

  static notFound(message: string) {
    return new ApiError(message, 404);
  }

  static serviceUnavailable(message: string) {
    return new ApiError(message, 503);
  }
}

export function errorResponse(err: unknown, fallbackStatus = 500): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: err.statusCode },
    );
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  return NextResponse.json({ ok: false, error: message }, { status: fallbackStatus });
}
