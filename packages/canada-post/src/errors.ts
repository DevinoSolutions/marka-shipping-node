/**
 * Error hierarchy. Every error thrown by the SDK extends {@link CanadaPostError}.
 *
 * Errors never carry credentials: request headers are not stored on them, and anything that
 * is echoed (URLs, upstream bodies) is credential-free by construction.
 */

/** One entry of a Canada Post `<messages>` error body. */
export interface CanadaPostMessage {
  /** Numeric (`"7007"`), `"Server"` (schema failure) or `AA00x` (authorization) code. */
  code: string;
  description: string;
}

/** Base class of every error thrown by the SDK. */
export class CanadaPostError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Invalid client configuration (missing credentials, bad environment, foreign link host). */
export class CanadaPostConfigurationError extends CanadaPostError {}

/** The caller's input failed local validation; nothing was sent. */
export class CanadaPostValidationError extends CanadaPostError {}

/** The response could not be parsed as the expected XML. */
export class CanadaPostParseError extends CanadaPostError {
  /** First part of the offending body, for diagnostics. */
  readonly bodyExcerpt: string | undefined;
  constructor(message: string, options?: { cause?: unknown; bodyExcerpt?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.bodyExcerpt = options?.bodyExcerpt;
  }
}

/** Where a failed request was headed. Never contains headers. */
export interface CanadaPostRequestInfo {
  method: string;
  url: string;
  /** SDK operation name, e.g. `shipments.create`. */
  operation: string;
}

/**
 * Canada Post answered with an error: a non-2xx status and/or a `<messages>` body.
 *
 * Note that Canada Post can also answer a business-rule failure with HTTP 200 and a
 * `<messages>` body; the SDK throws this error for those too.
 */
export class CanadaPostApiError extends CanadaPostError {
  readonly status: number;
  /** Parsed `<message>` entries (empty if the body had none). */
  readonly messages: readonly CanadaPostMessage[];
  /** Id returned by the gateway in a request-id style header, if any. */
  readonly requestId: string | undefined;
  readonly request: CanadaPostRequestInfo;
  /** First 500 characters of the response body (text), for diagnostics. */
  readonly bodyExcerpt: string | undefined;
  /** REST/JSON API only: the `title` of a `{ title, detail, errors }` error body. */
  readonly title: string | undefined;
  /** REST/JSON API only: the `detail` of a `{ title, detail, errors }` error body. */
  readonly detail: string | undefined;

  constructor(init: {
    status: number;
    messages: readonly CanadaPostMessage[];
    request: CanadaPostRequestInfo;
    requestId?: string | undefined;
    bodyExcerpt?: string | undefined;
    title?: string | undefined;
    detail?: string | undefined;
    /** Replaces the generated summary (used by subclasses with a clearer explanation). */
    summary?: string | undefined;
  }) {
    const summary =
      init.summary ??
      (init.messages.length > 0
        ? init.messages.map((m) => `${m.code}: ${m.description}`).join("; ")
        : `HTTP ${String(init.status)}`);
    super(`Canada Post ${init.request.operation} failed (HTTP ${String(init.status)}): ${summary}`);
    this.status = init.status;
    this.messages = init.messages;
    this.request = init.request;
    this.requestId = init.requestId;
    this.bodyExcerpt = init.bodyExcerpt;
    this.title = init.title;
    this.detail = init.detail;
  }

  /** All message codes, in order. */
  get codes(): string[] {
    return this.messages.map((m) => m.code);
  }

  /** First message code, if any. */
  get code(): string | undefined {
    return this.messages[0]?.code;
  }

  /** All message descriptions, in order. */
  get descriptions(): string[] {
    return this.messages.map((m) => m.description);
  }

  /** First message description, if any. */
  get description(): string | undefined {
    return this.messages[0]?.description;
  }

  /** HTTP 202: the resource is not ready yet. Poll again later. */
  get isPending(): boolean {
    return this.status === 202;
  }

  /** HTTP 429 or any 5xx: the call itself may succeed if repeated (only safe for reads). */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** Whether any message carries the given code. */
  hasCode(code: string): boolean {
    return this.messages.some((m) => m.code === code);
  }
}

/** The request did not complete within `timeoutMs`. Only thrown for reads and quotes. */
export class CanadaPostTimeoutError extends CanadaPostError {
  readonly timeoutMs: number;
  readonly request: CanadaPostRequestInfo;
  constructor(timeoutMs: number, request: CanadaPostRequestInfo) {
    super(`Canada Post ${request.operation} timed out after ${String(timeoutMs)} ms`);
    this.timeoutMs = timeoutMs;
    this.request = request;
  }
}

/** The request failed before any HTTP response was received. Only thrown for reads and quotes. */
export class CanadaPostNetworkError extends CanadaPostError {
  readonly request: CanadaPostRequestInfo;
  constructor(request: CanadaPostRequestInfo, cause: unknown) {
    super(`Canada Post ${request.operation} failed before a response was received`, { cause });
    this.request = request;
  }
}

/**
 * A request that CHANGES state (create shipment, transmit, void, refund) timed out, lost its
 * connection, or hit a gateway error. It may or may not have been applied, and in production
 * a created shipment is already billed.
 *
 * DO NOT blindly retry. First look the object up:
 *
 * - contract shipments: `shipments.list({ requestId })` (set `customerRequestId` on create so
 *   this works), or `shipments.list({ groupId })`, or
 *   `shipments.list({ noManifest: true, date })`;
 * - non-contract shipments: `ncShipments.list({ from, to })` around the call time;
 * - transmit: `manifests.list({ start, end })`.
 *
 * Retry only once you have confirmed that nothing was created.
 */
export class CanadaPostIndeterminateError extends CanadaPostError {
  readonly request: CanadaPostRequestInfo;
  /** `"timeout"`, `"network"` or `"gateway"` (HTTP 502/503/504). */
  readonly reason: "timeout" | "network" | "gateway";
  /** HTTP status when `reason` is `"gateway"`. */
  readonly status: number | undefined;
  /** What to call to find out whether the operation took effect. */
  readonly recovery: string;

  constructor(init: {
    request: CanadaPostRequestInfo;
    reason: "timeout" | "network" | "gateway";
    recovery: string;
    status?: number | undefined;
    cause?: unknown;
  }) {
    super(
      `Canada Post ${init.request.operation} is INDETERMINATE (${init.reason}): the request may ` +
        `have been applied and charged. Do not retry blindly. ${init.recovery}`,
      init.cause === undefined ? undefined : { cause: init.cause },
    );
    this.request = init.request;
    this.reason = init.reason;
    this.status = init.status;
    this.recovery = init.recovery;
  }
}

/**
 * REST/JSON API only: the gateway answered HTTP 403.
 *
 * An EMPTY 403 body was observed (2026-11-15) for a Production app whose credentials are valid
 * (a token is issued) but which is not yet linked to the customer number. That reading is an
 * **ASSUMPTION**; a non-empty body carries Canada Post's own explanation in
 * {@link CanadaPostApiError.messages}.
 */
export class CanadaPostAccessDeniedError extends CanadaPostApiError {
  /** True when the 403 had no body at all. */
  readonly emptyBody: boolean;

  constructor(init: ConstructorParameters<typeof CanadaPostApiError>[0] & { emptyBody: boolean }) {
    super({
      ...init,
      summary: init.emptyBody
        ? "access denied with an empty body: the credentials were accepted but this app is not " +
          "authorized for this customer number or API (is the app linked to the account?)"
        : init.summary,
    });
    this.emptyBody = init.emptyBody;
  }
}

/**
 * REST/JSON API only: the OAuth2 token endpoint refused or could not issue an access token.
 * Nothing was sent to the shipping or rating API, so this is a DEFINITIVE failure even for
 * writes. The client secret and tokens are never part of the message.
 */
export class CanadaPostAuthError extends CanadaPostError {
  /** HTTP status of the token endpoint, if one answered. */
  readonly status: number | undefined;
  /** OAuth `error` code (for example `unauthorized_client`), if the body carried one. */
  readonly oauthError: string | undefined;
  /**
   * True when the failure looks transient (network error, timeout, 429 or 5xx) and every
   * retry was used up. False when the credentials were rejected.
   */
  readonly transient: boolean;

  constructor(
    message: string,
    init: {
      status?: number | undefined;
      oauthError?: string | undefined;
      transient: boolean;
      cause?: unknown;
    },
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.oauthError = init.oauthError;
    this.transient = init.transient;
  }
}

/**
 * `assertTestApp()` could not prove that the credentials belong to a Canada Post Test app (or
 * the client was declared `app: "production"`). Callers that require a Test app (the live
 * test-app suite) must stop and make NO write.
 */
export class CanadaPostTestAppRequiredError extends CanadaPostError {
  /**
   * `declared-production`: the client was created with `app: "production"`;
   * `probe-failed`: a quote request failed, so nothing can be proven;
   * `responses-differ`: two different quotes returned different bodies (real, computed prices);
   * `unexpected-response`: the quote answers were not usable price lists.
   */
  readonly reason:
    "declared-production" | "probe-failed" | "responses-differ" | "unexpected-response";

  constructor(
    reason: CanadaPostTestAppRequiredError["reason"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Not a Test app, refusing: ${message}`, options);
    this.reason = reason;
  }
}
