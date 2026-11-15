// Harness and fake data for the mocked REST/OAuth tests. Everything here is invented: the
// credentials, tokens, addresses and ids are obviously fake and never real account data.
import {
  createCanadaPostRestClient,
  type CanadaPostRestClient,
  type CanadaPostRestClientOptions,
  type RestCreateShipmentRequest,
  type RestCreateShipmentResponse,
  type RestLink,
  type RestOptionDetails,
  type RestPriceQuote,
  type RestPriceRequest,
  type RestServiceDetails,
  type RestServiceSummary,
  type RestShipmentDetails,
  type RestShipmentPrice,
} from "../../src/index.js";
import {
  createMockFetch,
  type MockFetch,
  type MockReply,
  type RecordedRequest,
} from "../../src/testing/index.js";

export const TEST_CLIENT_ID = "test-client-id";
export const TEST_CLIENT_SECRET = "test-client-secret-value";
export const TEST_CUSTOMER = "1234567";
export const BASE = "https://api.canadapost-postescanada.ca/prod/devportal-portaildesdeveloppeurs";
export const TOKEN_URL = `${BASE}/cpc-api-native-oauth-provider/oauth2/token`;
export const SHIPPING = `${BASE}/shipping/v1`;
export const RATING = `${BASE}/rating/v1`;

const JSON_TYPE = { "content-type": "application/json" };

/** A JSON reply. */
export function json(body: unknown, status = 200): MockReply {
  return { status, body: JSON.stringify(body), headers: JSON_TYPE };
}

/** The n-th fake access token (1-based). */
export function fakeToken(n: number): string {
  return `fake-access-token-${String(n)}`;
}

/** A successful token endpoint reply. */
export function tokenReply(n: number, extra: Record<string, unknown> = {}): MockReply {
  return json({
    token_type: "Bearer",
    access_token: fakeToken(n),
    scope: "merchant",
    expires_in: 3600,
    ...extra,
  });
}

export interface RestHarness {
  client: CanadaPostRestClient;
  mock: MockFetch;
  /** Token endpoint requests, in order. */
  tokenRequests(): RecordedRequest[];
  /** Every other request, in order. */
  apiRequests(): RecordedRequest[];
  clock: { now: number };
  /** Token fetches started so far (counts requests still held back by `tokenGate`). */
  tokenFetchesStarted(): number;
}

export interface HarnessOptions {
  /** Reply of the n-th (1-based) token request. Default: a fresh token with a 1 h lifetime. */
  token?: (n: number, request: RecordedRequest) => MockReply;
  /** Holds every token response until this promise resolves (to overlap concurrent callers). */
  tokenGate?: Promise<void>;
  overrides?: Partial<CanadaPostRestClientOptions>;
}

/**
 * Builds a REST client wired to a scripted fetch. `api` answers every non-token request
 * (index = position among API requests); the token endpoint is scripted separately.
 */
export function makeRestClient(
  api: MockReply | readonly MockReply[] | ((request: RecordedRequest, index: number) => MockReply),
  options: HarnessOptions = {},
): RestHarness {
  let tokenCount = 0;
  let apiCount = 0;
  const clock = { now: 1_800_000_000_000 };
  const mock = createMockFetch((request) => {
    if (request.url === TOKEN_URL) {
      tokenCount += 1;
      return (options.token ?? ((n: number) => tokenReply(n)))(tokenCount, request);
    }
    const index = apiCount;
    apiCount += 1;
    if (typeof api === "function") return api(request, index);
    if (Array.isArray(api)) {
      const list = api as readonly MockReply[];
      return list[Math.min(index, list.length - 1)] ?? {};
    }
    return api as MockReply;
  });
  let tokenFetches = 0;
  const gatedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === TOKEN_URL) {
      tokenFetches += 1;
      if (options.tokenGate !== undefined) await options.tokenGate;
    }
    return mock.fetch(input, init);
  };
  const client = createCanadaPostRestClient({
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    customerNumber: TEST_CUSTOMER,
    fetch: gatedFetch,
    retryDelayMs: 0,
    now: () => clock.now,
    ...options.overrides,
  });
  return {
    client,
    mock,
    clock,
    tokenFetchesStarted: () => tokenFetches,
    tokenRequests: () => mock.requests.filter((r) => r.url === TOKEN_URL),
    apiRequests: () => mock.requests.filter((r) => r.url !== TOKEN_URL),
  };
}

/** The first API request (fails the test if there is none). */
export function firstApi(h: RestHarness): RecordedRequest {
  const r = h.apiRequests()[0];
  if (r === undefined) throw new Error("no API request was recorded");
  return r;
}

/** Parses a recorded JSON body. */
export function bodyOf(request: RecordedRequest): unknown {
  if (request.body === undefined) throw new Error("request had no body");
  return JSON.parse(request.body) as unknown;
}

// --- fake wire data ---------------------------------------------------------------------

export const FAKE_SHIPMENT_ID = "100000000000000001";

function link(rel: string, path: string, mediaType = "application/json", index?: number): RestLink {
  return { rel, href: `${SHIPPING}/${path}`, mediaType, ...(index === undefined ? {} : { index }) };
}

export const FAKE_LINKS: RestLink[] = [
  link("self", `${TEST_CUSTOMER}/${TEST_CUSTOMER}/shipments/${FAKE_SHIPMENT_ID}`),
  link("details", `${TEST_CUSTOMER}/${TEST_CUSTOMER}/shipments/${FAKE_SHIPMENT_ID}/details`),
  link("price", `${TEST_CUSTOMER}/${TEST_CUSTOMER}/shipments/${FAKE_SHIPMENT_ID}/price`),
  link("label", "artifacts/fakeconsumer0001/shipping/20000000001/0", "application/pdf", 0),
];

export const FAKE_PRICE: RestShipmentPrice = {
  serviceCode: "DOM.RP",
  baseAmount: 10,
  pricedOptions: [{ optionCode: "DC", optionPrice: 0 }],
  adjustments: [{ adjustmentCode: "FUELSC", adjustmentAmount: 1.5 }],
  preTaxAmount: 11.5,
  gstAmount: 0,
  pstAmount: 0,
  hstAmount: 1.5,
  dueAmount: 13,
  serviceStandard: {
    amDelivery: false,
    guaranteedDelivery: false,
    expectedTransitTime: 4,
    expectedDeliveryDate: "2026-12-01",
  },
  ratedWeight: 1,
};

export const FAKE_CREATE_RESPONSE: RestCreateShipmentResponse = {
  customerRequestId: "REQ-0001",
  shipmentId: FAKE_SHIPMENT_ID,
  shipmentStatus: "created",
  trackingPin: "1234567890123456",
  links: FAKE_LINKS,
};

export const FAKE_DETAILS: RestShipmentDetails = {
  customerRequestId: "REQ-0001",
  shipmentStatus: "created",
  finalShippingPoint: "K1A0B1",
  trackingPin: "1234567890123456",
  shipmentDetail: {
    transmitShipment: true,
    expectedMailingDate: "2026-12-01",
    deliverySpec: fakeCreateRequest().deliverySpec,
  },
};

export const FAKE_QUOTES: RestPriceQuote[] = [
  {
    serviceCode: "DOM.RP",
    serviceLink: {
      rel: "service",
      href: `${RATING}/services/DOM.RP?country=CA`,
      mediaType: "application/json",
    },
    serviceName: "Regular Parcel",
    priceDetails: {
      base: 10,
      taxes: { gst: { amt: 0 }, pst: { amt: 0 }, hst: { amt: 1.3, percent: 13 } },
      due: 13,
      options: [
        { optionCode: "SO", optionName: "Signature option", optionPrice: 0 },
        {
          optionCode: "COV",
          optionName: "Coverage",
          optionPrice: 5.5,
          qualifier: { stepSize: 100, stepCost: 2.75, maxValue: 5000 },
        },
      ],
      adjustments: [
        {
          adjustmentCode: "FUELSC",
          adjustmentName: "Fuel surcharge",
          adjustmentCost: 1.5,
          qualifier: { percent: 17.5 },
        },
      ],
    },
    weightDetails: {},
    serviceStandard: {
      amDelivery: false,
      guaranteedDelivery: false,
      expectedTransitTime: 6,
      expectedDeliveryDate: "2026-12-05",
    },
  },
];

export const FAKE_SERVICES: RestServiceSummary[] = [
  {
    serviceCode: "DOM.EP",
    serviceName: "Expedited Parcel",
    link: {
      rel: "service",
      href: `${RATING}/services/DOM.EP?country=CA`,
      mediaType: "application/json",
    },
  },
];

export const FAKE_SERVICE_DETAILS: RestServiceDetails = {
  serviceCode: "DOM.EP",
  serviceName: "Expedited Parcel",
  options: [
    {
      optionCode: "COV",
      optionName: "Coverage",
      mandatory: false,
      qualifierRequired: true,
      qualifierMax: 5000,
      link: { rel: "option", href: `${RATING}/options/COV`, mediaType: "application/json" },
    },
  ],
  restrictions: {
    weightRestriction: { min: 0.001, max: 30 },
    densityFactor: 6000,
    canShipInMailingTube: true,
    canShipUnpackaged: false,
    allowedAsReturnService: true,
    dimensionalRestrictions: { length: 200, width: 200, height: 200, lengthPlusGirthMax: 300 },
  },
};

export const FAKE_OPTION: RestOptionDetails = {
  optionCode: "DC",
  optionName: "Delivery confirmation",
  optionClass: "FEAT",
  printsOnLabel: false,
  qualifierRequired: false,
};

export function fakeCreateRequest(
  overrides: Partial<RestCreateShipmentRequest> = {},
): RestCreateShipmentRequest {
  return {
    customerRequestId: "REQ-0001",
    transmitShipment: true,
    requestedShippingPoint: "K1A0B1",
    expectedMailingDate: "2026-12-01",
    providePricingInfo: true,
    deliverySpec: {
      serviceCode: "DOM.RP",
      sender: {
        name: "Example Sender",
        company: "Example Sender Ltd",
        contactPhone: "555-555-0100",
        addressDetails: {
          addressLine1: "1 Example Street",
          city: "Ottawa",
          provState: "ON",
          countryCode: "CA",
          postalZipCode: "K1A0B1",
        },
      },
      destination: {
        name: "Test Recipient",
        clientVoiceNumber: "555-555-0101",
        addressDetails: {
          addressLine1: "123 Test Avenue",
          city: "Toronto",
          provState: "ON",
          countryCode: "CA",
          postalZipCode: "M5V2T6",
        },
      },
      options: [{ optionCode: "DC" }],
      parcelCharacteristics: { weight: 1, dimensions: { length: 20, width: 15, height: 6 } },
      references: { customerRef1: "TEST-REF" },
      printPreferences: { outputFormat: "4x6", encoding: "PDF" },
      preferences: { showPackingInstructions: false, showPostageRate: false },
      settlementInfo: { paidByCustomer: TEST_CUSTOMER, intendedMethodOfPayment: "CreditCard" },
    },
    ...overrides,
  } as RestCreateShipmentRequest;
}

export function fakePriceRequest(): RestPriceRequest {
  return {
    quoteType: "commercial",
    originPostalCode: "K1A0B1",
    destination: { domestic: { postalCode: "M5V2T6" } },
    parcelCharacteristics: { weight: 1, dimensions: { length: 20, width: 15, height: 6 } },
  };
}

/** A minimal but structurally real three-page PDF. */
export function fakePdf(pages = 3): Uint8Array {
  const kids = Array.from({ length: pages }, (_v, i) => `${String(3 + i)} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${String(pages)} >>`,
    ...Array.from({ length: pages }, () => "<< /Type /Page /Parent 2 0 R >>"),
  ];
  const body = objects.map((o, i) => `${String(i + 1)} 0 obj\n${o}\nendobj\n`).join("");
  return new TextEncoder().encode(`%PDF-1.4\n${body}%%EOF\n`);
}

export const PDF_HEADERS = { "content-type": "application/pdf" };
