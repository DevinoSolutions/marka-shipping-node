import type { ResolvedConfig } from "./config.js";
import {
  CanadaPostApiError,
  CanadaPostIndeterminateError,
  CanadaPostNetworkError,
  CanadaPostParseError,
  CanadaPostTimeoutError,
  type CanadaPostMessage,
  type CanadaPostRequestInfo,
} from "./errors.js";
import { SDK_VERSION } from "./version.js";
import { asArray, children, isNode, parseXml, str, type XmlNode } from "./xml/parse.js";

/** One HTTP call, described independently of how it is executed. */
interface RequestSpec {
  /** SDK operation name, used in errors and debug events (e.g. `shipments.create`). */
  operation: string;
  method: "GET" | "POST" | "DELETE";
  url: string;
  accept: string;
  contentType?: string;
  body?: string;
  /** Extra headers (e.g. `X-CPC-Zonos-Key`). Redacted in debug output. */
  headers?: Record<string, string>;
  /**
   * The call can create, charge, void or otherwise change state. Mutating calls are NEVER
   * retried and surface timeouts / gateway errors as {@link CanadaPostIndeterminateError}.
   */
  mutating?: boolean;
  /** Advice for the caller when a mutating call is indeterminate. */
  recovery?: string;
  /** Return HTTP 202 to the caller instead of throwing (artifact polling). */
  pendingOk?: boolean;
  /** Response is binary (PDF/ZPL): do not decode it as text on success. */
  binary?: boolean;
}

/** A successful HTTP exchange. */
interface HttpResult {
  status: number;
  contentType: string | undefined;
  requestId: string | undefined;
  /** Decoded body for XML responses (empty for binary success). */
  text: string;
  /** Raw body bytes. */
  data: Uint8Array;
}

const REDACTED = "[REDACTED]";
const SENSITIVE_HEADERS = new Set(["authorization", "x-cpc-zonos-key", "proxy-authorization"]);
const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id", "x-correlationid"] as const;
const MAX_RETRY_AFTER_MS = 30_000;
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Copy of the headers with credentials replaced, safe for logs and error output. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/** Builds `?a=1&b=2` with `%20` for blanks (the API forbids blanks and `+` is ambiguous). */
export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** Extracts `<message>` entries if the root element is `messages`. */
function extractMessages(text: string): CanadaPostMessage[] | undefined {
  if (!/<(?:[\w.-]+:)?messages[\s>/]/.test(text.slice(0, 2000))) return undefined;
  let root: XmlNode;
  try {
    root = parseXml(text);
  } catch {
    return undefined;
  }
  const messages = root["messages"];
  if (messages === undefined) return undefined;
  const out: CanadaPostMessage[] = [];
  for (const m of children(isNode(messages) ? messages : undefined, "message")) {
    out.push({
      code: str(m, "code") ?? "",
      description: str(m, "description") ?? "",
    });
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return undefined;
}

/** Thin, retry-aware wrapper around `fetch` that knows Canada Post's error conventions. */
export class HttpTransport {
  constructor(private readonly config: ResolvedConfig) {}

  /** The origin all requests go to. */
  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async execute(spec: RequestSpec): Promise<HttpResult> {
    const { config } = this;
    const request: CanadaPostRequestInfo = {
      method: spec.method,
      url: spec.url,
      operation: spec.operation,
    };
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`,
      Accept: spec.accept,
      "Accept-Language": config.language,
      "User-Agent": `canadapost-sdk-node/${SDK_VERSION}`,
      ...spec.headers,
    };
    if (spec.contentType !== undefined) headers["Content-Type"] = spec.contentType;

    const mutating = spec.mutating === true;
    // Only idempotent reads are ever retried.
    const maxAttempts = !mutating && spec.method === "GET" ? config.retries + 1 : 1;

    for (let attempt = 0; ; attempt += 1) {
      this.debug("request", spec, headers, attempt);
      const result = await this.attempt(spec, headers, request, mutating);
      this.debug("response", spec, headers, attempt, result.status);

      const retryable = result.status === 429 || result.status >= 500;
      if (retryable && attempt + 1 < maxAttempts) {
        const backoff = config.retryDelayMs * 2 ** attempt;
        const delay = Math.max(backoff, result.retryAfter ?? 0);
        this.debug("retry", spec, headers, attempt, result.status, delay);
        if (delay > 0) await sleep(delay);
        continue;
      }
      return this.interpret(spec, request, result, mutating);
    }
  }

  private debug(
    type: "request" | "response" | "retry",
    spec: RequestSpec,
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
        url: spec.url,
        headers: redactHeaders(headers),
        attempt,
        ...(status === undefined ? {} : { status }),
        ...(delayMs === undefined ? {} : { delayMs }),
      });
    } catch {
      // A broken logger must never break an API call.
    }
  }

  private async attempt(
    spec: RequestSpec,
    headers: Record<string, string>,
    request: CanadaPostRequestInfo,
    mutating: boolean,
  ): Promise<{
    status: number;
    contentType: string | undefined;
    requestId: string | undefined;
    retryAfter: number | undefined;
    data: Uint8Array;
  }> {
    const { config } = this;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, config.timeoutMs);
    try {
      const init: RequestInit = { method: spec.method, headers, signal: controller.signal };
      if (spec.body !== undefined) init.body = spec.body;
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
          cause,
        });
      }
      if (timedOut) throw new CanadaPostTimeoutError(config.timeoutMs, request);
      throw new CanadaPostNetworkError(request, cause);
    } finally {
      clearTimeout(timer);
    }
  }

  private interpret(
    spec: RequestSpec,
    request: CanadaPostRequestInfo,
    raw: {
      status: number;
      contentType: string | undefined;
      requestId: string | undefined;
      data: Uint8Array;
    },
    mutating: boolean,
  ): HttpResult {
    const isXmlish =
      !spec.binary ||
      raw.status >= 300 ||
      (raw.contentType !== undefined && /xml/i.test(raw.contentType));
    const text = isXmlish ? new TextDecoder("utf-8").decode(raw.data) : "";

    if (mutating && GATEWAY_STATUSES.has(raw.status)) {
      throw new CanadaPostIndeterminateError({
        request,
        reason: "gateway",
        status: raw.status,
        recovery: spec.recovery ?? "Look the object up before retrying.",
      });
    }

    const messages = text === "" ? undefined : extractMessages(text);
    const pending = raw.status === 202 && spec.pendingOk === true;
    const failed = raw.status >= 300 || (raw.status === 202 && !pending);
    // Canada Post answers some business-rule failures with HTTP 200 and a <messages> body.
    if (failed || messages !== undefined) {
      throw new CanadaPostApiError({
        status: raw.status,
        messages: messages ?? [],
        request,
        requestId: raw.requestId,
        bodyExcerpt: text === "" ? undefined : text.slice(0, 500),
      });
    }
    return {
      status: raw.status,
      contentType: raw.contentType,
      requestId: raw.requestId,
      text,
      data: raw.data,
    };
  }
}

/** Returns the named root element of a parsed response, or throws a parse error. */
export function rootElement(root: XmlNode, name: string, operation: string): XmlNode {
  const value = asArray(root[name])[0];
  if (isNode(value)) return value;
  // An element that is present but empty (for example an empty list) parses as "".
  if (name in root) return {};
  const present = Object.keys(root).join(", ") || "none";
  throw new CanadaPostParseError(
    `${operation}: expected <${name}> in the response but found: ${present}`,
  );
}
