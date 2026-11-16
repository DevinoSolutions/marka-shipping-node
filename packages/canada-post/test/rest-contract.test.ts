// Contract tests: what the SDK sends and what its types describe are checked against Canada
// Post's own OpenAPI documents (docs/research/openapi/). Every REST operation in the
// operations table must map to a documented endpoint, and every request the SDK builds must
// satisfy that endpoint's request schema.
import { describe, expect, it } from "vitest";
import { OPERATIONS, type RestCreateShipmentRequest, type RestPriceRequest } from "../src/index.js";
import {
  FAKE_CREATE_RESPONSE,
  FAKE_DETAILS,
  FAKE_LINKS,
  FAKE_OPTION,
  FAKE_PRICE,
  FAKE_QUOTES,
  FAKE_SERVICES,
  FAKE_SERVICE_DETAILS,
  FAKE_SHIPMENT_ID,
  PDF_HEADERS,
  bodyOf,
  fakeCreateRequest,
  fakePdf,
  fakePriceRequest,
  json,
  makeRestClient,
  type RestHarness,
} from "./support/rest.js";
import {
  CALLS_SERVICES,
  EXPECTED_SERVICES,
  replyForServices,
} from "./support/contract-services.js";
import {
  documentsStatus,
  expectValid,
  findOperation,
  loadSpec,
  requestSchema,
  responseSchema,
  validateComponent,
  validateSchema,
  type SpecName,
} from "./support/openapi.js";

/** SDK operation id -> [spec, operationId of the documented endpoint it must call]. */
const EXPECTED: Record<string, [SpecName, string]> = {
  "rest.shipments.create": ["shipping-v1", "PostShipment"],
  "rest.shipments.get": ["shipping-v1", "getShipmentById"],
  "rest.shipments.getDetails": ["shipping-v1", "GetShipmentIdDetails"],
  "rest.shipments.getPrice": ["shipping-v1", "getShipmentPrice"],
  "rest.shipments.list": ["shipping-v1", "getShipments"],
  "rest.shipments.getLabel": ["shipping-v1", "shipmentArtifact"],
  "rest.shipments.void": ["shipping-v1", "emptyShipment"],
  "rest.rating.getPrices": ["rating-v1", "price"],
  "rest.rating.listServices": ["rating-v1", "service"],
  "rest.rating.getService": ["rating-v1", "serviceCode"],
  "rest.rating.getOption": ["rating-v1", "optionCode"],
  ...EXPECTED_SERVICES,
};

const pdfReply = { status: 200, body: fakePdf(1), headers: PDF_HEADERS };

/** Runs each SDK operation once against a stub and returns the request it produced. */
const CALLS: Record<string, (h: RestHarness) => Promise<unknown>> = {
  "rest.shipments.create": (h) => h.client.shipments.create(fakeCreateRequest()),
  "rest.shipments.get": (h) => h.client.shipments.get(FAKE_SHIPMENT_ID),
  "rest.shipments.getDetails": (h) => h.client.shipments.getDetails(FAKE_SHIPMENT_ID),
  "rest.shipments.getPrice": (h) => h.client.shipments.getPrice(FAKE_SHIPMENT_ID),
  "rest.shipments.list": (h) => h.client.shipments.list({ requestId: "REQ-0001", limit: 10 }),
  "rest.shipments.getLabel": (h) => h.client.shipments.getLabel(FAKE_CREATE_RESPONSE),
  "rest.shipments.void": (h) => h.client.shipments.void(FAKE_SHIPMENT_ID),
  "rest.rating.getPrices": (h) => h.client.rating.getPrices(fakePriceRequest()),
  "rest.rating.listServices": (h) => h.client.rating.listServices({ country: "CA" }),
  "rest.rating.getService": (h) => h.client.rating.getService("DOM.EP", { country: "CA" }),
  "rest.rating.getOption": (h) => h.client.rating.getOption("DC"),
  ...CALLS_SERVICES,
};

function replyFor(id: string): Parameters<typeof makeRestClient>[0] {
  switch (id) {
    case "rest.shipments.create":
      return json(FAKE_CREATE_RESPONSE);
    case "rest.shipments.get":
      return json(FAKE_CREATE_RESPONSE);
    case "rest.shipments.getDetails":
      return json(FAKE_DETAILS);
    case "rest.shipments.getPrice":
      return json(FAKE_PRICE);
    case "rest.shipments.list":
      return json(FAKE_LINKS);
    case "rest.shipments.getLabel":
      return pdfReply;
    case "rest.shipments.void":
      return { status: 204 };
    case "rest.rating.getPrices":
      return json(FAKE_QUOTES);
    case "rest.rating.listServices":
      return json(FAKE_SERVICES);
    case "rest.rating.getService":
      return json(FAKE_SERVICE_DETAILS);
    default:
      return replyForServices(id) ?? json(FAKE_OPTION);
  }
}

describe("operations table vs the OpenAPI documents", () => {
  it("maps every REST operation to a documented endpoint (and nothing else)", () => {
    const restIds = Object.keys(OPERATIONS)
      .filter((id) => id.startsWith("rest."))
      .sort();
    expect(restIds).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.keys(CALLS).sort()).toEqual(restIds);
  });

  it.each(Object.entries(EXPECTED))(
    "%s calls the documented endpoint with the documented verb",
    async (id, [specName, operationId]) => {
      const h = makeRestClient(replyFor(id));
      const call = CALLS[id];
      if (call === undefined) throw new Error(`no call for ${id}`);
      await call(h);
      // The first API request of the call is the operation itself, except getLabel by id.
      const request = h.apiRequests().at(-1);
      if (request === undefined) throw new Error("no request");
      const doc = loadSpec(specName);
      const match = findOperation(doc, request.method, request.url);
      expect(match, `${request.method} ${request.url}`).toBeDefined();
      expect(match?.operation.operationId).toBe(operationId);
      // The classification in the operations table must agree with the verb on the wire.
      expect(OPERATIONS[id]?.http).toBe(request.method);
    },
  );

  it.each(Object.entries(EXPECTED))(
    "%s: the request body (if any) satisfies the request schema",
    async (id, [specName]) => {
      const h = makeRestClient(replyFor(id));
      await CALLS[id]?.(h);
      const request = h.apiRequests().at(-1);
      if (request === undefined) throw new Error("no request");
      const doc = loadSpec(specName);
      const match = findOperation(doc, request.method, request.url);
      if (match === undefined) throw new Error("no match");
      if (request.body === undefined) {
        expect(match.operation.requestBody).toBeUndefined();
      } else {
        expectValid(id, validateSchema(doc, requestSchema(match.operation), bodyOf(request)));
      }
    },
  );

  it.each(Object.entries(EXPECTED))(
    "%s: the documented success status exists and the fixture satisfies its schema",
    async (id, [specName]) => {
      const h = makeRestClient(replyFor(id));
      await CALLS[id]?.(h);
      const request = h.apiRequests().at(-1);
      if (request === undefined) throw new Error("no request");
      const doc = loadSpec(specName);
      const match = findOperation(doc, request.method, request.url);
      if (match === undefined) throw new Error("no match");
      const reply = replyFor(id) as { status?: number; body?: unknown };
      const status = reply.status ?? 200;
      expect(documentsStatus(match.operation, status)).toBe(true);
      if (typeof reply.body === "string" && status === 200) {
        // The fixtures that stand in for responses go through the response schema.
        let fixture: unknown = JSON.parse(reply.body);
        // The Test app wraps details/price in an array; the specification says object.
        if (id === "rest.shipments.getDetails" || id === "rest.shipments.getPrice") {
          fixture = Array.isArray(fixture) ? fixture[0] : fixture;
        }
        expectValid(
          `${id} response`,
          validateSchema(doc, responseSchema(doc, match.operation, 200), fixture),
        );
      }
    },
  );
});

describe("requests the SDK builds", () => {
  const shipping = loadSpec("shipping-v1");
  const rating = loadSpec("rating-v1");
  const createOp = (): ReturnType<typeof requestSchema> =>
    requestSchema(
      findOperation(shipping, "POST", `${shipping.servers[0]?.url ?? ""}/1234567/1234567/shipments`)
        ?.operation ?? { requestBody: undefined },
    );

  it("accepts a fully loaded domestic create request", () => {
    const request: RestCreateShipmentRequest = fakeCreateRequest({
      cpcPickupIndicator: true,
      quickshipLabelRequested: false,
      provideReceiptInfo: true,
      createPublicKey: true,
      createQrCode: true,
      shippingPointId: "1234",
    });
    expectValid("create", validateSchema(shipping, createOp(), request));
  });

  it("accepts a groupId create request", () => {
    const { transmitShipment: _omit, ...rest } =
      fakeCreateRequest() as RestCreateShipmentRequest & {
        transmitShipment: true;
      };
    expectValid("create", validateSchema(shipping, createOp(), { ...rest, groupId: "GROUP1" }));
  });

  it("accepts an international create request with customs and a Zonos-free US destination", () => {
    const base = fakeCreateRequest();
    const request: RestCreateShipmentRequest = {
      ...base,
      deliverySpec: {
        ...base.deliverySpec,
        serviceCode: "USA.EP",
        destination: {
          name: "US Recipient",
          addressDetails: {
            addressLine1: "1 Example Way",
            city: "Seattle",
            provState: "WA",
            countryCode: "US",
            postalZipCode: "98101",
          },
        },
        notification: {
          email: "recipient@example.com",
          onShipment: true,
          onException: true,
          onDelivery: false,
        },
        customs: {
          currency: "CAD",
          reasonForExport: "SOG",
          usdeclarationid: "DECL-0001",
          skuList: [
            {
              customsNumberOfUnits: 1,
              customsDescription: "SSD",
              unitWeight: 0.1,
              customsValuePerUnit: 100,
              hsTariffCode: "8523.51.00",
              countryOfOrigin: "CN",
            },
          ],
        },
      },
    };
    expectValid("create", validateSchema(shipping, createOp(), request));
  });

  it("the schema really rejects wrong requests (the contract test is not vacuous)", () => {
    const good = fakeCreateRequest();
    const rejects = (value: unknown): boolean =>
      validateSchema(shipping, createOp(), value).length > 0;
    expect(rejects({ ...good, groupId: "G" })).toBe(true); // both transmitShipment and groupId
    expect(rejects({ ...good, extra: 1 })).toBe(true);
    expect(rejects({ ...good, customerRequestId: "x".repeat(36) })).toBe(true);
    expect(rejects({ ...good, transmitShipment: false })).toBe(true);
    expect(rejects({ transmitShipment: true })).toBe(true); // no deliverySpec
    expect(
      rejects({
        ...good,
        deliverySpec: {
          ...good.deliverySpec,
          settlementInfo: { intendedMethodOfPayment: "x".repeat(16) },
        },
      }),
    ).toBe(true);
    expect(
      rejects({
        ...good,
        deliverySpec: { ...good.deliverySpec, parcelCharacteristics: { weight: 0 } },
      }),
    ).toBe(true);
    expect(
      rejects({
        ...good,
        deliverySpec: {
          ...good.deliverySpec,
          sender: {
            ...good.deliverySpec.sender,
            addressDetails: { ...good.deliverySpec.sender.addressDetails, countryCode: "US" },
          },
        },
      }),
    ).toBe(true);
    expect(rejects(good)).toBe(false);
  });

  it("price requests satisfy mailingScenario in all destination shapes", () => {
    const base = fakePriceRequest();
    const variants: RestPriceRequest[] = [
      base,
      { ...base, customerNumber: "1234567", contractId: "0012345678", quoteType: "counter" },
      { ...base, destination: { unitedStates: { zipCode: "98101" } } },
      { ...base, destination: { international: { countryCode: "GB", postalCode: "SW1A 1AA" } } },
      {
        ...base,
        services: ["DOM.RP", "DOM.EP"],
        options: [{ optionCode: "COV", optionAmount: 500 }],
      },
      { ...base, expectedMailingDate: "2026-12-01", promoCode: "PROMO" },
    ];
    for (const v of variants) {
      expectValid("price", validateComponent(rating, "mailingScenario", v));
    }
    expect(validateComponent(rating, "mailingScenario", { ...base, destination: {} })).not.toEqual(
      [],
    );
    expect(
      validateComponent(rating, "mailingScenario", { ...base, originPostalCode: "k1a0b1" }),
    ).not.toEqual([]);
  });
});

describe("response types", () => {
  it("the typed fixtures satisfy the response schemas", () => {
    const shipping = loadSpec("shipping-v1");
    const rating = loadSpec("rating-v1");
    expectValid(
      "createShipmentResponse",
      validateComponent(shipping, "createShipmentResponse", FAKE_CREATE_RESPONSE),
    );
    expectValid("shipmentPrice", validateComponent(shipping, "shipmentPrice", FAKE_PRICE));
    expectValid("shipmentDetails", validateComponent(shipping, "shipmentDetails", FAKE_DETAILS));
    expectValid("links", validateComponent(shipping, "links", FAKE_LINKS));
    expectValid("priceQuotes", validateComponent(rating, "priceQuotes", FAKE_QUOTES));
    expectValid("services", validateComponent(rating, "services", FAKE_SERVICES));
    expectValid("service", validateComponent(rating, "service", FAKE_SERVICE_DETAILS));
    expectValid("option", validateComponent(rating, "option", FAKE_OPTION));
  });

  it("the schemas reject broken responses (so the live suite can catch stub drift)", () => {
    const shipping = loadSpec("shipping-v1");
    const rating = loadSpec("rating-v1");
    expect(
      validateComponent(shipping, "createShipmentResponse", {
        ...FAKE_CREATE_RESPONSE,
        shipmentId: 5,
      }),
    ).not.toEqual([]);
    expect(validateComponent(shipping, "createShipmentResponse", { shipmentId: "1" })).not.toEqual(
      [],
    );
    expect(
      validateComponent(shipping, "shipmentPrice", { ...FAKE_PRICE, dueAmount: "13" }),
    ).not.toEqual([]);
    const { dueAmount: _due, ...withoutDue } = FAKE_PRICE;
    expect(validateComponent(shipping, "shipmentPrice", withoutDue)).not.toEqual([]);
    expect(validateComponent(rating, "priceQuotes", [{ serviceCode: "DOM.RP" }])).not.toEqual([]);
    expect(validateComponent(rating, "option", { ...FAKE_OPTION, optionClass: "XX" })).not.toEqual(
      [],
    );
  });

  it("error bodies the SDK parses match the documented messages schema", () => {
    const shipping = loadSpec("shipping-v1");
    expectValid(
      "messages",
      validateComponent(shipping, "messages", {
        title: "Bad Request",
        detail: "Validation failed",
        errors: [{ errorCode: "E100", message: "weight is required" }],
      }),
    );
  });
});
