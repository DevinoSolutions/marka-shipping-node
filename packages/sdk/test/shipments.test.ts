import { describe, expect, it } from "vitest";
import {
  CanadaPostApiError,
  CanadaPostIndeterminateError,
  findLink,
  MEDIA_TYPES,
  type ShipmentInput,
} from "../src/index.js";
import {
  FIXTURE_HOST,
  GROUPS_MULTI,
  GROUPS_SINGLE,
  SHIPMENT_CREATE_RESPONSE,
  SHIPMENT_CREATE_TRANSMITTED,
  SHIPMENT_DETAILS_RESPONSE,
  SHIPMENT_PRICE_RESPONSE,
  SHIPMENT_RECEIPT_RESPONSE,
  SHIPMENTS_RESPONSE,
  TRANSMIT_RESPONSE,
} from "./fixtures.js";
import { expectedBasic, first, makeClient, TEST_CONTRACT, TEST_CUSTOMER, xml } from "./helpers.js";

const SH = MEDIA_TYPES.shipment;
const PREFIX = `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/${TEST_CUSTOMER}`;

const INPUT: ShipmentInput = {
  customerRequestId: "order-1001",
  groupId: "grp1",
  requestedShippingPoint: "k2b 8j6",
  cpcPickupIndicator: true,
  serviceCode: "DOM.EP",
  sender: {
    name: "Sam Sender",
    company: "Example & Co",
    contactPhone: "1 (450) 555-0100",
    address: {
      addressLine1: "100 Example Street",
      city: "Exampleville",
      provState: "QC",
      postalZipCode: "a1a1a1",
    },
  },
  destination: {
    name: "Jane Example",
    company: "Example Co",
    address: {
      addressLine1: "200 Sample Avenue",
      city: "Sampletown",
      provState: "ON",
      postalZipCode: "b2b2b2",
    },
  },
  options: [{ code: "DC" }],
  parcel: { weightKg: 20, dimensionsCm: { length: 6, width: 12, height: 9 }, mailingTube: false },
  notification: {
    email: "buyer@example.com",
    onShipment: true,
    onException: false,
    onDelivery: true,
  },
  print: { outputFormat: "8.5x11" },
  preferences: { showPackingInstructions: true, showPostageRate: false, showInsuredValue: true },
};

describe("shipments.create", () => {
  it("POSTs shipment-v8 to /rs/{customer}/{mobo}/shipment with a full body", async () => {
    const { client, mock } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, SH), {
      contractId: TEST_CONTRACT,
    });
    await client.shipments.create(INPUT);
    const req = first(mock);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${PREFIX}/shipment`);
    expect(req.headers["accept"]).toBe("application/vnd.cpc.shipment-v8+xml");
    expect(req.headers["content-type"]).toBe("application/vnd.cpc.shipment-v8+xml");
    expect(req.headers["authorization"]).toBe(expectedBasic());
    const body = req.body ?? "";
    expect(body).toContain('<shipment xmlns="http://www.canadapost.ca/ws/shipment-v8">');
    expect(body).toContain("<customer-request-id>order-1001</customer-request-id>");
    expect(body).toContain("<group-id>grp1</group-id>");
    expect(body).not.toContain("transmit-shipment");
    expect(body).toContain("<requested-shipping-point>K2B8J6</requested-shipping-point>");
    expect(body).toContain("<cpc-pickup-indicator>true</cpc-pickup-indicator>");
    expect(body).toContain("<company>Example &amp; Co</company>");
    expect(body).toContain(
      "<print-preferences><output-format>8.5x11</output-format></print-preferences>",
    );
    expect(body).toContain(
      `<settlement-info><contract-id>${TEST_CONTRACT}</contract-id><intended-method-of-payment>Account</intended-method-of-payment></settlement-info>`,
    );
  });

  it("defaults to CreditCard settlement when no contract is configured", async () => {
    const { client, mock } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, SH));
    await client.shipments.create(INPUT);
    const body = first(mock).body ?? "";
    expect(body).toContain("<intended-method-of-payment>CreditCard</intended-method-of-payment>");
    expect(body).not.toContain("<contract-id>");
  });

  it("supports transmitShipment with price and receipt, and parses them", async () => {
    const { client, mock } = makeClient(xml(SHIPMENT_CREATE_TRANSMITTED, SH));
    const info = await client.shipments.create({
      ...INPUT,
      groupId: undefined,
      transmitShipment: true,
      provideShipmentPrice: true,
      provideReceipt: true,
      print: { outputFormat: "4x6", encoding: "ZPL" },
    });
    const body = first(mock).body ?? "";
    expect(body).toContain("<transmit-shipment>true</transmit-shipment>");
    expect(body).not.toContain("<group-id>");
    expect(body).toContain("<provide-pricing-info>true</provide-pricing-info>");
    expect(body).toContain("<encoding>ZPL</encoding>");
    expect(info.shipmentStatus).toBe("transmitted");
    expect(info.poNumber).toBe("P123456789");
    expect(info.price?.dueAmount).toBe(10.21);
    expect(info.price?.serviceStandard.expectedTransitTimeDays).toBe(2);
    expect(info.receipt?.creditCard?.chargeAmount).toBe(10.21);
    expect(findLink(info.links, "label")?.mediaType).toBe("application/zpl");
    expect(findLink(info.links, "refund")).toBeDefined();
  });

  it("parses ids, status, PIN and links", async () => {
    const { client } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, SH));
    const info = await client.shipments.create(INPUT);
    expect(info).toMatchObject({
      customerRequestId: "order-1001",
      shipmentId: "347881315405043891",
      shipmentStatus: "created",
      trackingPin: "123456789012",
    });
    expect(info.links.map((l) => l.rel)).toEqual(["self", "details", "group", "price", "label"]);
  });

  it("validates group/transmit, shipping point and ZPL rules before sending", async () => {
    const { client, mock } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, SH));
    await expect(client.shipments.create({ ...INPUT, groupId: undefined })).rejects.toThrow(
      /exactly one/,
    );
    await expect(client.shipments.create({ ...INPUT, transmitShipment: true })).rejects.toThrow(
      /exactly one/,
    );
    await expect(client.shipments.create({ ...INPUT, shippingPointId: "0015" })).rejects.toThrow(
      /mutually exclusive/,
    );
    await expect(client.shipments.create({ ...INPUT, print: { encoding: "ZPL" } })).rejects.toThrow(
      /4x6/,
    );
    await expect(
      client.shipments.create({ ...INPUT, customerRequestId: "x".repeat(36) }),
    ).rejects.toThrow(/35/);
    expect(mock.requests).toHaveLength(0);
  });

  it("maps an application error delivered with HTTP 200", async () => {
    const { client } = makeClient(
      xml(
        "<messages><message><code>7314</code><description>Request ID already exists; it must be unique when provided.</description></message></messages>",
        SH,
        200,
      ),
    );
    const err = (await client.shipments
      .create(INPUT)
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(err).toBeInstanceOf(CanadaPostApiError);
    expect(err.status).toBe(200);
    expect(err.code).toBe("7314");
  });

  it("a timed-out create is INDETERMINATE, mentions list/requestId, and is never retried", async () => {
    const { client, mock } = makeClient({ hang: true }, { timeoutMs: 20, retries: 5 });
    const err = (await client.shipments
      .create(INPUT)
      .catch((e: unknown) => e)) as CanadaPostIndeterminateError;
    expect(err).toBeInstanceOf(CanadaPostIndeterminateError);
    expect(err.reason).toBe("timeout");
    expect(err.message).toMatch(/INDETERMINATE/);
    expect(err.message).toMatch(/shipments\.list\(\{ requestId \}\)/);
    expect(err.message).toMatch(/charged|billed/);
    expect(err.request.operation).toBe("shipments.create");
    expect(mock.requests).toHaveLength(1);
  });

  it("a dropped connection and a 502/503/504 are INDETERMINATE too", async () => {
    for (const status of [502, 503, 504]) {
      const { client, mock } = makeClient({ status, body: "" });
      const err = await client.shipments.create(INPUT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CanadaPostIndeterminateError);
      expect(mock.requests).toHaveLength(1);
    }
    const { client } = makeClient({ error: new TypeError("terminated") });
    await expect(client.shipments.create(INPUT)).rejects.toBeInstanceOf(
      CanadaPostIndeterminateError,
    );
  });

  it("sends the Zonos key header", async () => {
    const { client, mock } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, SH));
    await client.shipments.create({ ...INPUT, zonosKey: "zonos-test-key" });
    expect(first(mock).headers["x-cpc-zonos-key"]).toBe("zonos-test-key");
  });
});

describe("shipments reads", () => {
  it("get / getDetails / getPrice / getReceipt use the documented paths", async () => {
    const { client, mock } = makeClient((_r, i) =>
      i === 0
        ? xml(SHIPMENT_CREATE_RESPONSE, SH)
        : i === 1
          ? xml(SHIPMENT_DETAILS_RESPONSE, SH)
          : i === 2
            ? xml(SHIPMENT_PRICE_RESPONSE, SH)
            : xml(SHIPMENT_RECEIPT_RESPONSE, SH),
    );
    await client.shipments.get("347881315405043891");
    const details = await client.shipments.getDetails("347881315405043891");
    const price = await client.shipments.getPrice("347881315405043891");
    const receipt = await client.shipments.getReceipt("347881315405043891");
    const base = `${PREFIX}/shipment/347881315405043891`;
    expect(mock.requests.map((r) => [r.method, r.url])).toEqual([
      ["GET", base],
      ["GET", `${base}/details`],
      ["GET", `${base}/price`],
      ["GET", `${base}/receipt`],
    ]);
    expect(details).toMatchObject({
      shipmentStatus: "reconciled",
      finalShippingPoint: "H0H0H0",
      shippingPointId: "0015",
      groupId: "grp1",
      expectedMailingDate: "2011-09-01",
    });
    expect(details.deliverySpec.settlement).toEqual({
      paidByCustomer: "0001234567",
      contractId: "0012345678",
      intendedMethodOfPayment: "Account",
      promoCode: undefined,
    });
    expect(details.deliverySpec.notification?.onDelivery).toBe(true);
    expect(details.deliverySpec.printPreferences.outputFormat).toBe("8.5x11");
    expect(details.deliverySpec.parcel.unpackaged).toBe(true);
    expect(price.dueAmount).toBe(19.88);
    expect(price.pricedOptions).toEqual([
      { code: "DC", price: 0 },
      { code: "UP", price: 7.5 },
    ]);
    // The documentation spells it expected-transmit-time; both spellings are read.
    expect(price.serviceStandard.expectedTransitTimeDays).toBe(2);
    expect(receipt.creditCard?.cardType).toBe("VIS");
  });
});

describe("shipments.void", () => {
  it("DELETEs the self link, accepts HTTP 204 and does not retry", async () => {
    const { client, mock } = makeClient({ status: 204 });
    await expect(
      client.shipments.void({
        rel: "self",
        href: `${PREFIX}/shipment/347881315405043891`,
        mediaType: SH,
        index: undefined,
      }),
    ).resolves.toBeUndefined();
    expect(first(mock).method).toBe("DELETE");
    expect(first(mock).url).toBe(`${PREFIX}/shipment/347881315405043891`);
    expect(first(mock).headers["accept"]).toBe(SH);
  });

  it("maps 'already transmitted' (8064) to an API error", async () => {
    const { client } = makeClient(
      xml(
        "<messages><message><code>8064</code><description>A shipment can only be void if it is in a PROCESSED or PRINTED state.</description></message></messages>",
        SH,
        400,
      ),
    );
    await expect(client.shipments.void("347881315405043891")).rejects.toMatchObject({
      code: "8064",
    });
  });

  it("is INDETERMINATE on timeout", async () => {
    const { client } = makeClient({ hang: true }, { timeoutMs: 20 });
    await expect(client.shipments.void("347881315405043891")).rejects.toBeInstanceOf(
      CanadaPostIndeterminateError,
    );
  });
});

describe("shipments.transmit", () => {
  it("POSTs a transmit-set with manifest-v8 headers and returns manifest links", async () => {
    const { client, mock } = makeClient(xml(TRANSMIT_RESPONSE, MEDIA_TYPES.manifest), {
      contractId: TEST_CONTRACT,
    });
    const res = await client.shipments.transmit({
      groupIds: ["1234", "5&6"],
      requestedShippingPoint: "k1k 4t3",
      cpcPickupIndicator: true,
      manifestAddress: {
        name: "Example Shop",
        company: "my company",
        phoneNumber: "555 555 5555",
        address: {
          addressLine1: "1230 Example Rd.",
          city: "Exampleville",
          provState: "ON",
          postalZipCode: "a1a 1a1",
        },
      },
      excludedShipmentIds: ["999"],
    });
    const req = first(mock);
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${PREFIX}/manifest`);
    expect(req.headers["accept"]).toBe("application/vnd.cpc.manifest-v8+xml");
    expect(req.headers["content-type"]).toBe("application/vnd.cpc.manifest-v8+xml");
    const body = req.body ?? "";
    expect(body).toContain('<transmit-set xmlns="http://www.canadapost.ca/ws/manifest-v8">');
    expect(body).toContain(
      "<group-ids><group-id>1234</group-id><group-id>5&amp;6</group-id></group-ids>",
    );
    expect(body).toContain("<requested-shipping-point>K1K4T3</requested-shipping-point>");
    expect(body).toContain("<detailed-manifests>true</detailed-manifests>");
    expect(body).toContain("<method-of-payment>Account</method-of-payment>");
    expect(body).toContain("<postal-zip-code>A1A1A1</postal-zip-code>");
    expect(body).toContain(
      "<excluded-shipments><shipment-id>999</shipment-id></excluded-shipments>",
    );
    expect(res.manifestLinks.map((l) => l.href)).toEqual([
      `${FIXTURE_HOST}/rs/1234567/1234567/manifest/444444444444`,
      `${FIXTURE_HOST}/rs/1234567/1234567/manifest/333333333333`,
    ]);
  });

  it("requires at least one group and is INDETERMINATE on timeout", async () => {
    const { client } = makeClient({ hang: true }, { timeoutMs: 20 });
    const manifestAddress = {
      company: "c",
      phoneNumber: "1",
      address: { addressLine1: "a", city: "c", provState: "ON", postalZipCode: "a1a1a1" },
    };
    await expect(client.shipments.transmit({ groupIds: [], manifestAddress })).rejects.toThrow(
      /at least one/,
    );
    await expect(
      client.shipments.transmit({ groupIds: ["g"], manifestAddress }),
    ).rejects.toBeInstanceOf(CanadaPostIndeterminateError);
  });
});

describe("shipments.getGroups", () => {
  it("normalises one group (object) and several (array)", async () => {
    const one = makeClient(xml(GROUPS_SINGLE, SH));
    const single = await one.client.shipments.getGroups();
    expect(first(one.mock).url).toBe(`${PREFIX}/group`);
    expect(single).toHaveLength(1);
    expect(single[0]?.groupId).toBe("123456");
    expect(single[0]?.link?.rel).toBe("group");

    const many = makeClient(xml(GROUPS_MULTI, SH));
    expect((await many.client.shipments.getGroups()).map((g) => g.groupId)).toEqual(["a1", "b2"]);
  });

  it("returns an empty list for an empty groups element", async () => {
    const { client } = makeClient(xml("<groups/>", SH));
    expect(await client.shipments.getGroups()).toEqual([]);
  });
});

describe("shipments.list (recovery)", () => {
  it("searches by group, tracking PIN, request id and no-manifest date", async () => {
    const { client, mock } = makeClient(xml(SHIPMENTS_RESPONSE, SH));
    const byGroup = await client.shipments.list({ groupId: "grp1" });
    await client.shipments.list({ trackingPin: "123456789012" });
    await client.shipments.list({ requestId: "order-1001" });
    await client.shipments.list({
      noManifest: true,
      date: new Date("2030-01-15T15:30:00Z"),
      limit: 5,
    });
    expect(mock.requests.map((r) => r.url)).toEqual([
      `${PREFIX}/shipment?groupid=grp1`,
      `${PREFIX}/shipment?trackingPIN=123456789012`,
      `${PREFIX}/shipment?requestId=order-1001`,
      `${PREFIX}/shipment?noManifest=true&date=20300115&limit=5`,
    ]);
    expect(byGroup.shipmentIds).toEqual(["33333333333", "44444444"]);
    expect(byGroup.shipments).toEqual([]);
  });

  it("follows a group link as given", async () => {
    const { client, mock } = makeClient(xml(SHIPMENTS_RESPONSE, SH));
    await client.shipments.list({
      link: {
        rel: "group",
        href: `${PREFIX}/shipment?groupid=grp1`,
        mediaType: SH,
        index: undefined,
      },
    });
    expect(first(mock).url).toBe(`${PREFIX}/shipment?groupid=grp1`);
  });

  it("maps a still-being-created shipment (HTTP 202) to a pending error", async () => {
    const { client } = makeClient({ status: 202, body: "" });
    const err = (await client.shipments
      .list({ requestId: "order-1001" })
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(err).toBeInstanceOf(CanadaPostApiError);
    expect(err.isPending).toBe(true);
  });

  it("reads embedded shipment-info when provideShipmentInfo is set", async () => {
    const withInfo = `<shipments><shipment-info><shipment-id>1</shipment-id><shipment-status>created</shipment-status><tracking-pin>123456789012</tracking-pin></shipment-info></shipments>`;
    const { client, mock } = makeClient(xml(withInfo, SH));
    const res = await client.shipments.list({ groupId: "grp1", provideShipmentInfo: true });
    expect(first(mock).url).toBe(`${PREFIX}/shipment?groupid=grp1&provideShipmentInfo=true`);
    expect(res.shipments[0]?.trackingPin).toBe("123456789012");
  });

  it("returns nothing for an empty result", async () => {
    const { client } = makeClient(xml("<shipments/>", SH));
    const res = await client.shipments.list({ noManifest: true });
    expect(res.links).toEqual([]);
  });
});

describe("shipments.requestRefund", () => {
  it("POSTs shipment-refund-request to the refund link", async () => {
    const { client, mock } = makeClient(
      xml(
        "<shipment-refund-request-info><service-ticket-date>2015-01-28</service-ticket-date><service-ticket-id>GT12345678RT</service-ticket-id></shipment-refund-request-info>",
        SH,
      ),
    );
    const ticket = await client.shipments.requestRefund("347881315405043892", {
      email: "name@example.ca",
    });
    expect(first(mock).url).toBe(`${PREFIX}/shipment/347881315405043892/refund`);
    expect(first(mock).body).toContain(
      '<shipment-refund-request xmlns="http://www.canadapost.ca/ws/shipment-v8"><email>name@example.ca</email></shipment-refund-request>',
    );
    expect(ticket.serviceTicketId).toBe("GT12345678RT");
  });
});
