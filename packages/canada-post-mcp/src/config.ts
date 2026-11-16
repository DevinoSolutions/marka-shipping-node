import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Which Canada Post Developer Portal app the credentials belong to, as DECLARED by the operator. */
export type McpApp = "test" | "production";

/** Raised for a bad or missing environment variable. The message never contains a value. */
export class McpConfigError extends Error {}

/** Everything the server reads from its environment. Credentials stay in memory only. */
export interface McpConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly customerNumber: string;
  readonly mobo: string | undefined;
  readonly platformId: string | undefined;
  /** `CANADAPOST_APP`: `test` (default) or `production`, which must be typed out. */
  readonly app: McpApp;
  /** `CANADAPOST_MCP_ALLOW_WRITES=true`: register the preview and apply tools. */
  readonly allowWrites: boolean;
  /** `CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES=true`: additionally needed when `app` is production. */
  readonly allowProductionWrites: boolean;
  /** Lifetime of a preview, in seconds (default 300, max 900). */
  readonly previewTtlSeconds: number;
  /** Key of the integrity MAC of stored previews (random per process when not set). */
  readonly previewHmacKey: string;
  /** Where labels are saved when the caller gives no path (default: a temp directory). */
  readonly outputDir: string;
  /** `CANADAPOST_MCP_OUTPUT_DIR` was set: caller-given label paths must stay inside it. */
  readonly outputDirRestricted: boolean;
}

/** What the server decided about writes, and why. */
export interface WritePolicy {
  readonly enabled: boolean;
  readonly reason: string;
}

const DEFAULT_TTL = 300;
const MAX_TTL = 900;

function readBool(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "" || raw === "false") return false;
  if (raw === "true") return true;
  throw new McpConfigError(`${name} must be "true" or "false"`);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new McpConfigError(`${name} is required`);
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Reads the configuration from environment variables. Credentials come from the environment
 * only (never from tool input). `CANADAPOST_PROD_*` variables are deliberately not read: the app
 * is chosen with `CANADAPOST_APP` and the usual `CANADAPOST_CLIENT_*` credentials.
 */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const appRaw = optional(env, "CANADAPOST_APP") ?? "test";
  if (appRaw !== "test" && appRaw !== "production") {
    throw new McpConfigError('CANADAPOST_APP must be "test" or "production"');
  }
  const ttlRaw = optional(env, "CANADAPOST_MCP_PREVIEW_TTL_SECONDS");
  let previewTtlSeconds = DEFAULT_TTL;
  if (ttlRaw !== undefined) {
    const ttl = Number(ttlRaw);
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_TTL) {
      throw new McpConfigError(
        `CANADAPOST_MCP_PREVIEW_TTL_SECONDS must be an integer from 30 to ${String(MAX_TTL)}`,
      );
    }
    previewTtlSeconds = ttl;
  }
  const keyRaw = optional(env, "CANADAPOST_MCP_PREVIEW_HMAC_KEY");
  if (keyRaw !== undefined && keyRaw.length < 32) {
    throw new McpConfigError("CANADAPOST_MCP_PREVIEW_HMAC_KEY must be at least 32 characters");
  }
  const outDir = optional(env, "CANADAPOST_MCP_OUTPUT_DIR");
  if (outDir !== undefined && !isAbsolute(outDir)) {
    throw new McpConfigError("CANADAPOST_MCP_OUTPUT_DIR must be an absolute path");
  }
  return {
    clientId: required(env, "CANADAPOST_CLIENT_ID"),
    clientSecret: required(env, "CANADAPOST_CLIENT_SECRET"),
    customerNumber: required(env, "CANADAPOST_CUSTOMER_NUMBER"),
    mobo: optional(env, "CANADAPOST_MOBO"),
    platformId: optional(env, "CANADAPOST_PLATFORM_ID"),
    app: appRaw,
    allowWrites: readBool(env, "CANADAPOST_MCP_ALLOW_WRITES"),
    allowProductionWrites: readBool(env, "CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES"),
    previewTtlSeconds,
    previewHmacKey: keyRaw ?? randomBytes(32).toString("hex"),
    outputDir: resolve(outDir ?? join(tmpdir(), "canadapost-mcp")),
    outputDirRestricted: outDir !== undefined,
  };
}

/**
 * Whether write tools may be registered. They need `CANADAPOST_MCP_ALLOW_WRITES=true`, and a
 * Production app additionally needs `CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES=true`.
 */
export function writePolicy(config: McpConfig): WritePolicy {
  if (!config.allowWrites) {
    return { enabled: false, reason: "CANADAPOST_MCP_ALLOW_WRITES is not true" };
  }
  if (config.app === "production" && !config.allowProductionWrites) {
    return {
      enabled: false,
      reason: "CANADAPOST_APP is production and CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES is not true",
    };
  }
  return { enabled: true, reason: "writes are enabled" };
}

/** Non-secret summary of the configuration, safe to log or return. */
export function describeConfig(config: McpConfig): Record<string, unknown> {
  return {
    app: config.app,
    customerNumberSet: true,
    mobo: config.mobo === undefined ? "same as customer number" : "set",
    writes: writePolicy(config),
    previewTtlSeconds: config.previewTtlSeconds,
    outputDir: config.outputDir,
  };
}
