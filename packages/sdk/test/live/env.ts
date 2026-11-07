// Shared setup for the live suite.
//
// READ-ONLY and SANDBOX-ONLY BY CONSTRUCTION: this module only builds a client against the
// Canada Post DEVELOPMENT environment. Every live test must stay a read/quote;
// `npm run check:live-readonly` scans this directory and fails on any mutating call.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createCanadaPostClient, type CanadaPostClient } from "../../src/index.js";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");
const envFile = join(repoRoot, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const username = process.env.CANADAPOST_USERNAME ?? "";
const password = process.env.CANADAPOST_PASSWORD ?? "";
const customerNumber = process.env.CANADAPOST_CUSTOMER_NUMBER ?? "";
const contractId = process.env.CANADAPOST_CONTRACT_ID ?? "";
const requestedEnvironment = (process.env.CANADAPOST_ENVIRONMENT ?? "development").toLowerCase();
const requested = process.env.CANADAPOST_LIVE_TESTS === "true";

// REFUSE to run against anything but the sandbox. This fails the whole run loudly instead of
// skipping, so a mis-set variable can never silently point the suite at production.
if (requested && requestedEnvironment !== "development") {
  throw new Error(
    "Refusing to run the live suite: CANADAPOST_ENVIRONMENT must be 'development' " +
      "(the sandbox). The live suite never touches production.",
  );
}

/**
 * The live suite runs only when explicitly enabled AND credentials are present. Everything
 * else skips cleanly, so `npm run test:live` is safe on a machine with no .env.
 */
export const liveEnabled = requested && username !== "" && password !== "" && customerNumber !== "";

let cached: CanadaPostClient | undefined;

/**
 * Lazily builds (and reuses) the sandbox client. Lazy because vitest evaluates describe
 * bodies while collecting tests, and constructing a client without credentials would throw.
 * The environment is hard-coded; it is never taken from the process environment.
 */
export function liveClient(): CanadaPostClient {
  cached ??= createCanadaPostClient({
    username,
    password,
    customerNumber,
    ...(contractId === "" ? {} : { contractId }),
    environment: "development",
    timeoutMs: 60_000,
  });
  return cached;
}
