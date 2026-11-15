import { createHash } from "node:crypto";
import { CanadaPostTestAppRequiredError } from "../errors.js";
import { REST_BASE_URL } from "./config.js";
import type { RestContext } from "./context.js";
import { parseJsonBody } from "./transport.js";
import type { RestPriceRequest } from "./types.js";

/** Outcome of `CanadaPostRestClient.probeTestApp()`. */
export interface TestAppProbeResult {
  /** True only when two clearly different quotes returned byte-identical stub bodies. */
  isTestApp: boolean;
  /** Why the app was not proven to be a Test app. `undefined` when it was. */
  reason: CanadaPostTestAppRequiredError["reason"] | undefined;
  /** Human readable explanation (never contains credentials or tokens). */
  detail: string;
  /** SHA-256 (hex) of each quote response body; two equal entries prove identical stubs. */
  fingerprints: string[];
}

// Two quotes that no real rating engine can price identically: different origin, destination,
// weight, dimensions and service filter. The Test app ignores the payload and answers the
// same canned quote (verified 2026-11-15); a Production app computes real, different prices.
const QUOTE_A: RestPriceRequest = {
  quoteType: "counter",
  originPostalCode: "K1A0B1",
  destination: { domestic: { postalCode: "M5V2T6" } },
  parcelCharacteristics: { weight: 0.4, dimensions: { length: 20, width: 15, height: 6 } },
};
const QUOTE_B: RestPriceRequest = {
  quoteType: "counter",
  originPostalCode: "V6B1A1",
  destination: { domestic: { postalCode: "H3B1A1" } },
  parcelCharacteristics: { weight: 17.3, dimensions: { length: 60, width: 40, height: 30 } },
  services: ["DOM.EP"],
};

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);
}

function fingerprint(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A usable quote list is a non-empty array of objects that carry a service code. */
function isPriceList(body: unknown): boolean {
  return (
    Array.isArray(body) &&
    body.length > 0 &&
    body.every(
      (q) =>
        typeof q === "object" &&
        q !== null &&
        typeof (q as { serviceCode?: unknown }).serviceCode === "string",
    )
  );
}

async function runProbe(ctx: RestContext): Promise<string[]> {
  if (ctx.config.app === "production") {
    throw new CanadaPostTestAppRequiredError(
      "declared-production",
      'the client was created with app: "production"; nothing was sent',
    );
  }
  const results = [];
  for (const [index, quote] of [QUOTE_A, QUOTE_B].entries()) {
    try {
      results.push(
        await ctx.http.execute({
          operation: "testApp.probe",
          method: "POST",
          url: `${REST_BASE_URL}/rating/v1/prices`,
          accept: "application/json",
          body: { ...quote, customerNumber: ctx.config.customerNumber },
        }),
      );
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : "unknown error";
      throw new CanadaPostTestAppRequiredError(
        "probe-failed",
        `quote ${String(index + 1)} failed (${why}); the app could not be identified`,
        { cause },
      );
    }
  }
  const [first, second] = results;
  if (first === undefined || second === undefined) {
    throw new CanadaPostTestAppRequiredError("probe-failed", "no quote answers were collected");
  }
  for (const [index, result] of results.entries()) {
    let body: unknown;
    try {
      body = parseJsonBody(result, "testApp.probe");
    } catch (cause) {
      throw new CanadaPostTestAppRequiredError(
        "unexpected-response",
        `quote ${String(index + 1)} was not JSON`,
        { cause },
      );
    }
    if (result.status !== 200 || !isPriceList(body)) {
      throw new CanadaPostTestAppRequiredError(
        "unexpected-response",
        `quote ${String(index + 1)} did not return a price list (HTTP ${String(result.status)})`,
      );
    }
  }
  if (!sameBytes(first.data, second.data)) {
    throw new CanadaPostTestAppRequiredError(
      "responses-differ",
      "two different quotes returned different prices, so this app computes real rates",
    );
  }
  return [fingerprint(first.data), fingerprint(second.data)];
}

/**
 * Tries to prove that the credentials belong to a Canada Post Test app, without ever
 * throwing for a failed proof: see {@link assertTestApp} for the throwing form.
 */
export async function probeTestApp(ctx: RestContext): Promise<TestAppProbeResult> {
  try {
    const fingerprints = await runProbe(ctx);
    return {
      isTestApp: true,
      reason: undefined,
      detail: "two different quotes returned byte-identical stub responses",
      fingerprints,
    };
  } catch (error) {
    if (error instanceof CanadaPostTestAppRequiredError) {
      return { isTestApp: false, reason: error.reason, detail: error.message, fingerprints: [] };
    }
    throw error;
  }
}

/** Throws {@link CanadaPostTestAppRequiredError} unless {@link probeTestApp} proves a Test app. */
export async function assertTestApp(ctx: RestContext): Promise<void> {
  // runProbe throws the typed error itself, so the cause chain is kept.
  await runProbe(ctx);
}
