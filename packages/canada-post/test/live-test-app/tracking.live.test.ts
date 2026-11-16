// LIVE TEST-APP suite: tracking (Tracking v1 is one of the APIs the Test app is subscribed to).
//
// The Test app answers any PIN, DNC or reference with the same static stub, so these tests
// check the wire contract (schema, shapes, URL building), not parcel data. Runs only with
// CANADAPOST_TEST_APP_LIVE=true.
import { beforeAll, describe, expect, it } from "vitest";
import { CanadaPostApiError } from "../../src/index.js";
import { expectValid, loadSpec, validateResponse } from "../support/openapi.js";
import { liveEnabled, testAppClient } from "./setup.js";

// The PIN and DNC printed as examples in Canada Post's own documentation.
const PIN = "7023210215628702";
const DNC = "168067817265091";

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!liveEnabled)("Canada Post Test app: tracking", () => {
  const tracking = loadSpec("tracking-v1");

  beforeAll(async () => {
    await testAppClient().assertTestApp();
  });

  it("returns a schema-valid summary for a PIN", async () => {
    const summary = await testAppClient().tracking.getSummaryByPin(PIN);
    expectValid(
      "trackingSummaryPin 200",
      validateResponse(tracking, "trackingSummaryPin", 200, summary),
    );
    expect(summary.length).toBeGreaterThanOrEqual(1);
    expect(summary[0]?.pin).toMatch(/^[A-Za-z0-9]{11,16}$/);
  });

  it("returns a schema-valid summary for a DNC", async () => {
    const summary = await testAppClient().tracking.getSummaryByDnc(DNC);
    expectValid(
      "trackingSummaryDNC 200",
      validateResponse(tracking, "trackingSummaryDNC", 200, summary),
    );
    expect(summary.length).toBeGreaterThanOrEqual(1);
  });

  it("returns a schema-valid summary for a reference and a mailing-date window", async () => {
    const summary = await testAppClient().tracking.getSummaryByReference({
      referenceNumber: "SDK-LIVE-TEST",
      mailingDateFrom: isoDay(-20),
      mailingDateTo: isoDay(0),
    });
    expectValid(
      "TrackingSummaryReference 200",
      validateResponse(tracking, "TrackingSummaryReference", 200, summary),
    );
  });

  it("returns schema-valid details for a PIN and a DNC", async () => {
    const byPin = await testAppClient().tracking.getDetailsByPin(PIN);
    expectValid(
      "trackingDetailsByPin 200",
      validateResponse(tracking, "trackingDetailsByPin", 200, byPin),
    );
    expect(typeof byPin.activeExists).toBe("boolean");
    for (const event of byPin.significantEvents ?? []) {
      expect(event.eventDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const byDnc = await testAppClient().tracking.getDetailsByDnc(DNC);
    expectValid(
      "trackingDetailsByDNC 200",
      validateResponse(tracking, "trackingDetailsByDNC", 200, byDnc),
    );
  });

  it("renders a delivery confirmation certificate that is a PDF", async () => {
    const certificate = await testAppClient().tracking.createCertificate({
      pin: PIN,
      language: "en",
    });
    expectValid(
      "createCertificateDNC 200",
      validateResponse(tracking, "createCertificateDNC", 200, certificate),
    );
    const bytes = Buffer.from(certificate.image ?? "", "base64");
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("refuses a malformed PIN locally and a malformed search with a typed 4xx", async () => {
    await expect(testAppClient().tracking.getSummaryByPin("12/34")).rejects.toMatchObject({
      name: "CanadaPostValidationError",
    });
    const error = await testAppClient()
      .tracking.getSummaryByReference({
        referenceNumber: "SDK-LIVE-TEST",
        // The window may not reach back more than two months.
        mailingDateFrom: "2020-01-01",
        mailingDateTo: isoDay(0),
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    // The stub may accept it; if it refuses, the refusal must be a typed, non-retryable 4xx.
    if (error !== undefined) {
      expect(error).toBeInstanceOf(CanadaPostApiError);
      expect((error as CanadaPostApiError).status).toBeGreaterThanOrEqual(400);
      expect((error as CanadaPostApiError).status).toBeLessThan(500);
    }
  });
});
