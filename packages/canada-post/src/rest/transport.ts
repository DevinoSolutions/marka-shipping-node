import type { CanadaPostDebugEvent } from "../config.js";
import {
  CanadaPostAccessDeniedError,
  CanadaPostApiError,
  CanadaPostIndeterminateError,
  CanadaPostNetworkError,
  CanadaPostParseError,
  CanadaPostTimeoutError,
  type CanadaPostRequestInfo,
} from "../errors.js";
import { redactHeaders } from "../http.js";
import { SDK_VERSION } from "../version.js";
import type { ResolvedRestConfig } from "./config.js";
import { parseErrorBody } from "./error-body.js";
import type { OAuthTokenProvider } from "./oauth.js";
import { retryAfterMs, safeUrl, sleep, type SecretRedactor } from "./redact.js";

/** One HTTP call, described independently of how it is executed. */
interface RestRequestSpec {
  /** SDK operation name, used in errors and debug events (e.g. `shipments.create`). */
  operation: string;
  method: "GET" | "POST" | "DELETE";
  url: string;
  accept: string;
  /** JSON-serialisable request body. */
  body?: unknown;
  /** Extra headers (e.g. `X-CPC-Zonos-Key`). Redacted in debug output. */
  headers?: Record<string, string>;
  /**
   * The call creates, charges or voids something. Mutating calls are NEVER retried, never
   * replayed after a 401, and surface timeouts / gateway errors as
   * {@link CanadaPostIndeterminateError}.
   */
  mutating?: boolean;
  /** Advice for the caller when a mutating call is indeterminate. */
  recovery?: string;
}

/** A successful HTTP exchange. */
export interface RestResult {
  status: number;
  contentType: string | undefined;
  requestId: string | undefined;
  /** Raw body bytes. */
  data: Uint8Array;
}

const REQUEST_ID_HEADERS = ["x-global-transaction-id", "x-request-id", "x-correlation-id"] as const;
const GATEWAY_STATUSES = new Set([502, 503, 504]);

interface RawResponse {
  status: number;
  contentType: string | undefined;
  requestId: string | undefined;
  retryAfter: number | undefined;
  data: Uint8Array;
}

/**
 * Bearer-token HTTP transport for the REST APIs. Reads are retried on 5xx/429 and replayed
 * once with a fresh token after a 401; writes are sent exactly once (ADR 0001).
 */
export class RestTransport {
  constructor(
    private readonly config: ResolvedRestConfig,
    private readonly tokens: OAuthTokenProvider,
    private readonly redactor: SecretRedactor,
  ) {}

  async execute(spec: RestRequestSpec): Promise<RestResult> {
    const { config } = this;
    const request: CanadaPostRequestInfo = {
      method: spec.method,
      url: safeUrl(spec.url),
      operation: spec.operation,
    };
    const mutating = spec.mutating === true;
    // Only idempotent reads are ever retried or replayed.
    const replayable = !mutating && spec.method === "GET";
    const maxAttempts = replayable ? config.retries + 1 : 1;
    let authReplayed = false;

    for (let attempt = 0; ; attempt += 1) {
      // A token failure happens before anything is sent, so it is definitive even for writes.
      const token = await this.tokens.getToken();
      const headers = this.buildHeaders(spec, token);
      this.debug("request", spec, headers, attempt);
      const raw = await this.send(spec, headers, request, mutating);
      this.debug("response", spec, headers, attempt, raw.status);

      if (raw.status === 401) {
        this.tokens.invalidate(token);
        if (replayable && !authReplayed) {
          authReplayed = true;
          attempt -= 1; // the replay with a fresh token is not a retry
          continue;
        }
      }
      if ((raw.status === 429 || raw.status >= 500) && replayable && attempt + 1 < maxAttempts) {
        const delay = Math.max(config.retryDelayMs * 2 ** attempt, raw.retryAfter ?? 0);
        this.debug("retry", spec, headers, attempt, raw.status, delay);
        if (delay > 0) await sleep(delay);
        continue;
      }
      return this.interpret(spec, request, raw, mutating);
    }
  }

  private buildHeaders(spec: RestRequestSpec, token: string): Record<string, string> {
    const { config } = this;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: spec.accept,
      "Accept-Language": config.language,
      "User-Agent": `marka-shipping-node/${SDK_VERSION}`,
    };
    if (config.platformId !== undefined) headers["platform-id"] = config.platformId;
    if (spec.body !== undefined) headers["Content-Type"] = "application/json";
    Object.assign(headers, spec.headers);
    return headers;
  }

  private debug(
    type: CanadaPostDebugEvent["type"],
    spec: RestRequestSpec,
    headers: Record<string, string>,
    attempt: number,
    status?: number,
    delayMs?: number,
  ): void {
    const hook = this.config.onDebug;
    if (hook === undefined) return;
    try {
      hook({
        type,
        operation: spec.operation,
        method: spec.method,
        url: safeUrl(spec.url),
        headers: redactHeaders(headers),
        attempt,
        ...(status === undefined ? {} : { status }),
        ...(delayMs === undefined ? {} : { delayMs }),
      });
    } catch {
      // A broken logger must never break an API call.
    }
  }

  private async send(
    spec: RestRequestSpec,
    headers: Record<string, string>,
    request: CanadaPostRequestInfo,
    mutating: boolean,
  ): Promise<RawResponse> {
    const { config } = this;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, config.timeoutMs);
    try {
      const init: RequestInit = { method: spec.method, headers, signal: controller.signal };
      if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
      const response = await config.fetch(spec.url, init);
      const data = new Uint8Array(await response.arrayBuffer());
      let requestId: string | undefined;
      for (const name of REQUEST_ID_HEADERS) {
        const v = response.headers.get(name);
        if (v !== null && v !== "") {
          requestId = v;
          break;
        }
      }
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? undefined,
        requestId,
        retryAfter: retryAfterMs(response.headers),
        data,
      };
    } catch (cause) {
      const timedOut = controller.signal.aborted;
      if (mutating) {
        throw new CanadaPostIndeterminateError({
          request,
          reason: timedOut ? "timeout" : "network",
          recovery: spec.recovery ?? "Look the object up before retrying.",
          cause: timedOut ? undefined : cause,
        });
      }
      if (timedOut) throw new CanadaPostTimeoutError(config.timeoutMs, request);
      throw new CanadaPostNetworkError(request, cause);
    } finally {
      clearTimeout(timer);
    }
  }

  private interpret(
    spec: RestRequestSpec,
    request: CanadaPostRequestInfo,
    raw: RawResponse,
    mutating: boolean,
  ): RestResult {
    if (mutating && GATEWAY_STATUSES.has(raw.status)) {
      throw new CanadaPostIndeterminateError({
        request,
        reason: "gateway",
        status: raw.status,
        recovery: spec.recovery ?? "Look the object up before retrying.",
      });
    }
    if (raw.status >= 200 && raw.status < 300) {
      return {
        status: raw.status,
        contentType: raw.contentType,
        requestId: raw.requestId,
        data: raw.data,
      };
    }

    const body = this.redactor.scrub(new TextDecoder("utf-8").decode(raw.data));
    const parsed = parseErrorBody(body);
    const init = {
      status: raw.status,
      messages: parsed.messages,
      request,
      requestId: raw.requestId,
      bodyExcerpt: body === "" ? undefined : body.slice(0, 500),
      title: parsed.title,
      detail: parsed.detail,
    };
    if (raw.status === 403) {
      throw new CanadaPostAccessDeniedError({ ...init, emptyBody: body.trim() === "" });
    }
    throw new CanadaPostApiError(init);
  }
}

/** Parses a successful JSON body. `mutating` only changes the wording of the failure. */
export function parseJsonBody(result: RestResult, operation: string, mutating = false): unknown {
  const text = new TextDecoder("utf-8").decode(result.data);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // No cause is attached: V8's JSON error message quotes a snippet of the body.
    throw new CanadaPostParseError(
      `${operation}: HTTP ${String(result.status)} but the body is not valid JSON` +
        (mutating
          ? ". The request WAS accepted: look the object up (customerRequestId) before retrying."
          : ""),
    );
  }
}
