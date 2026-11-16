import { describe, expect, it } from "vitest";
import { CanadaPostParseError, CanadaPostValidationError } from "../src/index.js";
import {
  FAKE_OPTION,
  FAKE_QUOTES,
  FAKE_SERVICES,
  FAKE_SERVICE_DETAILS,
  RATING,
  TEST_CUSTOMER,
  bodyOf,
  fakePriceRequest,
  firstApi,
  json,
  makeRestClient,
} from "./support/rest.js";

describe("rating.getPrices", () => {
  it("POSTs the scenario and defaults customerNumber to the client's", async () => {
    const h = makeRestClient(json(FAKE_QUOTES));
    const quotes = await h.client.rating.getPrices(fakePriceRequest());
    const sent = firstApi(h);
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe(`${RATING}/prices`);
    expect(bodyOf(sent)).toEqual({ ...fakePriceRequest(), customerNumber: TEST_CUSTOMER });
    expect(quotes).toEqual(FAKE_QUOTES);
  });

  it("lets the caller override customerNumber and add a contract", async () => {
    const h = makeRestClient(json(FAKE_QUOTES));
    await h.client.rating.getPrices({
      ...fakePriceRequest(),
      customerNumber: "7654321",
      contractId: "0012345678",
      services: ["DOM.RP"],
    });
    expect(bodyOf(firstApi(h))).toMatchObject({
      customerNumber: "7654321",
      contractId: "0012345678",
      services: ["DOM.RP"],
    });
  });

  it("an explicit undefined customerNumber still falls back to the default", async () => {
    const h = makeRestClient(json(FAKE_QUOTES));
    await h.client.rating.getPrices({ ...fakePriceRequest(), customerNumber: undefined });
    expect(bodyOf(firstApi(h))).toMatchObject({ customerNumber: TEST_CUSTOMER });
  });

  it("a counter quote sends neither customerNumber nor contractId (production errorCode 9114)", async () => {
    const h = makeRestClient(json(FAKE_QUOTES));
    await h.client.rating.getPrices({ ...fakePriceRequest(), quoteType: "counter" });
    const body = bodyOf(firstApi(h));
    expect(body).toEqual({ ...fakePriceRequest(), quoteType: "counter" });
    expect(body).not.toHaveProperty("customerNumber");
    expect(body).not.toHaveProperty("contractId");
    // explicit undefined is "not passed"
    const h2 = makeRestClient(json(FAKE_QUOTES));
    await h2.client.rating.getPrices({
      ...fakePriceRequest(),
      quoteType: "counter",
      customerNumber: undefined,
      contractId: undefined,
    });
    expect(bodyOf(firstApi(h2))).not.toHaveProperty("customerNumber");
  });

  it("refuses a counter quote that carries customerNumber or contractId before any request", async () => {
    const h = makeRestClient(json(FAKE_QUOTES));
    for (const extra of [{ customerNumber: "7654321" }, { contractId: "0012345678" }]) {
      await expect(
        h.client.rating.getPrices({ ...fakePriceRequest(), quoteType: "counter", ...extra }),
      ).rejects.toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.mock.requests).toHaveLength(0);
  });

  it("a commercial quote still defaults customerNumber", async () => {
    const h = makeRestClient(json(FAKE_QUOTES));
    await h.client.rating.getPrices({ ...fakePriceRequest(), quoteType: "commercial" });
    expect(bodyOf(firstApi(h))).toMatchObject({
      quoteType: "commercial",
      customerNumber: TEST_CUSTOMER,
    });
  });

  it("rejects a malformed origin postal code before sending", async () => {
    const h = makeRestClient(json(FAKE_QUOTES));
    for (const originPostalCode of ["k1a0b1", "K1A 0B1", "K1A0B", "12345", ""]) {
      await expect(
        h.client.rating.getPrices({ ...fakePriceRequest(), originPostalCode }),
      ).rejects.toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.mock.requests).toHaveLength(0);
  });

  it("rejects a response that is not a list", async () => {
    const h = makeRestClient(json({ not: "a list" }));
    await expect(h.client.rating.getPrices(fakePriceRequest())).rejects.toBeInstanceOf(
      CanadaPostParseError,
    );
  });
});

describe("rating.listServices", () => {
  it("GETs /services without a query by default", async () => {
    const h = makeRestClient(json(FAKE_SERVICES));
    await expect(h.client.rating.listServices()).resolves.toEqual(FAKE_SERVICES);
    expect(firstApi(h).url).toBe(`${RATING}/services`);
  });

  it("passes country and contract", async () => {
    const h = makeRestClient(json(FAKE_SERVICES));
    await h.client.rating.listServices({ country: "US", contract: "0012345678" });
    expect(firstApi(h).url).toBe(`${RATING}/services?country=US&contract=0012345678`);
  });
});

describe("rating.getService / getOption", () => {
  it("GETs a service by code (dots allowed) with an optional country", async () => {
    const h = makeRestClient(json(FAKE_SERVICE_DETAILS));
    await expect(h.client.rating.getService("DOM.EP", { country: "CA" })).resolves.toEqual(
      FAKE_SERVICE_DETAILS,
    );
    expect(firstApi(h).url).toBe(`${RATING}/services/DOM.EP?country=CA`);
  });

  it("GETs an option by code", async () => {
    const h = makeRestClient(json(FAKE_OPTION));
    await expect(h.client.rating.getOption("DC")).resolves.toEqual(FAKE_OPTION);
    expect(firstApi(h).url).toBe(`${RATING}/options/DC`);
  });

  it("validates codes before putting them in a URL", async () => {
    const h = makeRestClient(json(FAKE_OPTION));
    for (const code of ["", "../x", "a/b", "a?b", "DOM..EP", ".DOM", "x".repeat(33)]) {
      await expect(h.client.rating.getService(code)).rejects.toBeInstanceOf(
        CanadaPostValidationError,
      );
      await expect(h.client.rating.getOption(code)).rejects.toBeInstanceOf(
        CanadaPostValidationError,
      );
    }
    expect(h.mock.requests).toHaveLength(0);
  });
});
