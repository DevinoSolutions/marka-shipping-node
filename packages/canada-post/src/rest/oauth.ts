import type { CanadaPostDebugEvent } from "../config.js";
import { CanadaPostAuthError } from "../errors.js";
import { REST_TOKEN_URL, type ResolvedRestConfig } from "./config.js";
import { retryAfterMs, sleep, type SecretRedactor } from "./redact.js";

interface CachedToken {
  value: string;
  /** Epoch ms after which the token must be replaced (already includes the refresh skew). */
  refreshAt: number;
}

/** Default lifetime when the token response omits `expires_in` (the field is optional in RFC 6749). */
const DEFAULT_LIFETIME_SECONDS = 300;

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * OAuth2 `client_credentials` token provider with an in-memory cache.
 *
 * - The token is cached and replaced `tokenRefreshSkewMs` before it expires.
 * - Concurrent callers share ONE in-flight token request (single-flight).
 * - Only the token request is retried (network error, timeout, 429, 5xx), with exponential
 *   backoff: it is idempotent, unlike the shipping writes that use the token.
 * - Credentials rejected by the token endpoint (4xx) are definitive and not retried.
 * - The client secret and the token are never put in an error message or a debug event.
 */
export class OAuthTokenProvider {
  private cached: CachedToken | undefined;
  private inflight: Promise<string> | undefined;

  constructor(
    private readonly config: ResolvedRestConfig,
    private readonly redactor: SecretRedactor,
  ) {
    redactor.add(config.clientSecret);
  }

  /** A valid access token, fetching or refreshing it when needed. */
  getToken(): Promise<string> {
    const cached = this.cached;
    if (cached !== undefined && this.config.now() < cached.refreshAt) {
      return Promise.resolve(cached.value);
    }
    this.inflight ??= this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /**
   * Drops the cached token after the API rejected it (HTTP 401). Only the rejected token is
   * dropped: if another caller already replaced it, the newer token is kept.
   */
  invalidate(rejected: string): void {
    if (this.cached?.value === rejected) this.cached = undefined;
  }

  private debug(type: CanadaPostDebugEvent["type"], attempt: number, status?: number): void {
    const hook = this.config.onDebug;
    if (hook === undefined) return;
    try {
      hook({
        type,
        operation: "oauth.token",
        method: "POST",
        url: REST_TOKEN_URL,
        headers: {},
        attempt,
        ...(status === undefined ? {} : { status }),
      });
    } catch {
      // A broken logger must never break a token request.
    }
  }

  private async fetchToken(): Promise<string> {
    const { config } = this;
    const maxAttempts = config.retries + 1;
    let lastError: CanadaPostAuthError | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      this.debug("request", attempt);
      let retryAfter: number | undefined;
      try {
        const outcome = await this.requestOnce();
        retryAfter = outcome.retryAfter;
        this.debug("response", attempt, outcome.status);
        if (outcome.kind === "token") {
          this.cached = outcome.token;
          this.redactor.add(outcome.token.value);
          return outcome.token.value;
        }
        lastError = outcome.error;
      } catch (error) {
        lastError =
          error instanceof CanadaPostAuthError
            ? error
            : new CanadaPostAuthError("Canada Post token request failed unexpectedly", {
                transient: false,
              });
      }
      if (!lastError.transient || attempt + 1 >= maxAttempts) break;
      const delay = Math.max(config.retryDelayMs * 2 ** attempt, retryAfter ?? 0);
      this.debug("retry", attempt, lastError.status);
      if (delay > 0) await sleep(delay);
    }
    throw lastError ?? new CanadaPostAuthError("Token request failed", { transient: false });
  }

  private async requestOnce(): Promise<
    | { kind: "token"; status: number; retryAfter: number | undefined; token: CachedToken }
    | { kind: "error"; status: number; retryAfter: number | undefined; error: CanadaPostAuthError }
  > {
    const { config } = this;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, config.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await config.fetch(REST_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: config.scope,
        }).toString(),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (cause) {
      const timedOut = controller.signal.aborted;
      throw new CanadaPostAuthError(
        timedOut
          ? `Canada Post token request timed out after ${String(config.timeoutMs)} ms`
          : "Canada Post token request failed before a response was received",
        { transient: true, cause: timedOut ? undefined : cause },
      );
    } finally {
      clearTimeout(timer);
    }

    const retryAfter = retryAfterMs(response.headers);
    if (response.ok) {
      return {
        kind: "token",
        status: response.status,
        retryAfter,
        token: this.readToken(text),
      };
    }

    let oauthError: string | undefined;
    let description: string | undefined;
    try {
      const body: unknown = JSON.parse(text);
      if (isRecord(body)) {
        if (typeof body["error"] === "string") oauthError = body["error"];
        if (typeof body["error_description"] === "string") description = body["error_description"];
      }
    } catch {
      // not JSON: only the status is reported
    }
    const transient = TRANSIENT_STATUSES.has(response.status);
    const detail = [oauthError, description]
      .filter((v): v is string => v !== undefined && v !== "")
      .map((v) => this.redactor.scrub(v).slice(0, 200))
      .join(": ");
    return {
      kind: "error",
      status: response.status,
      retryAfter,
      error: new CanadaPostAuthError(
        `Canada Post token request ${transient ? "failed" : "was rejected"} (HTTP ${String(response.status)})` +
          (detail === "" ? "" : `: ${detail}`),
        { status: response.status, oauthError, transient },
      ),
    };
  }

  private readToken(text: string): CachedToken {
    const { config } = this;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // The body is not echoed: on a 2xx it is where the token itself would be.
      throw new CanadaPostAuthError("Canada Post token response was not valid JSON", {
        transient: false,
      });
    }
    const accessToken = isRecord(body) ? body["access_token"] : undefined;
    if (typeof accessToken !== "string" || accessToken === "") {
      throw new CanadaPostAuthError("Canada Post token response had no access_token", {
        transient: false,
      });
    }
    const tokenType = isRecord(body) ? body["token_type"] : undefined;
    if (typeof tokenType === "string" && tokenType.toLowerCase() !== "bearer") {
      throw new CanadaPostAuthError(
        `Canada Post token response has unsupported token_type ${JSON.stringify(tokenType.slice(0, 20))}`,
        { transient: false },
      );
    }
    const rawLifetime = isRecord(body) ? Number(body["expires_in"]) : Number.NaN;
    const lifetimeMs =
      (Number.isFinite(rawLifetime) && rawLifetime > 0 ? rawLifetime : DEFAULT_LIFETIME_SECONDS) *
      1000;
    // Never refresh later than half way through a short-lived token, never before issue.
    const skew = Math.min(config.tokenRefreshSkewMs, lifetimeMs / 2);
    return { value: accessToken, refreshAt: config.now() + lifetimeMs - skew };
  }
}
