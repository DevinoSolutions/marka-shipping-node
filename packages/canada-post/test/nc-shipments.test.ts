import { describe, expect, it } from "vitest";
import {
  CanadaPostApiError,
  CanadaPostIndeterminateError,
  findLink,
  MEDIA_TYPES,
  type NcShipmentInput,
} from "../src/index.js";
import {
  FIXTURE_HOST,
  NC_CREATE_RESPONSE,
  NC_DETAILS_RESPONSE,
  NC_LIST_EMPTY,
  NC_LIST_RESPONSE,
  NC_RECEIPT_RESPONSE,
  NC_REFUND_RESPONSE,
} from "./fixtures.js";
import { expectedBasic, first, makeClient, TEST_CUSTOMER, xml } from "./helpers.js";

const NC = MEDIA_TYPES.ncShipment;

const INPUT: NcShipmentInput = {
  serviceCode: "DOM.EP",
  requestedShippingPoint: "h0h 0h0",
  sender: {
    company: "Example Sender & Sons <Ltd>",
    contactPhone: "555-555-5555",
    address: {
      addressLine1: "100 Example Street",
      city: "Exampleville",
      provState: "ON",
      postalZipCode: "a1a 1a1",
    },
  },
  destination: {
    name: 'Jane "JJ" Example',
    company: "Consumer",
    address: {
      addressLine1: "200 Sample Avenue",
      city: "Sampletown",
      provState: "ON",
      countryCode: "ca",
      postalZipCode: "b2b2b2",
    },
  },
  options: [{ code: "DC" }, { code: "COV", amount: 150.5 }],
  parcel: { weightKg: 15, dimensionsCm: { length: 1, width: 1, height: 1 } },
  preferences: { showPackingInstructions: true },
};

describe("ncShipments.create", () => {
  it("POSTs an escaped non-contract-shipment body with ncshipment-v4 headers", async () => {
    const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, NC));
    await client.ncShipments.create(INPUT);
    const req = first(mock);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/ncshipment`);
    expect(req.headers["accept"]).toBe("application/vnd.cpc.ncshipment-v4+xml");
    expect(req.headers["content-type"]).toBe("application/vnd.cpc.ncshipment-v4+xml");
    expect(req.headers["authorization"]).toBe(expectedBasic());
    expect(req.headers["x-cpc-zonos-key"]).toBeUndefined();
    const body = req.body ?? "";
    expect(
      body.startsWith(
        '<?xml version="1.0" encoding="utf-8"?><non-contract-shipment xmlns="http://www.canadapost.ca/ws/ncshipment-v4">',
      ),
    ).toBe(true);
    expect(body).toContain("<requested-shipping-point>H0H0H0</requested-shipping-point>");
    expect(body).toContain("<company>Example Sender &amp; Sons &lt;Ltd&gt;</company>");
    expect(body).toContain("<name>Jane &quot;JJ&quot; Example</name>");
    expect(body).toContain("<postal-zip-code>A1A1A1</postal-zip-code>");
    expect(body).toContain("<country-code>CA</country-code>");
    expect(body).toContain(
      "<option><option-code>COV</option-code><option-amount>150.5</option-amount></option>",
    );
    expect(body).toContain("<weight>15</weight>");
    expect(body).toContain(
      "<preferences><show-packing-instructions>true</show-packing-instructions></preferences>",
    );
    expect(body).not.toContain("settlement-info");
    expect(body).not.toContain("<notification>");
  });

  it("sends the Zonos key as a header, never in the body", async () => {
    const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, NC));
    await client.ncShipments.create({ ...INPUT, zonosKey: "zonos-test-key" });
    expect(first(mock).headers["x-cpc-zonos-key"]).toBe("zonos-test-key");
    expect(first(mock).body).not.toContain("zonos-test-key");
  });

  it("builds customs, notification, references and promo code", async () => {
    const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, NC));
    await client.ncShipments.create({
      ...INPUT,
      serviceCode: "USA.TP",
      destination: {
        name: "Jane Example",
        clientVoiceNumber: "+15555550100",
        address: {
          addressLine1: "1 Main St",
          city: "Springfield",
          provState: "IL",
          countryCode: "US",
          postalZipCode: "62701",
        },
      },
      notification: {
        email: "jane@example.com",
        onShipment: true,
        onException: false,
        onDelivery: true,
      },
      references: { customerRef1: "order-7" },
      promoCode: "DEVPROTEST",
      customs: {
        currency: "USD",
        conversionFromCad: 0.75,
        reasonForExport: "SOG",
        items: [
          {
            customsDescription: "Widget",
            unitWeightKg: 0.25,
            customsValuePerUnit: 12.5,
            customsNumberOfUnits: 2,
            hsTariffCode: "8471.30",
            countryOfOrigin: "CA",
            provinceOfOrigin: "ON",
          },
        ],
      },
    });
    const body = first(mock).body ?? "";
    expect(body).toContain("<client-voice-number>+15555550100</client-voice-number>");
    expect(body).toContain("<postal-zip-code>62701</postal-zip-code>");
    expect(body).toContain(
      "<notification><email>jane@example.com</email><on-shipment>true</on-shipment><on-exception>false</on-exception><on-delivery>true</on-delivery></notification>",
    );
    expect(body).toContain("<references><customer-ref-1>order-7</customer-ref-1></references>");
    expect(body).toContain(
      "<settlement-info><promo-code>DEVPROTEST</promo-code></settlement-info>",
    );
    expect(body).toContain("<conversion-from-cad>0.75</conversion-from-cad>");
    expect(body).toContain("<customs-number-of-units>2</customs-number-of-units>");
    expect(body).toContain("<customs-value-per-unit>12.5</customs-value-per-unit>");
    expect(body).toContain("<hs-tariff-code>8471.30</hs-tariff-code>");
  });

  it("parses the shipment id, PIN and links (object-or-array tolerant)", async () => {
    const { client } = makeClient(xml(NC_CREATE_RESPONSE, NC));
    const info = await client.ncShipments.create(INPUT);
    expect(info.shipmentId).toBe("406951321983787352");
    expect(info.trackingPin).toBe("123456789012");
    expect(info.links.map((l) => l.rel)).toEqual(["self", "details", "receipt", "refund", "label"]);
    const label = findLink(info.links, "label");
    expect(label).toMatchObject({ mediaType: "application/pdf", index: 0 });
    expect(label?.href).toBe(`${FIXTURE_HOST}/rs/artifact/76108cb5192002d5/10238/0`);
  });

  it("parses a response with exactly one link", async () => {
    const one = `<non-contract-shipment-info><shipment-id>1</shipment-id><links><link rel="self" href="${FIXTURE_HOST}/rs/1/ncshipment/1" media-type="${NC}"/></links></non-contract-shipment-info>`;
    const { client } = makeClient(xml(one, NC));
    const info = await client.ncShipments.create(INPUT);
    expect(info.links).toHaveLength(1);
    expect(info.trackingPin).toBeUndefined();
  });

  it("throws CanadaPostApiError for a business-rule rejection", async () => {
    const { client } = makeClient(
      xml(
        "<messages><message><code>7289</code><description>The selected service is not valid for the specified customer and/or contract.</description></message></messages>",
        NC,
        400,
      ),
    );
    await expect(client.ncShipments.create(INPUT)).rejects.toMatchObject({
      code: "7289",
      status: 400,
    });
  });

  it("is INDETERMINATE on timeout and tells the caller how to check", async () => {
    const { client, mock } = makeClient({ hang: true }, { timeoutMs: 20 });
    const err = await client.ncShipments.create(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostIndeterminateError);
    const ind = err as CanadaPostIndeterminateError;
    expect(ind.reason).toBe("timeout");
    expect(ind.message).toContain("INDETERMINATE");
    expect(ind.message).toContain("ncShipments.list");
    expect(mock.requests).toHaveLength(1);
  });

  it("is INDETERMINATE on a dropped connection and on gateway errors, and is never retried", async () => {
    const net = makeClient({ error: new TypeError("socket hang up") });
    const e1 = (await net.client.ncShipments
      .create(INPUT)
      .catch((e: unknown) => e)) as CanadaPostIndeterminateError;
    expect(e1).toBeInstanceOf(CanadaPostIndeterminateError);
    expect(e1.reason).toBe("network");
    expect(net.mock.requests).toHaveLength(1);

    const gw = makeClient({ status: 504, body: "<html>Gateway Time-out</html>" });
    const e2 = (await gw.client.ncShipments
      .create(INPUT)
      .catch((e: unknown) => e)) as CanadaPostIndeterminateError;
    expect(e2).toBeInstanceOf(CanadaPostIndeterminateError);
    expect(e2.reason).toBe("gateway");
    expect(e2.status).toBe(504);
    expect(gw.mock.requests).toHaveLength(1);
  });

  it("treats other 5xx on a POST as a normal API error (and does not retry)", async () => {
    const { client, mock } = makeClient({ status: 500, body: "" });
    const err = await client.ncShipments.create(INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostApiError);
    expect(mock.requests).toHaveLength(1);
  });
});

describe("ncShipments reads", () => {
  it("get / getDetails / getReceipt build ids into the documented paths", async () => {
    const { client, mock } = makeClient((_r, i) =>
      i === 0
        ? xml(NC_CREATE_RESPONSE, NC)
        : i === 1
          ? xml(NC_DETAILS_RESPONSE, NC)
          : xml(NC_RECEIPT_RESPONSE, NC),
    );
    await client.ncShipments.get("406951321983787352");
    const details = await client.ncShipments.getDetails("406951321983787352");
    const receipt = await client.ncShipments.getReceipt("406951321983787352");
    const base = `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/ncshipment/406951321983787352`;
    expect(mock.requests.map((r) => [r.method, r.url])).toEqual([
      ["GET", base],
      ["GET", `${base}/details`],
      ["GET", `${base}/receipt`],
    ]);
    expect(details.finalShippingPoint).toBe("H0H0H0");
    expect(details.deliverySpec.serviceCode).toBe("DOM.EP");
    expect(details.deliverySpec.sender?.address.postalZipCode).toBe("A1A1A1");
    expect(details.deliverySpec.destination?.name).toBe("Jane Example");
    expect(details.deliverySpec.parcel.weightKg).toBe(15);
    expect(details.deliverySpec.parcel.dimensionsCm).toEqual({ length: 1, width: 1, height: 1 });
    expect(details.deliverySpec.options.map((o) => o.code)).toEqual(["DC"]);
    expect(receipt.baseAmount).toBe(18.1);
    expect(receipt.hstAmount).toBe(2.53);
    expect(receipt.pricedOptions).toEqual([{ code: "DC", price: 0 }]);
    expect(receipt.adjustments).toEqual([{ code: "FUELSC", amount: 1.36 }]);
    expect(receipt.creditCard?.chargeAmount).toBe(21.99);
    expect(receipt.creditCard?.cardType).toBe("VIS");
    expect(receipt.serviceStandard.expectedTransitTimeDays).toBe(1);
  });

  it("follows a returned link with the link's media type", async () => {
    const { client, mock } = makeClient(xml(NC_DETAILS_RESPONSE, NC));
    await client.ncShipments.getDetails({
      rel: "details",
      href: `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/ncshipment/406951321983787352/details`,
      mediaType: NC,
      index: undefined,
    });
    expect(first(mock).headers["accept"]).toBe(NC);
  });

  it("list sends Eastern-time compact dates from Date objects or strings", async () => {
    const { client, mock } = makeClient(xml(NC_LIST_RESPONSE, NC));
    const list = await client.ncShipments.list({
      from: new Date("2030-01-15T15:30:00Z"),
      to: "203001151700",
    });
    // 15:30Z is 10:30 in America/Toronto (EST, UTC-5) on that date.
    expect(first(mock).url).toBe(
      `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/ncshipment?from=203001151030&to=203001151700`,
    );
    expect(list.links).toHaveLength(1);
    expect(list.shipmentIds).toEqual(["406951321983787352"]);
  });

  it("list by tracking PIN, and an empty result is an empty list", async () => {
    const { client, mock } = makeClient(xml(NC_LIST_EMPTY, NC));
    const list = await client.ncShipments.list({ trackingPin: "123456789012" });
    expect(first(mock).url).toBe(
      `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/ncshipment?trackingPIN=123456789012`,
    );
    expect(list.links).toEqual([]);
  });

  it("rejects a malformed date range", async () => {
    const { client } = makeClient(xml(NC_LIST_EMPTY, NC));
    await expect(client.ncShipments.list({ from: "2030-01-15" })).rejects.toThrow(/YYYYMMDDHHMM/);
  });
});

describe("ncShipments.requestRefund", () => {
  it("POSTs an escaped refund request to the refund link", async () => {
    const { client, mock } = makeClient(xml(NC_REFUND_RESPONSE, NC));
    const ticket = await client.ncShipments.requestRefund(
      {
        rel: "refund",
        href: `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/ncshipment/406951321983787352/refund`,
        mediaType: NC,
        index: undefined,
      },
      { email: "name+tag@example.ca" },
    );
    const req = first(mock);
    expect(req.method).toBe("POST");
    expect(req.headers["content-type"]).toBe(NC);
    expect(req.body).toBe(
      '<?xml version="1.0" encoding="utf-8"?><non-contract-shipment-refund-request xmlns="http://www.canadapost.ca/ws/ncshipment-v4"><email>name+tag@example.ca</email></non-contract-shipment-refund-request>',
    );
    expect(ticket).toEqual({ serviceTicketDate: "2015-10-28", serviceTicketId: "GT12345678RT" });
  });

  it("uses the constructed refund path for a bare id", async () => {
    const { client, mock } = makeClient(xml(NC_REFUND_RESPONSE, NC));
    await client.ncShipments.requestRefund("406951321983787352", { email: "a@example.ca" });
    expect(first(mock).url).toBe(
      `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/ncshipment/406951321983787352/refund`,
    );
  });

  it("is INDETERMINATE on timeout", async () => {
    const { client } = makeClient({ hang: true }, { timeoutMs: 20 });
    await expect(
      client.ncShipments.requestRefund("406951321983787352", { email: "a@example.ca" }),
    ).rejects.toBeInstanceOf(CanadaPostIndeterminateError);
  });
});
