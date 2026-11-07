import { describe, expect, it } from "vitest";
import {
  type CanadaPostApiError,
  CanadaPostConfigurationError,
  MEDIA_TYPES,
} from "../src/index.js";
import {
  DISCOVER_RESPONSE,
  OPTION_RESPONSE,
  RATES_RESPONSE,
  RATES_RESPONSE_SINGLE,
  SERVICE_RESPONSE,
  FIXTURE_HOST,
} from "./fixtures.js";
import { first, makeClient, TEST_CONTRACT, TEST_CUSTOMER, xml } from "./helpers.js";

const INPUT = {
  originPostalCode: "k2b 8j6",
  destination: { type: "domestic", postalCode: "j0e 1x0" },
  parcel: { weightKg: 1 },
} as const;

describe("rating.getRates", () => {
  it("POSTs the mailing-scenario to /rs/ship/price", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating));
    await client.rating.getRates(INPUT);
    const req = first(mock);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${FIXTURE_HOST}/rs/ship/price`);
    expect(req.body).toBe(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<mailing-scenario xmlns="http://www.canadapost.ca/ws/ship/rate-v4">' +
        `<customer-number>${TEST_CUSTOMER}</customer-number>` +
        "<parcel-characteristics><weight>1</weight></parcel-characteristics>" +
        "<origin-postal-code>K2B8J6</origin-postal-code>" +
        "<destination><domestic><postal-code>J0E1X0</postal-code></domestic></destination>" +
        "</mailing-scenario>",
    );
  });

  it("includes contract id, services, options, dimensions and the other destinations", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating), {
      contractId: TEST_CONTRACT,
    });
    await client.rating.getRates({
      originPostalCode: "K2B8J6",
      destination: { type: "united-states", zipCode: "90210" },
      parcel: {
        weightKg: 2.25,
        dimensionsCm: { length: 30, width: 20.5, height: 10 },
        mailingTube: false,
      },
      serviceCodes: ["USA.XP", "USA.EP"],
      options: [{ code: "COV", amount: 100 }, { code: "SO" }],
      promoCode: "SAVE&10",
      expectedMailingDate: "2030-01-02",
    });
    const body = first(mock).body ?? "";
    expect(body).toContain(`<contract-id>${TEST_CONTRACT}</contract-id>`);
    expect(body).toContain("<promo-code>SAVE&amp;10</promo-code>");
    expect(body).toContain("<weight>2.25</weight>");
    expect(body).toContain(
      "<dimensions><length>30</length><width>20.5</width><height>10</height></dimensions>",
    );
    expect(body).toContain("<mailing-tube>false</mailing-tube>");
    expect(body).toContain(
      "<services><service-code>USA.XP</service-code><service-code>USA.EP</service-code></services>",
    );
    expect(body).toContain(
      "<option><option-code>COV</option-code><option-amount>100</option-amount></option>",
    );
    expect(body).toContain(
      "<destination><united-states><zip-code>90210</zip-code></united-states></destination>",
    );
    expect(body).toContain("<expected-mailing-date>2030-01-02</expected-mailing-date>");
  });

  it("builds an international destination and omits customer data for counter quotes", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating), {
      contractId: TEST_CONTRACT,
    });
    await client.rating.getRates({
      originPostalCode: "K2B8J6",
      destination: { type: "international", countryCode: "jp" },
      parcel: { weightKg: 0.5 },
      quoteType: "counter",
    });
    const body = first(mock).body ?? "";
    expect(body).not.toContain("customer-number");
    expect(body).not.toContain("contract-id");
    expect(body).toContain("<quote-type>counter</quote-type>");
    expect(body).toContain(
      "<destination><international><country-code>JP</country-code></international></destination>",
    );
  });

  it("parses quotes, money as numbers, nested lists and delivery standards", async () => {
    const { client } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating));
    const { quotes, raw } = await client.rating.getRates(INPUT);
    expect(quotes.map((q) => q.serviceCode)).toEqual(["DOM.EP", "DOM.RP"]);
    const ep = quotes[0];
    expect(ep?.serviceName).toBe("Expedited Parcel");
    expect(ep?.priceDetails.base).toBe(9.59);
    expect(ep?.priceDetails.due).toBe(10.21);
    expect(ep?.priceDetails.taxes).toEqual({ gst: 0, pst: 0, hst: 0 });
    expect(ep?.priceDetails.adjustments).toEqual([
      { code: "AUTDISC", name: "Automation discount", cost: -0.29, percent: 3 },
      { code: "FUELSC", name: "Fuel surcharge", cost: 0.91, percent: 9.75 },
    ]);
    expect(ep?.serviceStandard).toEqual({
      amDelivery: false,
      guaranteedDelivery: true,
      expectedTransitTimeDays: 2,
      expectedDeliveryDate: "2011-10-24",
    });
    expect(ep?.serviceLink).toEqual({
      rel: "service",
      href: `${FIXTURE_HOST}/rs/ship/service/DOM.EP?country=CA`,
      mediaType: MEDIA_TYPES.rating,
      index: undefined,
    });
    expect(quotes[1]?.priceDetails.options[0]?.included).toBe(true);
    expect(quotes[1]?.cubedWeight).toBe(1.5);
    expect(raw).toBeTypeOf("object");
  });

  it("normalises a response with a single quote / option / adjustment", async () => {
    const { client } = makeClient(xml(RATES_RESPONSE_SINGLE, MEDIA_TYPES.rating));
    const { quotes } = await client.rating.getRates(INPUT);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.priceDetails.options).toHaveLength(1);
    expect(quotes[0]?.priceDetails.adjustments).toHaveLength(1);
  });

  it("returns an empty list for an empty price-quotes element", async () => {
    const { client } = makeClient(xml("<price-quotes/>", MEDIA_TYPES.rating));
    expect((await client.rating.getRates(INPUT)).quotes).toEqual([]);
  });

  it("surfaces business-rule errors (code 9111)", async () => {
    const { client } = makeClient(
      xml(
        "<messages><message><code>9111</code><description>No services are appropriate for the shipment of the defined parcel.</description></message></messages>",
        MEDIA_TYPES.rating,
        400,
      ),
    );
    const err = (await client.rating
      .getRates(INPUT)
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(err.code).toBe("9111");
  });

  it("validates inputs before sending anything", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating));
    await expect(client.rating.getRates({ ...INPUT, parcel: { weightKg: 0 } })).rejects.toThrow(
      /weightKg/,
    );
    await expect(
      client.rating.getRates({
        ...INPUT,
        serviceCodes: Array.from({ length: 21 }, () => "DOM.RP"),
      }),
    ).rejects.toThrow(/at most 20/);
    expect(mock.requests).toHaveLength(0);
  });
});

describe("rating.discoverServices", () => {
  it("GETs /rs/ship/service with only the supplied query parameters", async () => {
    const { client, mock } = makeClient(xml(DISCOVER_RESPONSE, MEDIA_TYPES.rating));
    const res = await client.rating.discoverServices({
      country: "jp",
      originPostalCode: "k2b 8j6",
      destinationPostalCode: "j0e 1x0",
    });
    const req = first(mock);
    expect(req.method).toBe("GET");
    expect(req.url).toBe(`${FIXTURE_HOST}/rs/ship/service?country=JP&origpc=K2B8J6&destpc=J0E1X0`);
    expect(req.headers["accept"]).toBe(MEDIA_TYPES.rating);
    expect(res.services.map((s) => s.serviceCode)).toEqual(["INT.XP", "INT.SP.SURF"]);
    expect(res.services[0]?.link?.rel).toBe("service");
  });

  it("uses the configured contract id by default", async () => {
    const { client, mock } = makeClient(xml(DISCOVER_RESPONSE, MEDIA_TYPES.rating), {
      contractId: TEST_CONTRACT,
    });
    await client.rating.discoverServices();
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/rs/ship/service?contract=${TEST_CONTRACT}`);
  });
});

describe("rating.getService / getOption", () => {
  it("builds the service URL from a code and parses restrictions", async () => {
    const { client, mock } = makeClient(xml(SERVICE_RESPONSE, MEDIA_TYPES.rating));
    const svc = await client.rating.getService("INT.XP", { country: "jp" });
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/rs/ship/service/INT.XP?country=JP`);
    expect(svc.serviceName).toBe("Xpresspost International");
    expect(svc.options.map((o) => o.code)).toEqual(["COV", "DC"]);
    expect(svc.options[0]).toMatchObject({
      mandatory: false,
      qualifierRequired: true,
      qualifierMax: 1000,
    });
    expect(svc.options[0]?.link?.href).toBe(`${FIXTURE_HOST}/rs/ship/option/COV`);
    expect(svc.restrictions.weightGrams).toEqual({ min: 0, max: 30000 });
    expect(svc.restrictions.length).toEqual({ min: 0.1, max: 150 });
    expect(svc.restrictions.lengthPlusGirthMax).toBe(300);
    expect(svc.restrictions.densityFactor).toBe(6000);
    expect(svc.restrictions.canShipInMailingTube).toBe(true);
    expect(svc.restrictions.canShipUnpackaged).toBe(false);
  });

  it("follows a link with its own media type", async () => {
    const { client, mock } = makeClient(xml(SERVICE_RESPONSE, MEDIA_TYPES.rating));
    await client.rating.getService({
      rel: "service",
      href: `${FIXTURE_HOST}/rs/ship/service/DOM.EP?country=CA`,
      mediaType: "application/vnd.cpc.ship.rate-v4+xml",
      index: undefined,
    });
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/rs/ship/service/DOM.EP?country=CA`);
    expect(first(mock).headers["accept"]).toBe("application/vnd.cpc.ship.rate-v4+xml");
  });

  it("refuses links that leave the environment host (credentials would leak)", async () => {
    const { client, mock } = makeClient(xml(SERVICE_RESPONSE, MEDIA_TYPES.rating));
    await expect(
      client.rating.getService({
        rel: "service",
        href: "https://evil.example.com/rs/ship/service/DOM.EP",
        mediaType: undefined,
        index: undefined,
      }),
    ).rejects.toBeInstanceOf(CanadaPostConfigurationError);
    await expect(
      client.rating.getService("http://ct.soa-gw.canadapost.ca/x"),
    ).rejects.toBeInstanceOf(CanadaPostConfigurationError);
    expect(mock.requests).toHaveLength(0);
  });

  it("rejects ids that could alter the URL path", async () => {
    const { client } = makeClient(xml(SERVICE_RESPONSE, MEDIA_TYPES.rating));
    await expect(client.rating.getService("../../x")).rejects.toThrow(/service code/);
  });

  it("parses option prerequisites and conflicts (single and multiple codes)", async () => {
    const { client, mock } = makeClient(xml(OPTION_RESPONSE, MEDIA_TYPES.rating));
    const opt = await client.rating.getOption("SO");
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/rs/ship/option/SO`);
    expect(opt).toMatchObject({
      optionCode: "SO",
      optionClass: "FEAT",
      printsOnLabel: true,
      qualifierRequired: false,
      conflictingOptions: ["LAD"],
      prerequisiteOptions: ["DC", "XX"],
    });
  });
});
