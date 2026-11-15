// Shared setup of the live TEST-APP suite.
//
// This suite talks to the real Canada Post Developer Portal using the credentials of a
// *Test* app (free, static stub answers, no postage). It may create and void shipments, but
// only after `assertTestApp()` has proven that the credentials really belong to a Test app
// (two very different quotes must come back byte-identical). `npm run check:live-readonly`
// enforces that every test file does so in `beforeAll`, and that nothing in this directory can
// name the production credentials, the production app type or the legacy XML client.
//
// This module is the ONLY place a REST client is built. It reads exactly three credential
// variables (plus the opt-in flag); everything else in the environment, and every other line
// of `.env`, is ignored.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createCanadaPostRestClient, type CanadaPostRestClient } from "../../src/index.js";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");

/** Reads only the named keys from the repository `.env` (the file may hold other secrets). */
function readDotEnv(keys: readonly string[]): Record<string, string> {
  const file = join(repoRoot, ".env");
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!keys.includes(key)) continue;
    out[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

const fromFile = readDotEnv([
  "CANADAPOST_CLIENT_ID",
  "CANADAPOST_CLIENT_SECRET",
  "CANADAPOST_CUSTOMER_NUMBER",
]);
const clientId = process.env.CANADAPOST_CLIENT_ID ?? fromFile["CANADAPOST_CLIENT_ID"] ?? "";
const clientSecret =
  process.env.CANADAPOST_CLIENT_SECRET ?? fromFile["CANADAPOST_CLIENT_SECRET"] ?? "";
const customerNumber =
  process.env.CANADAPOST_CUSTOMER_NUMBER ?? fromFile["CANADAPOST_CUSTOMER_NUMBER"] ?? "";
const requested = process.env.CANADAPOST_TEST_APP_LIVE === "true";

// When the suite is requested, missing credentials FAIL the run instead of skipping it: a
// canary that silently skips would hide a broken pipeline.
if (requested && (clientId === "" || clientSecret === "" || customerNumber === "")) {
  throw new Error(
    "CANADAPOST_TEST_APP_LIVE=true but CANADAPOST_CLIENT_ID, CANADAPOST_CLIENT_SECRET and " +
      "CANADAPOST_CUSTOMER_NUMBER are not all set",
  );
}

/** The suite runs only when explicitly requested. */
export const liveEnabled = requested;

type DebugHook = Parameters<typeof createCanadaPostRestClient>[0]["onDebug"];

function buildClient(
  secret: string,
  onDebug: DebugHook,
  retryDelayMs?: number,
): CanadaPostRestClient {
  return createCanadaPostRestClient({
    clientId,
    clientSecret: secret,
    customerNumber,
    app: "test",
    timeoutMs: 60_000,
    ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
    ...(onDebug === undefined ? {} : { onDebug }),
  });
}

let cached: CanadaPostRestClient | undefined;

/** The Test-app client (built lazily and reused). The app type is hard-coded. */
export function testAppClient(): CanadaPostRestClient {
  cached ??= buildClient(clientSecret, undefined);
  return cached;
}

/** A separate Test-app client whose requests are reported to `onDebug` (redacted by the SDK). */
export function observedTestAppClient(onDebug: NonNullable<DebugHook>): CanadaPostRestClient {
  return buildClient(clientSecret, onDebug);
}

/**
 * A throw-away client with a wrong client secret, for the negative authentication tests. It
 * is still declared a Test app and can never succeed in authenticating.
 */
export function clientWithWrongSecret(onDebug?: DebugHook): {
  client: CanadaPostRestClient;
  secret: string;
} {
  const secret = `wrong-secret-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  return { client: buildClient(secret, onDebug, 100), secret };
}

/** The client secret, so tests can assert that it never appears in debug output or errors. */
export function realClientSecret(): string {
  return clientSecret;
}

/** The customer number of the Test app, for building request bodies. */
export function testCustomerNumber(): string {
  return customerNumber;
}

/** A request id that is unique per run (max 35 characters). */
export function uniqueRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.slice(
    0,
    35,
  );
}
