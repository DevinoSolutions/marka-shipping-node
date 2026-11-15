import type { CanadaPostDebugEvent } from "../config.js";
import { CanadaPostConfigurationError } from "../errors.js";
import type { RestApp } from "./types.js";

/** Origin of the Canada Post Developer Portal APIs (Test and Production share it). */
export const REST_ORIGIN = "https://api.canadapost-postescanada.ca";

/** Path prefix of every API and artifact URL on {@link REST_ORIGIN}. */
export const REST_PATH_PREFIX = "/prod/devportal-portaildesdeveloppeurs";

/** Base URL of the REST APIs. */
export const REST_BASE_URL = `${REST_ORIGIN}${REST_PATH_PREFIX}`;

/** OAuth2 token endpoint (`client_credentials`). The same URL serves both app types. */
export const REST_TOKEN_URL = `${REST_BASE_URL}/cpc-api-native-oauth-provider/oauth2/token`;

/** Options accepted by {@link createCanadaPostRestClient}. */
export interface CanadaPostRestClientOptions {
  /** OAuth client id of the Developer Portal app. */
  clientId: string;
  /** OAuth client secret of the Developer Portal app. Never logged or put in an error. */
  clientSecret: string;
  /** Your (mailed-by) customer number. */
  customerNumber: string;
  /** Mailed-on-behalf-of customer number. Defaults to `customerNumber`. */
  mobo?: string;
  /**
   * Which kind of Developer Portal app the credentials belong to. Defaults to `"test"`.
   * This is a DECLARATION by the caller (never read from an environment variable): the SDK
   * cannot tell the apps apart, and a `"production"` app bills real postage. A client
   * declared `"production"` refuses `assertTestApp()`; a client declared `"test"` can still
   * be pointed at production credentials by mistake, which is why the live test-app suite
   * proves the app with `assertTestApp()` before it writes anything.
   */
  app?: RestApp;
  /** OAuth scope to request. Default `merchant`. */
  scope?: "merchant" | "platform";
  /** `platform-id` header (platform integrators). */
  platformId?: string;
  /** Default `X-CPC-Zonos-Key` for US-bound shipments created without a declaration id. */
  zonosKey?: string;
  /** Injectable `fetch` (defaults to the global one). */
  fetch?: typeof fetch;
  /** Per-attempt timeout in milliseconds (token and API calls). Default 30000. */
  timeoutMs?: number;
  /** Extra attempts for idempotent GETs on 5xx/429 and for the token request. Default 2. Writes are never retried. */
  retries?: number;
  /** Base backoff in ms (doubles per attempt). Default 250. */
  retryDelayMs?: number;
  /** Refresh the access token this many ms before it expires. Default 60000. */
  tokenRefreshSkewMs?: number;
  /** Language for names and error messages. Default `en-CA`. */
  language?: "en-CA" | "fr-CA";
  /** Observability hook; receives redacted request metadata. Never receives credentials or tokens. */
  onDebug?: (event: CanadaPostDebugEvent) => void;
  /** Clock used for token expiry, in epoch milliseconds. Test hook. */
  now?: () => number;
}

/** Fully resolved, validated REST configuration. */
export interface ResolvedRestConfig {
  clientId: string;
  clientSecret: string;
  customerNumber: string;
  mobo: string;
  app: RestApp;
  scope: "merchant" | "platform";
  platformId: string | undefined;
  zonosKey: string | undefined;
  fetch: typeof fetch;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  tokenRefreshSkewMs: number;
  language: "en-CA" | "fr-CA";
  onDebug: ((event: CanadaPostDebugEvent) => void) | undefined;
  now: () => number;
}

const CUSTOMER_NUMBER = /^[0-9]{1,18}$/;

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CanadaPostConfigurationError(`${field} is required`);
  }
  return value.trim();
}

function requireCustomerNumber(value: unknown, field: string): string {
  const v = requireNonEmpty(value, field);
  if (!CUSTOMER_NUMBER.test(v)) {
    throw new CanadaPostConfigurationError(`${field} must be 1-18 digits`);
  }
  return v;
}

function optionalNonEmpty(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  return requireNonEmpty(value, field);
}

/** Validates options and applies defaults. Throws {@link CanadaPostConfigurationError}. */
export function resolveRestConfig(options: CanadaPostRestClientOptions): ResolvedRestConfig {
  const app = options.app ?? "test";
  if (app !== "test" && app !== "production") {
    throw new CanadaPostConfigurationError(
      `app must be "test" or "production", got ${JSON.stringify(app)}`,
    );
  }
  const scope = options.scope ?? "merchant";
  if (scope !== "merchant" && scope !== "platform") {
    throw new CanadaPostConfigurationError(
      `scope must be "merchant" or "platform", got ${JSON.stringify(scope)}`,
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CanadaPostConfigurationError("No fetch implementation available; pass options.fetch");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const tokenRefreshSkewMs = options.tokenRefreshSkewMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new CanadaPostConfigurationError("timeoutMs must be a positive number");
  }
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
    throw new CanadaPostConfigurationError("retries must be an integer between 0 and 10");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new CanadaPostConfigurationError("retryDelayMs must be zero or positive");
  }
  if (!Number.isFinite(tokenRefreshSkewMs) || tokenRefreshSkewMs < 0) {
    throw new CanadaPostConfigurationError("tokenRefreshSkewMs must be zero or positive");
  }
  const customerNumber = requireCustomerNumber(options.customerNumber, "customerNumber");
  return {
    clientId: requireNonEmpty(options.clientId, "clientId"),
    clientSecret: requireNonEmpty(options.clientSecret, "clientSecret"),
    customerNumber,
    mobo:
      options.mobo === undefined || options.mobo === ""
        ? customerNumber
        : requireCustomerNumber(options.mobo, "mobo"),
    app,
    scope,
    platformId: optionalNonEmpty(options.platformId, "platformId"),
    zonosKey: optionalNonEmpty(options.zonosKey, "zonosKey"),
    fetch: fetchImpl,
    timeoutMs,
    retries,
    retryDelayMs,
    tokenRefreshSkewMs,
    language: options.language ?? "en-CA",
    onDebug: options.onDebug,
    now: options.now ?? Date.now,
  };
}
