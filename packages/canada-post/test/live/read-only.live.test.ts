// READ-ONLY smoke tests against the Canada Post SANDBOX.
//
// Allowed: rating quotes, service discovery, tracking. NEVER add a call that creates, voids,
// transmits or refunds anything; `npm run check:live-readonly` enforces it.
import { describe, expect, it } from "vitest";
import { CanadaPostApiError } from "../../src/index.js";
import { liveClient, liveEnabled } from "./env.js";

describe.skipIf(!liveEnabled)("Canada Post sandbox (read-only)", () => {
  it("runs against the development environment", () => {
    const client = liveClient();
    expect(client.environment).toBe("development");
    expect(client.baseUrl).toBe("https://ct.soa-gw.canadapost.ca");
  });

  it("rating.getRates quotes a domestic parcel", async () => {
    const { quotes } = await liveClient().rating.getRates({
      originPostalCode: "K2B8J6",
      destination: { type: "domestic", postalCode: "J0E1X0" },
      parcel: { weightKg: 1 },
    });
    expect(Array.isArray(quotes)).toBe(true);
    for (const quote of quotes) {
      expect(typeof quote.serviceCode).toBe("string");
    }
  });

  it("rating.discoverServices lists services for a destination country", async () => {
    const { services } = await liveClient().rating.discoverServices({ country: "US" });
    expect(Array.isArray(services)).toBe(true);
  });

  it("tracking.getSummary answers 'No Pin History' for the documented sandbox PIN", async () => {
    // Per the documentation, every sandbox tracking query answers "No Pin History", which the
    // SDK surfaces as a typed API error. A real summary is also accepted.
    try {
      const { pins } = await liveClient().tracking.getSummary({ pin: "123456789012" });
      expect(Array.isArray(pins)).toBe(true);
    } catch (err) {
      expect(err).toBeInstanceOf(CanadaPostApiError);
      expect((err as CanadaPostApiError).status).toBeGreaterThanOrEqual(400);
    }
  });
});
