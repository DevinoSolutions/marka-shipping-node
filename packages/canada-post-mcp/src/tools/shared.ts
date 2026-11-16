/**
 * Building blocks of the pure tool layer: the tool context, the tool-definition and result
 * contracts, and the mapping of SDK errors to leak-safe payloads. Nothing in `tools/` imports
 * the MCP SDK (the same split as the Newegg MCP server, ADR 0005): handlers are plain async
 * functions, unit-testable without a client; `server.ts` adapts them to MCP.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CanadaPostAccessDeniedError,
  CanadaPostApiError,
  CanadaPostAuthError,
  CanadaPostConfigurationError,
  CanadaPostError,
  CanadaPostIndeterminateError,
  CanadaPostNetworkError,
  CanadaPostTestAppRequiredError,
  CanadaPostTimeoutError,
  CanadaPostValidationError,
  type CanadaPostRestClient,
  type RestLink,
} from "@joinmarka/canada-post";
import type { McpConfig } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
/** Structured JSON-lines logger. Implementations must write to stderr only. */
export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

/** Everything a tool handler needs at call time. The clock is injectable for tests. */
export interface ToolContext {
  readonly client: CanadaPostRestClient;
  readonly config: McpConfig;
  readonly previewStore: PreviewStore;
  readonly logger: Logger;
  readonly now: () => number;
}

interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Structured, leak-safe error payload returned as an `isError` tool result. */
export interface ToolErrorPayload {
  errorCode: string;
  message: string;
  httpStatus?: number;
  requestId?: string;
  retryable?: boolean;
  /** For an indeterminate write: how to find out whether it happened. */
  recovery?: string;
  [extra: string]: unknown;
}

export type ToolResult =
  | { readonly ok: true; readonly structuredContent: Record<string, unknown> }
  | { readonly ok: false; readonly error: ToolErrorPayload };

export function okResult(structuredContent: Record<string, unknown>): ToolResult {
  return { ok: true, structuredContent };
}

export function errorResult(error: ToolErrorPayload): ToolResult {
  return { ok: false, error };
}

/** A self-describing, MCP-agnostic tool definition. */
export interface ToolDefinition<InputSchema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  readonly inputSchema: InputSchema;
  readonly handler: (input: z.infer<InputSchema>, ctx: ToolContext) => Promise<ToolResult>;
}

/** The output of every tool is a JSON object; the exact shape is documented per tool. */
export const outputSchema = z.looseObject({});

/** Defines a tool with its input type inferred from the schema. */
export function defineTool<InputSchema extends z.ZodType>(
  definition: ToolDefinition<InputSchema>,
): ToolDefinition<InputSchema> {
  return definition;
}

/** Builds a business-rule (policy) error payload. */
export function businessError(errorCode: string, message: string): ToolErrorPayload {
  return { errorCode, message };
}

const TOKEN_LIKE = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

/** Removes anything credential-shaped from free text before it is logged or returned. */
export function scrubText(text: string, config?: McpConfig): string {
  let out = text
    .replace(TOKEN_LIKE, "Bearer [REDACTED]")
    .replace(/\?[^\s"')]*/g, "?[query removed]");
  if (config !== undefined) {
    for (const secret of [config.clientSecret, config.clientId, config.previewHmacKey]) {
      if (secret.length >= 6) out = out.split(secret).join("[REDACTED]");
    }
  }
  return out;
}

/**
 * Maps a thrown error to the structured payload. SDK errors carry redacted, secret-free
 * messages (a guarantee of `@joinmarka/canada-post`); anything else is reduced to a generic
 * "internal error" plus a correlation id, and its details go to stderr (scrubbed) only.
 */
export function mapErrorToPayload(error: unknown, ctx: ToolContext): ToolErrorPayload {
  const message = (e: Error): string => scrubText(e.message, ctx.config);
  if (error instanceof CanadaPostIndeterminateError) {
    return {
      errorCode: "indeterminate",
      message: message(error),
      reason: error.reason,
      recovery: error.recovery,
      ...(error.status === undefined ? {} : { httpStatus: error.status }),
    };
  }
  if (error instanceof CanadaPostAccessDeniedError) {
    return {
      errorCode: "access_denied",
      message: message(error),
      httpStatus: error.status,
      emptyBody: error.emptyBody,
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    };
  }
  if (error instanceof CanadaPostApiError) {
    return {
      errorCode: "api_error",
      message: message(error),
      httpStatus: error.status,
      retryable: error.isRetryable,
      codes: error.codes,
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
    };
  }
  if (error instanceof CanadaPostValidationError) {
    return { errorCode: "validation", message: message(error) };
  }
  if (error instanceof CanadaPostAuthError) {
    return {
      errorCode: "auth",
      message: message(error),
      retryable: error.transient,
      ...(error.status === undefined ? {} : { httpStatus: error.status }),
    };
  }
  if (error instanceof CanadaPostTestAppRequiredError) {
    return { errorCode: "test_app_required", message: message(error) };
  }
  if (error instanceof CanadaPostConfigurationError) {
    return { errorCode: "configuration", message: message(error) };
  }
  if (error instanceof CanadaPostTimeoutError || error instanceof CanadaPostNetworkError) {
    return { errorCode: "network", message: message(error), retryable: true };
  }
  if (error instanceof CanadaPostError) {
    return { errorCode: "sdk_error", message: message(error) };
  }
  const correlationId = randomUUID();
  ctx.logger("error", "unexpected_tool_error", {
    correlationId,
    message: scrubText(error instanceof Error ? error.message : String(error), ctx.config),
  });
  return { errorCode: "internal", message: "internal error", correlationId };
}

/** Runs a handler body, mapping any thrown error to an error result. */
export async function guarded(
  ctx: ToolContext,
  body: () => Promise<Record<string, unknown>>,
): Promise<ToolResult> {
  try {
    return okResult(await body());
  } catch (error) {
    return errorResult(mapErrorToPayload(error, ctx));
  }
}

const SENSITIVE_QUERY = /key|token|secret|sig|password|credential/i;

/** A link without the capability part: credential-like query values are replaced. */
export function linkView(link: RestLink): { rel: string; href: string; mediaType: string } {
  let href = link.href;
  try {
    const url = new URL(link.href);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    href = url.toString().replace(/%5BREDACTED%5D/g, "[REDACTED]");
  } catch {
    href = link.href.split("?")[0] ?? link.href;
  }
  return { rel: link.rel, href, mediaType: link.mediaType };
}

/** Links of a response, safe to return. */
export function linkViews(links: readonly RestLink[] | undefined): ReturnType<typeof linkView>[] {
  return (links ?? []).map(linkView);
}

/** A unique, short request id the SDK accepts (`customerRequestId`, max 35 characters). */
export function newRequestId(prefix: string, now: number): string {
  return `${prefix}-${now.toString(36)}-${randomUUID().replaceAll("-", "").slice(0, 8)}`.slice(
    0,
    35,
  );
}
