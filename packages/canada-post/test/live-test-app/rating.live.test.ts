// LIVE TEST-APP suite: rating (quotes, service discovery, options).
//
// Every response is validated against Canada Post's OpenAPI schema, so a drift of the Test
// app's stubs fails here. Runs only with CANADAPOST_TEST_APP_LIVE=true.
import { beforeAll, describe, expect, it } from "vitest";
import { CanadaPostApiError } from "../../src/index.js";
import { expectValid, loadSpec, validateResponse } from "../support/openapi.js";
import { buildQuoteRequest } from "./data.js";
import { liveEnabled, testAppClient } from "./setup.js";

/**
 * KNOWN STUB DEVIATION (observed 2026-11-15): the Test app answers
 * `restrictions.dimensionalRestrictions.{length,width,height}` as `{ min, max }` although the
 * OpenAPI document says number. The deviation is pinned precisely: those three fields may be
 * a number or exactly `{ min: number, max: number }`; every other difference still fails.
 * Returns a copy with the objects replaced by their `max` so the document's schema applies.
 */
function normalizeKnownDeviation<T extends { restrictions: { dimensionalRestrictions: object } }>(
  service: T,
): unknown {
  const copy = structuredClone(service) as {
    restrictions: { dimensionalRestrictions: Record<string, unknown> };
  };
  const dims = copy.restrictions.dimensionalRestrictions;
  for (const key of ["length", "width", "height"]) {
    const value = dims[key];
    if (typeof value === "object" && value !== null) {
      expect(Object.keys(value).sort(), `${key} limit shape`).toEqual(["max", "min"]);
      const { min, max } = value as { min: unknown; max: unknown };
      expect(typeof min).toBe("number");
      expect(typeof max).toBe("number");
      dims[key] = max;
    }
  }
  return copy;
}

describe.skipIf(!liveEnabled)("Canada Post Test app: rating", () => {
  const rating = loadSpec("rating-v1");

  beforeAll(async () => {
    await testAppClient().assertTestApp();
  });

  it("getPrices returns a schema-valid quote list", async () => {
    const quotes = await testAppClient().rating.getPrices(buildQuoteRequest());
    expectValid("POST /prices", validateResponse(rating, "price", 200, quotes));
    expect(quotes.length).toBeGreaterThanOrEqual(1);
    for (const quote of quotes) {
      expect(quote.serviceCode).toMatch(/^[A-Z]+\.[A-Z0-9]+$/);
      expect(quote.priceDetails.due).toBeGreaterThan(0);
      expect(quote.priceDetails.due).toBeGreaterThanOrEqual(quote.priceDetails.base);
      expect(quote.serviceLink.href).toContain("/rating/v1/services/");
    }
  });

  it("getPrices works for retail (counter) quotes and for several services", async () => {
    const quotes = await testAppClient().rating.getPrices(
      buildQuoteRequest({ quoteType: "counter", services: ["DOM.RP", "DOM.EP"] }),
    );
    expectValid("POST /prices", validateResponse(rating, "price", 200, quotes));
    expect(quotes.length).toBeGreaterThanOrEqual(1);
  });

  it("getPrices answers the same stub for very different parcels (what assertTestApp relies on)", async () => {
    const small = await testAppClient().rating.getPrices(buildQuoteRequest());
    const large = await testAppClient().rating.getPrices(
      buildQuoteRequest({
        originPostalCode: "V6B1A1",
        destination: { domestic: { postalCode: "H3B1A1" } },
        parcelCharacteristics: { weight: 17.3, dimensions: { length: 60, width: 40, height: 30 } },
      }),
    );
    expect(large).toEqual(small);
  });

  it("listServices returns a schema-valid list", async () => {
    const services = await testAppClient().rating.listServices();
    expectValid("GET /services", validateResponse(rating, "service", 200, services));
    expect(services.length).toBeGreaterThanOrEqual(1);
    expect(services.every((s) => s.link.href.includes("/rating/v1/services/"))).toBe(true);
  });

  it("listServices accepts a country filter", async () => {
    const services = await testAppClient().rating.listServices({ country: "US" });
    expectValid("GET /services?country=US", validateResponse(rating, "service", 200, services));
  });

  it("getService returns schema-valid service details", async () => {
    const service = await testAppClient().rating.getService("DOM.RP");
    expectValid(
      "GET /services/{serviceCode}",
      validateResponse(rating, "serviceCode", 200, normalizeKnownDeviation(service)),
    );
    expect(service.restrictions.weightRestriction.max).toBeGreaterThan(
      service.restrictions.weightRestriction.min,
    );
  });

  it("getOption returns schema-valid option details", async () => {
    const option = await testAppClient().rating.getOption("DC");
    expectValid("GET /options/{optionCode}", validateResponse(rating, "optionCode", 200, option));
    expect(option.optionCode).toBe("DC");
  });

  it("follows a service link returned by listServices (only the Canada Post host is allowed)", async () => {
    const [first] = await testAppClient().rating.listServices();
    if (first === undefined) throw new Error("the Test app listed no services");
    const followed = await testAppClient().followLink(first.link);
    expect(followed.kind).toBe("json");
    if (followed.kind === "json") {
      expectValid(
        "service link",
        validateResponse(
          rating,
          "serviceCode",
          200,
          normalizeKnownDeviation(followed.body as Parameters<typeof normalizeKnownDeviation>[0]),
        ),
      );
    }
    await expect(
      testAppClient().followLink({
        rel: "service",
        href: "https://example.invalid/prod/devportal-portaildesdeveloppeurs/rating/v1/services",
        mediaType: "application/json",
      }),
    ).rejects.toMatchObject({ name: "CanadaPostConfigurationError" });
  });

  it("rejects a quote request that breaks the schema with a typed 400", async () => {
    const error = await testAppClient()
      // A valid postal code (the SDK checks that locally) but no parcel weight: the API refuses it.
      .rating.getPrices({ ...buildQuoteRequest(), parcelCharacteristics: {} } as never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanadaPostApiError);
    const api = error as CanadaPostApiError;
    expect(api.status).toBe(400);
    expect(api.isRetryable).toBe(false);
    expect(api.codes.length).toBeGreaterThan(0);
    expect(api.message).toMatch(/400/);
  });
});
