import { CanadaPostConfigurationError } from "./errors.js";

/** `development` is the Canada Post sandbox (default); `production` bills postage. */
export type CanadaPostEnvironment = "development" | "production";

/** Hosts of the two environments. */
export const BASE_URLS: Readonly<Record<CanadaPostEnvironment, string>> = {
  development: "https://ct.soa-gw.canadapost.ca",
  production: "https://soa-gw.canadapost.ca",
};

/** Versioned vendor media types (see docs/research/canadapost-api-contracts.md section 1). */
export const MEDIA_TYPES = {
  rating: "application/vnd.cpc.ship.rate-v4+xml",
  ncShipment: "application/vnd.cpc.ncshipment-v4+xml",
  shipment: "application/vnd.cpc.shipment-v8+xml",
  manifest: "application/vnd.cpc.manifest-v8+xml",
  tracking: "application/vnd.cpc.track-v2+xml",
  pdf: "application/pdf",
  zpl: "application/zpl",
} as const;

/** XML namespaces of request bodies. */
export const NAMESPACES = {
  rating: "http://www.canadapost.ca/ws/ship/rate-v4",
  ncShipment: "http://www.canadapost.ca/ws/ncshipment-v4",
  shipment: "http://www.canadapost.ca/ws/shipment-v8",
  manifest: "http://www.canadapost.ca/ws/manifest-v8",
} as const;

/** A structured event for the optional `onDebug` hook. Authorization is always redacted. */
export interface CanadaPostDebugEvent {
  type: "request" | "response" | "retry";
  operation: string;
  method: string;
  url: string;
  /** Request headers with `Authorization` and `X-CPC-Zonos-Key` replaced by `[REDACTED]`. */
  headers: Record<string, string>;
  attempt: number;
  status?: number;
  delayMs?: number;
}

/** Options accepted by {@link createCanadaPostClient}. */
export interface CanadaPostClientOptions {
  /** API user id (the part of the API key before the colon). */
  username: string;
  /** API password (the part of the API key after the colon). */
  password: string;
  /** Your (mailed-by) customer number. */
  customerNumber: string;
  /** Mailed-on-behalf-of customer number. Defaults to `customerNumber`. */
  mobo?: string;
  /** Contract id; enables commercial rates and contract settlement. */
  contractId?: string;
  /**
   * `"development"` (default) is the sandbox. `"production"` must be passed explicitly and
   * creating shipments there CHARGES postage.
   */
  environment?: CanadaPostEnvironment;
  /** Injectable `fetch` (defaults to the global one). */
  fetch?: typeof fetch;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Extra attempts for idempotent GETs on 5xx/429. Default 2. Writes are never retried. */
  retries?: number;
  /** Base backoff in ms (doubles per attempt). Default 250. */
  retryDelayMs?: number;
  /** Language for names and error messages. Default `en-CA`. */
  language?: "en-CA" | "fr-CA";
  /** Observability hook; receives redacted request metadata. Never receives credentials. */
  onDebug?: (event: CanadaPostDebugEvent) => void;
}

/** Fully resolved, validated configuration. */
export interface ResolvedConfig {
  username: string;
  password: string;
  customerNumber: string;
  mobo: string;
  contractId: string | undefined;
  environment: CanadaPostEnvironment;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  language: "en-CA" | "fr-CA";
  onDebug: ((event: CanadaPostDebugEvent) => void) | undefined;
}

const NUMERIC_ID = /^[0-9]{1,10}$/;

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CanadaPostConfigurationError(`${field} is required`);
  }
  return value.trim();
}

function requireNumericId(value: unknown, field: string): string {
  const v = requireNonEmpty(value, field);
  if (!NUMERIC_ID.test(v)) {
    throw new CanadaPostConfigurationError(`${field} must be 1-10 digits`);
  }
  return v;
}

/** Validates options and applies defaults. Throws {@link CanadaPostConfigurationError}. */
export function resolveConfig(options: CanadaPostClientOptions): ResolvedConfig {
  const environment = options.environment ?? "development";
  if (environment !== "development" && environment !== "production") {
    throw new CanadaPostConfigurationError(
      `environment must be "development" or "production", got ${JSON.stringify(environment)}`,
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CanadaPostConfigurationError("No fetch implementation available; pass options.fetch");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new CanadaPostConfigurationError("timeoutMs must be a positive number");
  }
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
    throw new CanadaPostConfigurationError("retries must be an integer between 0 and 10");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new CanadaPostConfigurationError("retryDelayMs must be zero or positive");
  }
  const username = requireNonEmpty(options.username, "username");
  if (username.includes(":")) {
    throw new CanadaPostConfigurationError("username must not contain a colon");
  }
  const customerNumber = requireNumericId(options.customerNumber, "customerNumber");
  return {
    username,
    password: requireNonEmpty(options.password, "password"),
    customerNumber,
    mobo:
      options.mobo === undefined || options.mobo === ""
        ? customerNumber
        : requireNumericId(options.mobo, "mobo"),
    contractId:
      options.contractId === undefined || options.contractId === ""
        ? undefined
        : requireNumericId(options.contractId, "contractId"),
    environment,
    baseUrl: BASE_URLS[environment],
    fetch: fetchImpl,
    timeoutMs,
    retries,
    retryDelayMs,
    language: options.language ?? "en-CA",
    onDebug: options.onDebug,
  };
}
