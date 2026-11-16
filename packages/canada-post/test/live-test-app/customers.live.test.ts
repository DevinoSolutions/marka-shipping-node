// LIVE TEST-APP suite: customer information (the Test app is subscribed to it).
//
// The point of these tests is the card-data rule: Canada Post lists the aliases of the credit
// cards on file, and the SDK must never hand them out, log them or let them reach an error.
// Runs only with CANADAPOST_TEST_APP_LIVE=true.
import { beforeAll, describe, expect, it } from "vitest";
import type { CanadaPostDebugEvent } from "../../src/index.js";
import { expectValid, loadSpec, validateResponse } from "../support/openapi.js";
import { liveEnabled, observedTestAppClient, testAppClient } from "./setup.js";

/**
 * KNOWN STUB DEVIATION (observed 2026-11-16): the Test app answers `contracts` entries and
 * `authorizedPayers[].payerNumber` as JSON numbers where the document says digit strings.
 * Pinned precisely: numbers are converted to strings, every other difference still fails.
 */
function normalizeKnownDeviation<T extends object>(info: T): unknown {
  const copy = structuredClone(info) as {
    contracts?: unknown[];
    authorizedPayers?: Array<{ payerNumber?: unknown }>;
  };
  if (copy.contracts !== undefined) {
    copy.contracts = copy.contracts.map((c) => (typeof c === "number" ? String(c) : c));
  }
  for (const payer of copy.authorizedPayers ?? []) {
    if (typeof payer.payerNumber === "number") payer.payerNumber = String(payer.payerNumber);
  }
  return copy;
}

describe.skipIf(!liveEnabled)("Canada Post Test app: customer information", () => {
  const customerinfo = loadSpec("customerinfo-v1");

  beforeAll(async () => {
    await testAppClient().assertTestApp();
  });

  it("returns a schema-valid profile and drops the card aliases", async () => {
    const info = await testAppClient().customers.get();
    expect(info).not.toHaveProperty("creditCardAliases");
    expect(typeof info.creditCardCount).toBe("number");
    expect(info.creditCardCount).toBeGreaterThanOrEqual(0);
    const { creditCardCount: _count, ...wire } = info;
    expectValid(
      "CustomerMailedBy 200",
      validateResponse(customerinfo, "CustomerMailedBy", 200, normalizeKnownDeviation(wire)),
    );
    expect(info.number).toMatch(/^\d{1,10}$/);
    expect(info.addressDetails.countryCode).toMatch(/^[A-Za-z]{2}$/);
  });

  it("returns a schema-valid MOBO profile", async () => {
    const info = await testAppClient().customers.getMobo();
    expectValid(
      "CustomerMailedByMOBO 200",
      validateResponse(customerinfo, "CustomerMailedByMOBO", 200, normalizeKnownDeviation(info)),
    );
  });

  it("summarizes payment readiness consistently with the profile, without card data", async () => {
    const info = await testAppClient().customers.get();
    const readiness = await testAppClient().customers.getPaymentReadiness();
    expect(readiness.hasCreditCard).toBe(info.creditCardCount > 0);
    expect(readiness.contracts).toBe(info.contracts?.length ?? 0);
    expect(readiness.authorizedPayers).toBe(info.authorizedPayers?.length ?? 0);
    expect(Object.keys(readiness).sort()).toEqual([
      "authorizedPayers",
      "contracts",
      "hasCreditCard",
      "paymentMethods",
    ]);
  });

  it("never exposes card aliases through followLink or debug events", async () => {
    const events: CanadaPostDebugEvent[] = [];
    const client = observedTestAppClient((event) => events.push(event));
    const info = await client.customers.get();
    const self = info.links?.find((l) => l.rel.toLowerCase() === "self");
    const followed = self === undefined ? undefined : await client.followLink(self);
    const everything = JSON.stringify([info, followed, events]);
    expect(everything).not.toMatch(/creditCardAliases|ccAlias/);
  });
});
