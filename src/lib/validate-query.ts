import type { NextResponse } from "next/server";
import { z } from "zod";

import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "./config";
import { badRequest, type ErrorBody } from "./response";

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse<ErrorBody> };

const UNSET = new Set<unknown>([undefined, null, ""]);

const optionalize = (value: unknown) => (UNSET.has(value) ? undefined : value);

function intFromQuery(options: {
  label: string;
  min: number;
  max?: number;
  fallback: number;
}) {
  const { label, min, max, fallback } = options;

  let schema = z.coerce
    .number({ error: `${label} must be a number` })
    .int(`${label} must be an integer`)
    .min(min, `${label} must be greater than or equal to ${min}`);

  if (max !== undefined) {
    schema = schema.max(max, `${label} must be less than or equal to ${max}`);
  }

  return z.preprocess(optionalize, schema.default(fallback));
}

function floatFromQuery(options: { label: string; min?: number; max?: number }) {
  const { label, min, max } = options;

  let schema = z.coerce.number({ error: `${label} must be a number` });

  if (min !== undefined) {
    schema = schema.min(min, `${label} must be greater than or equal to ${min}`);
  }
  if (max !== undefined) {
    schema = schema.max(max, `${label} must be less than or equal to ${max}`);
  }

  return z.preprocess(optionalize, schema.optional());
}

function booleanFromQuery(label: string) {
  return z.preprocess((value: unknown) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== "string") {
      return value;
    }

    const normalized = value.trim().toLowerCase();

    if (normalized === "") {
      return undefined;
    }
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }

    return value;
  }, z.boolean({ error: `${label} must be either true or false` }).optional());
}

function stringFromQuery(label: string) {
  return z.preprocess(
    optionalize,
    z
      .string({ error: `${label} must be a string` })
      .min(1, `${label} must not be empty`)
      .optional(),
  );
}

function nonNegativeIntFromQuery(label: string) {
  return z.preprocess(
    optionalize,
    z.coerce
      .number({ error: `${label} must be a number` })
      .int(`${label} must be an integer`)
      .min(0, `${label} must be greater than or equal to 0`)
      .optional(),
  );
}

/** Filter primitives shared by the list route schemas. */
export const queryFilters = {
  string: stringFromQuery,
  int: nonNegativeIntFromQuery,
  float: floatFromQuery,
  boolean: booleanFromQuery,
} as const;

/**
 * Builds the Zod schema for a paginated list endpoint. Every list route shares
 * the same limit/offset/sort/order contract and only adds its own filters.
 */
export function listQuerySchema<TFilters extends z.ZodRawShape>(
  sortable: readonly [string, ...string[]],
  options: { defaultSort?: string; filters?: TFilters } = {},
) {
  const { defaultSort = "createdAt", filters } = options;
  const allowed = sortable as unknown as [string, ...string[]];
  const sortEnum = z.enum(allowed, {
    error: `sort must be one of: ${sortable.join(", ")}`,
  });

  return z.object({
    limit: intFromQuery({
      label: "limit",
      min: 1,
      max: MAX_PAGE_LIMIT,
      fallback: DEFAULT_PAGE_LIMIT,
    }),
    offset: intFromQuery({ label: "offset", min: 0, fallback: 0 }),
    sort: sortEnum.default(defaultSort as z.infer<typeof sortEnum>),
    order: z
      .enum(["asc", "desc"], { error: 'order must be either "asc" or "desc"' })
      .default("desc"),
    ...(filters ?? ({} as TFilters)),
  });
}

function collectQueryParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  new URL(url).searchParams.forEach((value, key) => {
    if (!(key in params)) {
      params[key] = value;
    }
  });

  return params;
}

function formatIssues(error: z.ZodError, subject: string, fallbackField: string): string {
  const details = error.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join(".") : fallbackField;
    return `${field}: ${issue.message}`;
  });

  return `${subject} ${details.join("; ")}`;
}

export function validateQuery<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): ValidationResult<z.infer<TSchema>> {
  const result = schema.safeParse(collectQueryParams(request.url));

  if (!result.success) {
    return {
      ok: false,
      response: badRequest(
        formatIssues(result.error, "Invalid query parameters.", "request"),
      ),
    };
  }

  return { ok: true, data: result.data };
}

export async function validateJsonBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<ValidationResult<z.infer<TSchema>>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false, response: badRequest("Request body must be valid JSON.") };
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    return {
      ok: false,
      response: badRequest(formatIssues(result.error, "Invalid request body.", "body")),
    };
  }

  return { ok: true, data: result.data };
}
