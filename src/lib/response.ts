import { NextResponse } from "next/server";

export type SuccessMeta = Record<string, unknown>;

export type ErrorBody = {
  error: {
    code: string;
    message: string;
  };
};

export const GENERIC_INTERNAL_ERROR_MESSAGE =
  "An unexpected error occurred. Please try again later.";

export function success<T>(
  data: T,
  meta?: SuccessMeta,
  status = 200,
): NextResponse {
  return NextResponse.json(meta === undefined ? { data } : { data, meta }, { status });
}

export function created<T>(data: T, meta?: SuccessMeta): NextResponse {
  return success(data, meta, 201);
}

export function error(
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit,
): NextResponse<ErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

export function badRequest(message: string): NextResponse<ErrorBody> {
  return error("BAD_REQUEST", message, 400);
}

export function notFound(message: string): NextResponse<ErrorBody> {
  return error("NOT_FOUND", message, 404);
}

export function unprocessable(message: string): NextResponse<ErrorBody> {
  return error("UNPROCESSABLE_ENTITY", message, 422);
}

export function tooManyRequests(
  message: string,
  retryAfterSeconds: number,
): NextResponse<ErrorBody> {
  return error("RATE_LIMIT_EXCEEDED", message, 429, {
    "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
}

/**
 * Logs the real error server side and returns a generic 500 so that internal
 * details (messages, stack traces, SQL) never reach the client.
 */
export function internalError(context: string, cause: unknown): NextResponse<ErrorBody> {
  console.error(`[api] ${context}`, cause);
  return error("INTERNAL_SERVER_ERROR", GENERIC_INTERNAL_ERROR_MESSAGE, 500);
}
