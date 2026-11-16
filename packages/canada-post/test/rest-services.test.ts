// Behaviour of the REST APIs added after the first release: later Shipping endpoints, manifests,
// tracking, customer information, returns, pickup, post offices and service information.
// (Which endpoint each operation calls, and that requests/fixtures satisfy the OpenAPI
// documents, is rest-contract.test.ts.)
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CanadaPostApiError,
  CanadaPostConfigurationError,
  CanadaPostIndeterminateError,
  CanadaPostParseError,
  CanadaPostValidationError,
  type CanadaPostDebugEvent,
  type RestFollowedLink,
} from "../src/index.js";
import {
  CUSTOMERINFO,
  FAKE_AUTHORIZED_RETURN,
  FAKE_AUTHORIZED_RETURN_REQUEST,
  FAKE_CARD_ALIAS,
  FAKE_CERTIFICATE,
  FAKE_CUSTOMER_MOBO_WIRE,
  FAKE_CUSTOMER_WIRE,
  FAKE_DNC,
  FAKE_MANIFEST_LINKS,
  FAKE_OPEN_RETURN,
  FAKE_OPEN_RETURN_ID,
  FAKE_OPEN_RETURN_REQUEST,
  FAKE_PICKUP_CREATED,
  FAKE_PICKUP_ID,
  FAKE_PICKUP_REQUEST,
  FAKE_PICKUP_UPDATE,
  FAKE_PIN,
  FAKE_POST_OFFICES,
  FAKE_POST_OFFICE_DETAIL,
  FAKE_REFUND,
  FAKE_SERVICE_MESSAGES,
  FAKE_TRACKING_SUMMARY,
  FAKE_TRANSMIT_REQUEST,
  PICKUP,
  POSTOFFICE,
  RETURNS,
  SERVICEINFO,
  TRACKING,
} from "./support/rest-services.js";
import {
  FAKE_SHIPMENT_ID,
  PDF_HEADERS,
  SHIPPING,
  bodyOf,
  fakePdf,
  firstApi,
  json,
  makeRestClient,
  type RestHarness,
} from "./support/rest.js";

const caught = (promise: Promise<unknown>): Promise<unknown> => promise.catch((e: unknown) => e);
const ACCOUNT = `${SHIPPING}/1234567/1234567`;
const gateway = { status: 503, body: "gateway timeout" };

/** A write must be sent once: no retry on 5xx, no replay after a 401, 5xx = indeterminate. */
async function expectNeverRetried(
  call: (h: RestHarness) => Promise<unknown>,
  reply503 = gateway,
): Promise<void> {
  const h = makeRestClient(reply503);
  const error = await caught(call(h));
  expect(error).toBeInstanceOf(CanadaPostIndeterminateError);
  expect(h.apiRequests()).toHaveLength(1);
  const h401 = makeRestClient({ status: 401, body: "{}" });
  const error401 = await caught(call(h401));
  expect(error401).toBeInstanceOf(CanadaPostApiError);
  expect(h401.apiRequests()).toHaveLength(1);
  const hNet = makeRestClient({ error: new Error("socket hang up") });
  expect(await caught(call(hNet))).toBeInstanceOf(CanadaPostIndeterminateError);
  expect(hNet.apiRequests()).toHaveLength(1);
}

describe("shipments: receipt, qr code, groups", () => {
  it("reads the receipt, public key info and groups of the account", async () => {
    const h = makeRestClient((r) =>
      r.url.endsWith("/receipt")
        ? json({ ccReceiptDetails: { chargeAmount: 5 } })
        : r.url.endsWith("/qr-code")
          ? json({ url: "https://example.invalid/x", expiryDate: "2026-12-01T00:00:00Z" })
          : json([]),
    );
    expect(await h.client.shipments.getReceipt(FAKE_SHIPMENT_ID)).toEqual({
      ccReceiptDetails: { chargeAmount: 5 },
    });
    expect((await h.client.shipments.getQrCode(FAKE_SHIPMENT_ID)).url).toBe(
      "https://example.invalid/x",
    );
    expect(await h.client.shipments.getGroups()).toEqual([]);
    expect(h.apiRequests().map((r) => r.url)).toEqual([
      `${ACCOUNT}/shipments/${FAKE_SHIPMENT_ID}/receipt`,
      `${ACCOUNT}/shipments/${FAKE_SHIPMENT_ID}/qr-code`,
      `${ACCOUNT}/groups`,
    ]);
  });

  it("treats a null body (production, no groups) as an empty list, nothing else", async () => {
    const empty = makeRestClient({ status: 200, body: "null" });
    expect(await empty.client.shipments.getGroups()).toEqual([]);
    for (const body of [JSON.stringify({ groupId: "g1" }), "[1", '"x"', "0"]) {
      const h = makeRestClient({ status: 200, body });
      expect(await caught(h.client.shipments.getGroups())).toBeInstanceOf(CanadaPostParseError);
    }
  });

  it("retries reads on a 503 (they change nothing)", async () => {
    const h = makeRestClient([gateway, json([])]);
    await h.client.shipments.getGroups();
    expect(h.apiRequests()).toHaveLength(2);
  });
});

describe("shipments.requestRefund", () => {
  it("posts the e-mail and returns the service ticket", async () => {
    const h = makeRestClient(json(FAKE_REFUND));
    const info = await h.client.shipments.requestRefund(FAKE_SHIPMENT_ID, {
      email: "refunds@example.com",
    });
    expect(info).toEqual(FAKE_REFUND);
    const r = firstApi(h);
    expect(r.method).toBe("POST");
    expect(r.url).toBe(`${ACCOUNT}/shipments/${FAKE_SHIPMENT_ID}/refund`);
    expect(bodyOf(r)).toEqual({ email: "refunds@example.com" });
  });

  it("is a write: never retried, never replayed, indeterminate when ambiguous", async () => {
    await expectNeverRetried((h) =>
      h.client.shipments.requestRefund(FAKE_SHIPMENT_ID, { email: "refunds@example.com" }),
    );
  });

  it("explains how to recover from an indeterminate refund", async () => {
    const h = makeRestClient(gateway);
    const error = (await caught(
      h.client.shipments.requestRefund(FAKE_SHIPMENT_ID, { email: "refunds@example.com" }),
    )) as CanadaPostIndeterminateError;
    expect(error.recovery).toMatch(/not idempotent/);
  });

  it.each(["", "not-an-email", "a@b", `${"x".repeat(60)}@example.com`])(
    "refuses the e-mail %j before sending anything",
    async (email) => {
      const h = makeRestClient(json(FAKE_REFUND));
      expect(
        await caught(h.client.shipments.requestRefund(FAKE_SHIPMENT_ID, { email })),
      ).toBeInstanceOf(CanadaPostValidationError);
      expect(h.apiRequests()).toHaveLength(0);
    },
  );

  it("refuses a shipment id that could escape the URL path", async () => {
    const h = makeRestClient(json(FAKE_REFUND));
    const bad = await caught(
      h.client.shipments.requestRefund("../x", { email: "refunds@example.com" }),
    );
    expect(bad).toBeInstanceOf(CanadaPostValidationError);
    expect(h.apiRequests()).toHaveLength(0);
  });
});

describe("shipments.transmit and manifests", () => {
  it("posts the manifest request and returns the manifest links", async () => {
    const h = makeRestClient(json(FAKE_MANIFEST_LINKS));
    const links = await h.client.shipments.transmit(FAKE_TRANSMIT_REQUEST);
    expect(links).toEqual(FAKE_MANIFEST_LINKS);
    const r = firstApi(h);
    expect([r.method, r.url]).toEqual(["POST", `${ACCOUNT}/manifests`]);
    expect(bodyOf(r)).toEqual(FAKE_TRANSMIT_REQUEST);
  });

  it("is a write: sent once, indeterminate when ambiguous, recovery names manifests.list", async () => {
    await expectNeverRetried((h) => h.client.shipments.transmit(FAKE_TRANSMIT_REQUEST));
    const h = makeRestClient(gateway);
    const error = (await caught(
      h.client.shipments.transmit(FAKE_TRANSMIT_REQUEST),
    )) as CanadaPostIndeterminateError;
    expect(error.recovery).toMatch(/manifests\.list/);
  });

  it("validates the request locally", async () => {
    const h = makeRestClient(json(FAKE_MANIFEST_LINKS));
    const bad = (patch: object): Promise<unknown> =>
      caught(h.client.shipments.transmit({ ...FAKE_TRANSMIT_REQUEST, ...patch }));
    expect(await bad({ groupIds: [] })).toBeInstanceOf(CanadaPostValidationError);
    expect(await bad({ groupIds: [""] })).toBeInstanceOf(CanadaPostValidationError);
    expect(await bad({ groupIds: ["G".repeat(33)] })).toBeInstanceOf(CanadaPostValidationError);
    expect(await bad({ excludedShipments: [] })).toBeInstanceOf(CanadaPostValidationError);
    expect(await bad({ customerRequestId: "x".repeat(36) })).toBeInstanceOf(
      CanadaPostValidationError,
    );
    expect(h.apiRequests()).toHaveLength(0);
  });

  it("rejects a transmit answer that is not a list of links", async () => {
    const h = makeRestClient(json([{ nope: 1 }]));
    expect(await caught(h.client.shipments.transmit(FAKE_TRANSMIT_REQUEST))).toMatchObject({
      name: "CanadaPostParseError",
    });
  });

  it("lists manifests with compact dates (the API wants YYYYMMDD)", async () => {
    const h = makeRestClient(json(FAKE_MANIFEST_LINKS));
    await h.client.manifests.list({ from: "2026-11-01", to: "20261116" });
    expect(firstApi(h).url).toBe(`${ACCOUNT}/manifests?from=20261101&to=20261116`);
    const fromOnly = makeRestClient(json([]));
    await fromOnly.client.manifests.list({ from: "20261101" });
    expect(firstApi(fromOnly).url).toBe(`${ACCOUNT}/manifests?from=20261101`);
  });

  it("requires `from` (production errorCode 9105) before any request", async () => {
    const h = makeRestClient(json([]));
    const bad: unknown[] = [undefined, {}, { to: "2026-11-16" }];
    for (const input of bad) {
      expect(
        await caught(
          h.client.manifests.list(input as Parameters<typeof h.client.manifests.list>[0]),
        ),
      ).toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.mock.requests).toHaveLength(0);
  });

  it("refuses impossible dates", async () => {
    const h = makeRestClient(json([]));
    expect(await caught(h.client.manifests.list({ from: "2026-02-31" }))).toBeInstanceOf(
      CanadaPostValidationError,
    );
    expect(
      await caught(h.client.manifests.list({ from: "2026-11-01", to: "yesterday" })),
    ).toBeInstanceOf(CanadaPostValidationError);
  });

  it("gets a manifest and its details by id or by link", async () => {
    const h = makeRestClient(json({ poNumber: "PO1", links: [] }));
    await h.client.manifests.get("PO00000001");
    await h.client.manifests.getDetails("PO00000001");
    await h.client.manifests.get({
      rel: "self",
      href: `${ACCOUNT}/manifests/PO00000002`,
      mediaType: "application/json",
    });
    expect(h.apiRequests().map((r) => r.url)).toEqual([
      `${ACCOUNT}/manifests/PO00000001`,
      `${ACCOUNT}/manifests/PO00000001/details`,
      `${ACCOUNT}/manifests/PO00000002`,
    ]);
  });

  it("refuses a manifest link on another host (bearer tokens travel with every call)", async () => {
    const h = makeRestClient(json({}));
    const error = await caught(
      h.client.manifests.get({
        rel: "self",
        href: "https://evil.example/manifests/1",
        mediaType: "application/json",
      }),
    );
    expect(error).toBeInstanceOf(CanadaPostConfigurationError);
    expect(h.apiRequests()).toHaveLength(0);
  });
});

describe("tracking", () => {
  it("reads summaries and details by PIN and by DNC", async () => {
    const h = makeRestClient((r) =>
      r.url.endsWith("/details") ? json({ pin: FAKE_PIN }) : json(FAKE_TRACKING_SUMMARY),
    );
    expect(await h.client.tracking.getSummaryByPin(FAKE_PIN)).toEqual(FAKE_TRACKING_SUMMARY);
    expect(await h.client.tracking.getSummaryByDnc(FAKE_DNC)).toEqual(FAKE_TRACKING_SUMMARY);
    expect(await h.client.tracking.getDetailsByPin(FAKE_PIN)).toEqual({ pin: FAKE_PIN });
    expect(await h.client.tracking.getDetailsByDnc(FAKE_DNC)).toEqual({ pin: FAKE_PIN });
    expect(h.apiRequests().map((r) => r.url)).toEqual([
      `${TRACKING}/pins/${FAKE_PIN}/summaries`,
      `${TRACKING}/dncs/${FAKE_DNC}/summaries`,
      `${TRACKING}/pins/${FAKE_PIN}/details`,
      `${TRACKING}/dncs/${FAKE_DNC}/details`,
    ]);
  });

  it("wraps the {pin, error} object Production answers for an unknown PIN", async () => {
    const entry = { pin: FAKE_PIN, error: { code: "004", descEn: "No data", descFr: "Aucune" } };
    const h = makeRestClient(json(entry));
    expect(await h.client.tracking.getSummaryByPin(FAKE_PIN)).toEqual([entry]);
  });

  it("accepts a one-element array for details and still validates", async () => {
    const h = makeRestClient(json([{ pin: FAKE_PIN }]));
    expect(await h.client.tracking.getDetailsByPin(FAKE_PIN)).toEqual({ pin: FAKE_PIN });
  });

  it("looks parcels up by reference in a mailing-date window", async () => {
    const h = makeRestClient(json(FAKE_TRACKING_SUMMARY));
    await h.client.tracking.getSummaryByReference({
      referenceNumber: "REF 1",
      mailingDateFrom: "2026-11-01",
      mailingDateTo: "2026-11-16",
      customerNumber: "1234567",
      destinationPostalCode: "M5V2T6",
    });
    const url = new URL(firstApi(h).url);
    expect(url.pathname.endsWith("/tracking/v1/refs/summaries")).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      "reference-number": "REF 1",
      "mailing-date-from": "2026-11-01",
      "mailing-date-to": "2026-11-16",
      "customer-number": "1234567",
      "destination-postal-code": "M5V2T6",
    });
  });

  it.each([
    ["a short PIN", () => ({ pin: "123" })],
    ["a PIN with a slash", () => ({ pin: "70232102/5628702" })],
  ])("refuses %s before sending anything", async (_name, make) => {
    const h = makeRestClient(json([]));
    expect(await caught(h.client.tracking.getSummaryByPin(make().pin))).toBeInstanceOf(
      CanadaPostValidationError,
    );
    expect(await caught(h.client.tracking.getDetailsByPin(make().pin))).toBeInstanceOf(
      CanadaPostValidationError,
    );
    expect(h.apiRequests()).toHaveLength(0);
  });

  it("refuses a DNC that is not 15 digits and bad reference searches", async () => {
    const h = makeRestClient(json([]));
    const window = { mailingDateFrom: "2026-11-01", mailingDateTo: "2026-11-16" };
    for (const promise of [
      h.client.tracking.getSummaryByDnc("12345"),
      h.client.tracking.getDetailsByDnc("abcdefghijklmno"),
      h.client.tracking.getSummaryByReference({ referenceNumber: "", ...window }),
      h.client.tracking.getSummaryByReference({ referenceNumber: "x".repeat(36), ...window }),
      h.client.tracking.getSummaryByReference({
        referenceNumber: "R",
        ...window,
        customerNumber: "12345678901",
      }),
      h.client.tracking.getSummaryByReference({
        referenceNumber: "R",
        ...window,
        destinationPostalCode: "x".repeat(15),
      }),
      h.client.tracking.getSummaryByReference({
        referenceNumber: "R",
        mailingDateFrom: "2026-13-01",
        mailingDateTo: "2026-11-16",
      }),
    ]) {
      expect(await caught(promise)).toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.apiRequests()).toHaveLength(0);
  });

  it("sends the certificate PIN as a JSON integer and is a read that is never retried", async () => {
    const h = makeRestClient(json(FAKE_CERTIFICATE));
    expect(await h.client.tracking.createCertificate({ pin: FAKE_PIN, language: "fr" })).toEqual(
      FAKE_CERTIFICATE,
    );
    expect(firstApi(h).body).toBe(`{"pin":${FAKE_PIN},"language":"fr"}`);
    const flaky = makeRestClient(gateway);
    expect(
      await caught(flaky.client.tracking.createCertificate({ pin: FAKE_PIN, language: "en" })),
    ).toBeInstanceOf(CanadaPostApiError);
    expect(flaky.apiRequests()).toHaveLength(1);
  });

  it("refuses certificate PINs that are not safe integers, and bad languages", async () => {
    const h = makeRestClient(json(FAKE_CERTIFICATE));
    for (const request of [
      { pin: "ABCDEFGHIJKL", language: "en" as const },
      { pin: "9999999999999999", language: "en" as const },
      { pin: FAKE_PIN, language: "es" as never },
    ]) {
      expect(await caught(h.client.tracking.createCertificate(request))).toBeInstanceOf(
        CanadaPostValidationError,
      );
    }
    expect(h.apiRequests()).toHaveLength(0);
  });
});

describe("customers: card data never leaves the SDK", () => {
  it("returns the profile without card aliases and counts the cards", async () => {
    const h = makeRestClient(json(FAKE_CUSTOMER_WIRE));
    const info = await h.client.customers.get();
    expect(info).not.toHaveProperty("creditCardAliases");
    expect(info.creditCardCount).toBe(1);
    expect(info.number).toBe("1234567");
    expect(JSON.stringify(info)).not.toContain(FAKE_CARD_ALIAS);
    expect(firstApi(h).url).toBe(`${CUSTOMERINFO}/customers/1234567`);
  });

  it("summarizes payment readiness without any card data", async () => {
    const h = makeRestClient(json(FAKE_CUSTOMER_WIRE));
    const readiness = await h.client.customers.getPaymentReadiness();
    expect(readiness).toEqual({
      hasCreditCard: true,
      contracts: 2,
      authorizedPayers: 1,
      paymentMethods: ["Account", "CreditCard"],
    });
    expect(JSON.stringify(readiness)).not.toContain(FAKE_CARD_ALIAS);
  });

  it("reports no card, no contracts and no payers for a bare account", async () => {
    const {
      creditCardAliases: _drop,
      contracts: _c,
      authorizedPayers: _p,
      ...bare
    } = FAKE_CUSTOMER_WIRE;
    const h = makeRestClient(json(bare));
    expect(await h.client.customers.getPaymentReadiness()).toEqual({
      hasCreditCard: false,
      contracts: 0,
      authorizedPayers: 0,
      paymentMethods: [],
    });
  });

  it("also strips aliases from a MOBO answer, and defaults to the client mobo", async () => {
    const h = makeRestClient(
      json({
        ...FAKE_CUSTOMER_MOBO_WIRE,
        creditCardAliases: [{ ccType: "VIS", ccAlias: FAKE_CARD_ALIAS }],
      }),
    );
    const info = await h.client.customers.getMobo();
    expect(JSON.stringify(info)).not.toContain(FAKE_CARD_ALIAS);
    expect(firstApi(h).url).toBe(`${CUSTOMERINFO}/customers/1234567/behalfof/1234567`);
    await h.client.customers.getMobo("7654321");
    expect(h.apiRequests()[1]?.url).toBe(`${CUSTOMERINFO}/customers/1234567/behalfof/7654321`);
  });

  it("refuses a MOBO that is not a customer number", async () => {
    const h = makeRestClient(json({}));
    expect(await caught(h.client.customers.getMobo("../1"))).toBeInstanceOf(
      CanadaPostValidationError,
    );
    expect(h.apiRequests()).toHaveLength(0);
  });

  it("rejects an answer without a customer number", async () => {
    const h = makeRestClient(json({ name: "x" }));
    expect(await caught(h.client.customers.get())).toMatchObject({ name: "CanadaPostParseError" });
  });

  it("scrubs a card alias from later error text and debug events", async () => {
    const events: CanadaPostDebugEvent[] = [];
    const h = makeRestClient(
      (_r, index) =>
        index === 0
          ? json(FAKE_CUSTOMER_WIRE)
          : { status: 400, body: `Bad request mentioning ${FAKE_CARD_ALIAS} again` },
      { overrides: { onDebug: (e) => events.push(e) } },
    );
    await h.client.customers.get();
    const error = (await caught(h.client.rating.listServices())) as CanadaPostApiError;
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect(String(error.message) + (error.bodyExcerpt ?? "")).not.toContain(FAKE_CARD_ALIAS);
    expect(error.bodyExcerpt).toContain("[REDACTED]");
    expect(JSON.stringify(events)).not.toContain(FAKE_CARD_ALIAS);
  });

  it("drops card aliases from JSON returned by followLink", async () => {
    const h = makeRestClient(
      json({ nested: [{ creditCardAliases: [{ ccAlias: FAKE_CARD_ALIAS }], keep: 1 }] }),
    );
    const followed = (await h.client.followLink({
      rel: "self",
      href: `${CUSTOMERINFO}/customers/1234567`,
      mediaType: "application/json",
    })) as Extract<RestFollowedLink, { kind: "json" }>;
    expect(followed.body).toEqual({ nested: [{ keep: 1 }] });
  });

  it("surfaces the empty 403 Production answers while the organization is not linked", async () => {
    const h = makeRestClient({ status: 403, body: "" });
    expect(await caught(h.client.customers.get())).toMatchObject({
      name: "CanadaPostAccessDeniedError",
      emptyBody: true,
    });
  });
});

describe("returns", () => {
  const RETURNS_ACCOUNT = `${RETURNS}/1234567/1234567`;

  it("creates an authorized return and downloads its label", async () => {
    const h = makeRestClient((r) =>
      r.method === "POST"
        ? json(FAKE_AUTHORIZED_RETURN)
        : { status: 200, body: fakePdf(1), headers: PDF_HEADERS },
    );
    const created = await h.client.returns.createAuthorized(FAKE_AUTHORIZED_RETURN_REQUEST);
    expect(created.trackingPin).toBe(FAKE_AUTHORIZED_RETURN.trackingPin);
    const label = await h.client.returns.getAuthorizedLabel(created);
    expect(label.contentType).toBe("application/pdf");
    expect(h.apiRequests().map((r) => r.url)).toEqual([
      `${RETURNS_ACCOUNT}/authorized-returns`,
      FAKE_AUTHORIZED_RETURN.links[0]?.href,
    ]);
  });

  it("creates, lists, reads and deletes open-return templates", async () => {
    const h = makeRestClient((r) => {
      if (r.method === "DELETE") return { status: 204 };
      if (r.url.endsWith("/details"))
        return json({ artifactsRemaining: 3, openReturn: FAKE_OPEN_RETURN_REQUEST });
      if (r.url.endsWith("/open-returns") && r.method === "GET") return json([]);
      return json(FAKE_OPEN_RETURN);
    });
    await h.client.returns.createOpen(FAKE_OPEN_RETURN_REQUEST);
    expect(await h.client.returns.listOpen()).toEqual([]);
    await h.client.returns.getOpen(FAKE_OPEN_RETURN_ID);
    await h.client.returns.getOpenDetails(FAKE_OPEN_RETURN_ID);
    await h.client.returns.deleteOpen(FAKE_OPEN_RETURN_ID);
    expect(h.apiRequests().map((r) => `${r.method} ${r.url.replace(RETURNS_ACCOUNT, "")}`)).toEqual(
      [
        "POST /open-returns",
        "GET /open-returns",
        `GET /open-returns/${FAKE_OPEN_RETURN_ID}`,
        `GET /open-returns/${FAKE_OPEN_RETURN_ID}/details`,
        `DELETE /open-returns/${FAKE_OPEN_RETURN_ID}`,
      ],
    );
  });

  it("the writes are sent once and are indeterminate when ambiguous", async () => {
    await expectNeverRetried((h) =>
      h.client.returns.createAuthorized(FAKE_AUTHORIZED_RETURN_REQUEST),
    );
    await expectNeverRetried((h) => h.client.returns.createOpen(FAKE_OPEN_RETURN_REQUEST));
    await expectNeverRetried((h) => h.client.returns.deleteOpen(FAKE_OPEN_RETURN_ID));
  });

  it("downloading the next open-return label consumes one: no retry, no replay", async () => {
    await expectNeverRetried((h) => h.client.returns.getOpenArtifact(FAKE_OPEN_RETURN_ID));
    const h = makeRestClient({ status: 200, body: fakePdf(1), headers: PDF_HEADERS });
    const label = await h.client.returns.getOpenArtifact(FAKE_OPEN_RETURN_ID);
    expect(label.contentType).toBe("application/pdf");
    expect(firstApi(h).url).toBe(`${RETURNS_ACCOUNT}/open-returns/${FAKE_OPEN_RETURN_ID}/artifact`);
  });

  it("downloads an open-return label through its artifact link", async () => {
    const h = makeRestClient({ status: 200, body: fakePdf(1), headers: PDF_HEADERS });
    const link = FAKE_OPEN_RETURN.links[1];
    if (link === undefined) throw new Error("fixture");
    await h.client.returns.getOpenArtifact(link);
    expect(firstApi(h).url).toBe(link.href);
  });

  it("an authorized-return label is a re-readable download: retried on 503", async () => {
    const h = makeRestClient([gateway, { status: 200, body: fakePdf(1), headers: PDF_HEADERS }]);
    await h.client.returns.getAuthorizedLabel(FAKE_AUTHORIZED_RETURN);
    expect(h.apiRequests()).toHaveLength(2);
  });

  it("validates requests locally", async () => {
    const h = makeRestClient(json(FAKE_OPEN_RETURN));
    for (const promise of [
      h.client.returns.createOpen({ ...FAKE_OPEN_RETURN_REQUEST, maxNumberOfArtifacts: 0 }),
      h.client.returns.createOpen({ ...FAKE_OPEN_RETURN_REQUEST, maxNumberOfArtifacts: 1.5 }),
      h.client.returns.createOpen({ ...FAKE_OPEN_RETURN_REQUEST, serviceCode: "" }),
      h.client.returns.createAuthorized({
        ...FAKE_AUTHORIZED_RETURN_REQUEST,
        serviceCode: "S".repeat(33),
      }),
      h.client.returns.getOpen("../x"),
    ]) {
      expect(await caught(promise)).toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.apiRequests()).toHaveLength(0);
  });

  it("needs a label link on an authorized return", async () => {
    const h = makeRestClient(json({}));
    const error = await caught(
      h.client.returns.getAuthorizedLabel({ links: [{ rel: "self", href: "x", mediaType: "x" }] }),
    );
    expect(String(error)).toMatch(/rel="label"/);
  });
});

describe("pickup", () => {
  const PICKUPS = `${PICKUP}/1234567/pickup-request`;

  it("creates a pickup with a POST and returns the 201 body", async () => {
    const h = makeRestClient(json(FAKE_PICKUP_CREATED, 201));
    const created = await h.client.pickup.create(FAKE_PICKUP_REQUEST);
    expect(created.pickupRequestHeader?.requestId).toBe(FAKE_PICKUP_ID);
    const r = firstApi(h);
    expect([r.method, r.url]).toEqual(["POST", PICKUPS]);
    expect(bodyOf(r)).toEqual(FAKE_PICKUP_REQUEST);
  });

  it("updates with PUT and cancels with DELETE (204, no body)", async () => {
    const h = makeRestClient({ status: 204 });
    await h.client.pickup.update(FAKE_PICKUP_ID, FAKE_PICKUP_UPDATE);
    await h.client.pickup.cancel(FAKE_PICKUP_ID);
    expect(h.apiRequests().map((r) => `${r.method} ${r.url}`)).toEqual([
      `PUT ${PICKUPS}/${FAKE_PICKUP_ID}`,
      `DELETE ${PICKUPS}/${FAKE_PICKUP_ID}`,
    ]);
    expect(bodyOf(h.apiRequests()[0] ?? firstApi(h))).toEqual(FAKE_PICKUP_UPDATE);
  });

  it("create, update and cancel are sent once and are indeterminate when ambiguous", async () => {
    await expectNeverRetried((h) => h.client.pickup.create(FAKE_PICKUP_REQUEST));
    await expectNeverRetried((h) => h.client.pickup.update(FAKE_PICKUP_ID, FAKE_PICKUP_UPDATE));
    await expectNeverRetried((h) => h.client.pickup.cancel(FAKE_PICKUP_ID));
  });

  it("pickup.list surfaces the production 400 for an account with no open pickups as an API error", async () => {
    // ASSUMPTION (contracts doc, section 11): not special-cased, the cause is unconfirmed.
    const h = makeRestClient({
      status: 400,
      body: JSON.stringify({
        errors: [{ errorCode: "400", message: "Invalid input provided. Please verify." }],
      }),
    });
    const error = await caught(h.client.pickup.list());
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect(error).toMatchObject({ status: 400 });
    expect(h.apiRequests()).toHaveLength(1);
  });

  it("reads list, details, price and availability", async () => {
    const h = makeRestClient(json({}));
    await h.client.pickup.list();
    await h.client.pickup.getDetails(FAKE_PICKUP_ID);
    await h.client.pickup.getPrice({
      date: "2026-12-01",
      contractId: "0001234567",
      priorityFlag: false,
      alternateAddressPostalCode: "m5v 2t6",
    });
    await h.client.pickup.getAvailability("k1a 0b1");
    expect(h.apiRequests().map((r) => r.url)).toEqual([
      PICKUPS,
      `${PICKUPS}/${FAKE_PICKUP_ID}/details`,
      `${PICKUPS}/price?date=2026-12-01&contractId=0001234567&priorityFlag=false&alternateAddressPostalCode=M5V2T6`,
      `${PICKUP}/pickup-availability/K1A0B1`,
    ]);
  });

  it("validates requests locally", async () => {
    const h = makeRestClient(json({}));
    const time = (patch: object): typeof FAKE_PICKUP_REQUEST => ({
      ...FAKE_PICKUP_REQUEST,
      pickupTimes: {
        onDemandPickupTime: { ...FAKE_PICKUP_REQUEST.pickupTimes.onDemandPickupTime, ...patch },
      },
    });
    for (const promise of [
      h.client.pickup.create({ ...FAKE_PICKUP_REQUEST, pickupType: "Scheduled" as never }),
      h.client.pickup.create(time({ date: "2026-02-30" })),
      h.client.pickup.create(time({ preferredTime: "25:00" })),
      h.client.pickup.create(time({ closingTime: "5pm" })),
      h.client.pickup.create({ ...FAKE_PICKUP_REQUEST, pickupVolume: "v".repeat(41) }),
      h.client.pickup.create({
        ...FAKE_PICKUP_REQUEST,
        contactInfo: { ...FAKE_PICKUP_REQUEST.contactInfo, contactPhone: "5555550100" },
      }),
      h.client.pickup.update(FAKE_PICKUP_ID, {
        ...FAKE_PICKUP_UPDATE,
        pickupVolume: "v".repeat(41),
      }),
      h.client.pickup.cancel("../1"),
      h.client.pickup.getPrice({ date: "soon" }),
      h.client.pickup.getPrice({ date: "2026-12-01", contractId: "abc" }),
      h.client.pickup.getAvailability("90210"),
    ]) {
      expect(await caught(promise)).toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.apiRequests()).toHaveLength(0);
  });
});

describe("post offices", () => {
  it("searches by postal code and reads one office", async () => {
    const h = makeRestClient((r) =>
      r.url.endsWith("/details") ? json(FAKE_POST_OFFICE_DETAIL) : json(FAKE_POST_OFFICES),
    );
    const offices = await h.client.postOffices.find({
      postalCode: "k1a 0b1",
      maximum: 3,
      d2po: true,
      bflf: false,
      tonight: true,
      province: "on",
      city: "Ottawa",
      streetName: "Main",
    });
    expect(offices).toEqual(FAKE_POST_OFFICES);
    const url = new URL(firstApi(h).url);
    expect(url.origin + url.pathname).toBe(`${POSTOFFICE}/post-offices`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      maximum: "3",
      d2po: "true",
      bflf: "false",
      tonight: "true",
      "postal-code": "K1A0B1",
      province: "ON",
      city: "Ottawa",
      "street-name": "Main",
    });
    const detail = await h.client.postOffices.getDetails("0000102978");
    expect(detail.hoursList[0]?.day).toBe(1);
    expect(h.apiRequests()[1]?.url).toBe(`${POSTOFFICE}/post-offices/0000102978/details`);
  });

  it("searches by coordinates", async () => {
    const h = makeRestClient(json([]));
    await h.client.postOffices.find({ latitude: 45.42, longitude: -75.69 });
    const params = new URL(firstApi(h).url).searchParams;
    expect([params.get("latitude"), params.get("longitude")]).toEqual(["45.42", "-75.69"]);
  });

  it("refuses unfiltered or inconsistent searches", async () => {
    const h = makeRestClient(json([]));
    for (const promise of [
      h.client.postOffices.find({}),
      h.client.postOffices.find({ maximum: 5 }),
      h.client.postOffices.find({ latitude: 45, city: "Ottawa" }),
      h.client.postOffices.find({ postalCode: "K1A0B1", maximum: 51 }),
      h.client.postOffices.find({ postalCode: "K1A0B1", maximum: 0 }),
      h.client.postOffices.find({ postalCode: "K1A0B1", province: "Ontario" }),
      h.client.postOffices.find({ postalCode: "nope" }),
      h.client.postOffices.getDetails("a/b"),
    ]) {
      expect(await caught(promise)).toBeInstanceOf(CanadaPostValidationError);
    }
    expect(h.apiRequests()).toHaveLength(0);
  });
});

describe("service information", () => {
  it("reads the service-outage messages", async () => {
    const h = makeRestClient(json(FAKE_SERVICE_MESSAGES));
    expect(await h.client.serviceInfo.getMessages()).toEqual(FAKE_SERVICE_MESSAGES);
    expect(firstApi(h).url).toBe(`${SERVICEINFO}/shipments-service?message-type=SO`);
  });
});

describe("APIs the app is not subscribed to", () => {
  it("surfaces the gateway 401 as a typed, non-retryable API error", async () => {
    const h = makeRestClient({
      status: 401,
      body: JSON.stringify({
        httpCode: "401",
        httpMessage: "Unauthorized",
        moreInformation: "Cannot find valid subscription for the incoming API request.",
      }),
      headers: { "content-type": "application/json" },
    });
    const error = (await caught(h.client.pickup.getAvailability("K1A0B1"))) as CanadaPostApiError;
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect(error.status).toBe(401);
    expect(error.message).toMatch(/Cannot find valid subscription/);
    // 401 on a read is replayed once with a fresh token, then reported.
    expect(h.apiRequests()).toHaveLength(2);
    expect(h.tokenRequests()).toHaveLength(2);
  });
});

describe("the committed Post Office document", () => {
  it("still has the double-escaped patterns the test validator repairs (remove the repair when this fails)", () => {
    const raw = readFileSync(
      join(
        resolve(import.meta.dirname, "..", "..", "..", "docs", "research", "openapi"),
        "postoffice-v1.json",
      ),
      "utf8",
    );
    const doc = JSON.parse(raw) as { components: { schemas: { officeId: { pattern: string } } } };
    expect(doc.components.schemas.officeId.pattern).toBe("^\\\\d{10}$");
  });
});
