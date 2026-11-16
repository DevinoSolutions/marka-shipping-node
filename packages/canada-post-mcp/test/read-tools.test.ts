import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN,
  ACCOUNT,
  BASE,
  LINK,
  QUOTES,
  SECRET,
  json,
  makeHarness,
  type Harness,
  type Route,
} from "./support/harness.js";
import {
  CUSTOMER_WIRE,
  PDF_BYTES,
  PICKUP_PRICE,
  PIN,
  SHIPMENT_ID,
  SHIPMENT_PRICE,
  TRACKING_SUMMARY,
  shipmentRoutes,
} from "./support/fixtures.js";

let harness: Harness | undefined;
const dirs: string[] = [];

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function start(routes: Route[] = [], env: Record<string, string> = {}): Promise<Harness> {
  harness = await makeHarness({ routes, env });
  return harness;
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cp-mcp-test-"));
  dirs.push(dir);
  return dir;
}

const QUOTE_INPUT = {
  originPostalCode: "k1a 0b1",
  destination: { domestic: { postalCode: "m5v 2t6" } },
  parcelCharacteristics: { weight: 1, dimensions: { length: 20, width: 15, height: 6 } },
};

describe("tool listing without write flags", () => {
  it("offers the 20 read tools and no write tool", async () => {
    const h = await start();
    const names = await h.toolNames();
    expect(names).toHaveLength(20);
    expect(names.every((n) => !n.startsWith("canadapost_preview_"))).toBe(true);
    expect(names).not.toContain("canadapost_apply");
    expect(names).toEqual(
      expect.arrayContaining([
        "canadapost_quote",
        "canadapost_track_by_pin",
        "canadapost_shipment_label",
        "canadapost_customer_payment_readiness",
        "canadapost_post_offices_find",
        "canadapost_pickup_availability",
      ]),
    );
  });

  it("marks every read tool read-only with a strict input schema", async () => {
    const h = await start();
    const { tools } = await h.mcp.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      const schema = tool.inputSchema as { additionalProperties?: unknown };
      expect(schema.additionalProperties, tool.name).toBe(false);
    }
  });

  it("refuses unknown properties instead of ignoring them", async () => {
    const h = await start();
    const result = await h.call("canadapost_track_by_pin", { pin: PIN, surprise: true });
    expect(result.isError).toBe(true);
    expect(h.apiRequests()).toHaveLength(0);
  });
});

describe("quotes and services", () => {
  it("quotes with normalized postal codes and reports the app", async () => {
    const h = await start();
    const startup = h.apiRequests().length;
    const r = await h.call("canadapost_quote", QUOTE_INPUT);
    expect(r.isError).toBe(false);
    expect(r.data.app).toBe("test");
    expect(r.data.quotes).toEqual(QUOTES);
    const sent = h.apiRequests()[startup];
    expect(sent?.method).toBe("POST");
    const body = JSON.parse(sent?.body ?? "{}") as {
      originPostalCode: string;
      destination: { domestic: { postalCode: string } };
    };
    expect(body.originPostalCode).toBe("K1A0B1");
    expect(body.destination.domestic.postalCode).toBe("M5V2T6");
  });

  it("rejects a malformed postal code before any request", async () => {
    const h = await start();
    const startup = h.apiRequests().length;
    const r = await h.call("canadapost_quote", { ...QUOTE_INPUT, originPostalCode: "12345" });
    expect(r.isError).toBe(true);
    expect(h.apiRequests()).toHaveLength(startup);
  });

  it("lists services, one service and one option", async () => {
    const h = await start([
      {
        method: "GET",
        path: /\/rating\/v1\/services$/,
        reply: json([
          {
            serviceCode: "DOM.EP",
            serviceName: "Expedited Parcel",
            link: {
              rel: "service",
              href: `${BASE}/rating/v1/services/DOM.EP`,
              mediaType: "application/json",
            },
          },
        ]),
      },
      {
        method: "GET",
        path: /\/rating\/v1\/services\/DOM\.EP$/,
        reply: json({ serviceCode: "DOM.EP", serviceName: "Expedited Parcel", options: [] }),
      },
      {
        method: "GET",
        path: /\/rating\/v1\/options\/DC$/,
        reply: json({ optionCode: "DC", optionName: "Delivery confirmation" }),
      },
    ]);
    const list = await h.call("canadapost_services_list", { country: "ca" });
    expect(list.isError).toBe(false);
    expect((list.data.services as unknown[]).length).toBe(1);
    const one = await h.call("canadapost_service_get", { serviceCode: "DOM.EP" });
    expect((one.data.service as { serviceCode: string }).serviceCode).toBe("DOM.EP");
    const option = await h.call("canadapost_option_get", { optionCode: "DC" });
    expect((option.data.option as { optionCode: string }).optionCode).toBe("DC");
    const bad = await h.call("canadapost_service_get", { serviceCode: "../../etc" });
    expect(bad.isError).toBe(true);
  });
});

describe("tracking", () => {
  it("tracks by PIN (summary and detail), DNC and reference", async () => {
    const h = await start([
      {
        method: "GET",
        path: new RegExp(`/tracking/v1/pins/${PIN}/summaries$`),
        reply: json(TRACKING_SUMMARY),
      },
      {
        method: "GET",
        path: new RegExp(`/tracking/v1/pins/${PIN}/details$`),
        reply: json({ pin: PIN, activeExists: true, significantEvents: [] }),
      },
      {
        method: "GET",
        path: /\/tracking\/v1\/dncs\/\d{15}\/summaries$/,
        reply: json(TRACKING_SUMMARY),
      },
      { method: "GET", path: /\/tracking\/v1\/refs\/summaries$/, reply: json(TRACKING_SUMMARY) },
    ]);
    const summary = await h.call("canadapost_track_by_pin", { pin: PIN });
    expect(summary.isError).toBe(false);
    expect(summary.data.summary).toEqual(TRACKING_SUMMARY);
    const detail = await h.call("canadapost_track_by_pin", { pin: PIN, detail: true });
    expect((detail.data.details as { pin: string }).pin).toBe(PIN);
    const dnc = await h.call("canadapost_track_by_dnc", { dnc: "168067817265091" });
    expect(dnc.isError).toBe(false);
    const ref = await h.call("canadapost_track_by_reference", {
      referenceNumber: "REF1",
      mailingDateFrom: "2026-11-01",
      mailingDateTo: "2026-11-15",
    });
    expect(ref.isError).toBe(false);
    const refRequest = h.apiRequests().at(-1);
    expect(refRequest?.url).toContain("mailing-date-from=2026-11-01");
  });

  it("validates PIN and DNC shapes locally", async () => {
    const h = await start();
    const startup = h.apiRequests().length;
    expect((await h.call("canadapost_track_by_pin", { pin: "abc" })).isError).toBe(true);
    expect((await h.call("canadapost_track_by_dnc", { dnc: "123" })).isError).toBe(true);
    expect(h.apiRequests()).toHaveLength(startup);
  });
});

describe("shipment lookups", () => {
  it("gets a shipment and hides capability query values of links", async () => {
    const h = await start(shipmentRoutes());
    const r = await h.call("canadapost_shipment_get", { shipmentId: SHIPMENT_ID });
    expect(r.isError).toBe(false);
    const text = JSON.stringify(r.data);
    expect(text).toContain(SHIPMENT_ID);
    expect(text).not.toContain("SHOULD-NOT-LEAK");
    expect(text).toContain("REDACTED");
  });

  it("gets details and price", async () => {
    const h = await start(shipmentRoutes());
    const details = await h.call("canadapost_shipment_details", { shipmentId: SHIPMENT_ID });
    expect((details.data.details as { trackingPin: string }).trackingPin).toBe(PIN);
    const price = await h.call("canadapost_shipment_price", { shipmentId: SHIPMENT_ID });
    expect(price.data.price).toEqual(SHIPMENT_PRICE);
  });

  it("returns the receipt without a card number", async () => {
    const h = await start([
      {
        method: "GET",
        path: new RegExp(`/shipments/${SHIPMENT_ID}/receipt$`),
        reply: json({
          ccReceiptDetails: {
            merchantName: "Example Merchant",
            authCode: "A1B2C3",
            chargeAmount: 13,
            currency: "CAD",
          },
        }),
      },
    ]);
    const r = await h.call("canadapost_shipment_receipt", { shipmentId: SHIPMENT_ID });
    expect(r.isError).toBe(false);
    expect(JSON.stringify(r.data)).toContain("A1B2C3");
  });

  it("lists shipments, requiring a filter", async () => {
    const h = await start([
      {
        method: "GET",
        path: /\/shipments$/,
        reply: json([LINK("shipment", `/shipments/${SHIPMENT_ID}`)]),
      },
    ]);
    const r = await h.call("canadapost_shipments_list", { requestId: "REQ-0001" });
    expect(r.isError).toBe(false);
    expect((r.data.shipments as unknown[]).length).toBe(1);
    const none = await h.call("canadapost_shipments_list", {});
    expect(none.isError).toBe(true);
    expect(none.data.errorCode).toBe("validation");
    // date and limit only narrow another filter (production errorCode 9156)
    const dateOnly = await h.call("canadapost_shipments_list", { date: "2026-11-15", limit: 5 });
    expect(dateOnly.isError).toBe(true);
    expect(dateOnly.data.errorCode).toBe("validation");
  });

  it("lists groups and manifests, and gets a manifest with details", async () => {
    const h = await start([
      {
        method: "GET",
        path: /\/shipments$/,
        reply: json([]),
      },
      {
        method: "GET",
        path: new RegExp(`${ACCOUNT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/manifests$`),
        reply: json([LINK("manifest", "/manifests/PO00000001")]),
      },
      {
        method: "GET",
        path: /\/manifests\/PO00000001$/,
        reply: json({ poNumber: "PO00000001", links: [LINK("self", "/manifests/PO00000001")] }),
      },
      {
        method: "GET",
        path: /\/manifests\/PO00000001\/details$/,
        reply: json({ poNumber: "PO00000001", finalShippingPoint: "K1A0B1" }),
      },
    ]);
    const manifests = await h.call("canadapost_manifests_list", {
      from: "2026-11-01",
      to: "2026-11-15",
    });
    expect(manifests.isError).toBe(false);
    // `from` is required (production errorCode 9105): rejected before any request.
    const noFrom = await h.call("canadapost_manifests_list", { to: "2026-11-15" });
    expect(noFrom.isError).toBe(true);
    const one = await h.call("canadapost_manifest_get", {
      manifestId: "PO00000001",
      details: true,
    });
    expect(one.isError).toBe(false);
    expect((one.data.details as { finalShippingPoint: string }).finalShippingPoint).toBe("K1A0B1");
  });
});

describe("label download", () => {
  it("saves the label to the output directory and returns only the path", async () => {
    const dir = await tempDir();
    harness = await makeHarness({ routes: shipmentRoutes(), outputDir: dir });
    const r = await harness.call("canadapost_shipment_label", { shipmentId: SHIPMENT_ID });
    expect(r.isError).toBe(false);
    const label = r.data.label as { path: string; bytes: number; contentType: string };
    expect(label.path.startsWith(dir)).toBe(true);
    expect(label.path.endsWith(".pdf")).toBe(true);
    expect(label.bytes).toBe(PDF_BYTES.byteLength);
    expect(label.contentType).toBe("application/pdf");
    expect(new Uint8Array(await readFile(label.path))).toEqual(PDF_BYTES);
    expect(JSON.stringify(r.data)).not.toContain("JVBER");
  });

  it("writes to a caller-given absolute path and never overwrites", async () => {
    const dir = await tempDir();
    harness = await makeHarness({ routes: shipmentRoutes(), outputDir: dir });
    const target = join(dir, "mine.pdf");
    const first = await harness.call("canadapost_shipment_label", {
      shipmentId: SHIPMENT_ID,
      path: target,
    });
    expect(first.isError).toBe(false);
    const again = await harness.call("canadapost_shipment_label", {
      shipmentId: SHIPMENT_ID,
      path: target,
    });
    expect(again.isError).toBe(true);
    expect(again.data.errorCode).toBe("file_exists");
    expect((await stat(target)).size).toBe(PDF_BYTES.byteLength);
  });

  it("refuses a pre-existing file, relative paths, wrong extensions and escapes", async () => {
    const dir = await tempDir();
    harness = await makeHarness({ routes: shipmentRoutes(), outputDir: dir });
    const existing = join(dir, "existing.pdf");
    await writeFile(existing, "keep me");
    const exists = await harness.call("canadapost_shipment_label", {
      shipmentId: SHIPMENT_ID,
      path: existing,
    });
    expect(exists.data.errorCode).toBe("file_exists");
    expect(await readFile(existing, "utf8")).toBe("keep me");

    const relative = await harness.call("canadapost_shipment_label", {
      shipmentId: SHIPMENT_ID,
      path: "label.pdf",
    });
    expect(relative.data.errorCode).toBe("invalid_path");
    const extension = await harness.call("canadapost_shipment_label", {
      shipmentId: SHIPMENT_ID,
      path: join(dir, "label.txt"),
    });
    expect(extension.data.errorCode).toBe("invalid_path");
    const other = await tempDir();
    const outside = await harness.call("canadapost_shipment_label", {
      shipmentId: SHIPMENT_ID,
      path: join(other, "label.pdf"),
    });
    expect(outside.data.errorCode).toBe("invalid_path");
    const traversal = await harness.call("canadapost_shipment_label", {
      shipmentId: SHIPMENT_ID,
      path: join(dir, "..", "label.pdf"),
    });
    expect(traversal.data.errorCode).toBe("invalid_path");
  });

  it("without an output directory it uses a temp path and allows any absolute path", async () => {
    const h = await start(shipmentRoutes());
    expect(h.config.outputDirRestricted).toBe(false);
    const other = await tempDir();
    const target = join(other, "free.pdf");
    const r = await h.call("canadapost_shipment_label", { shipmentId: SHIPMENT_ID, path: target });
    expect(r.isError).toBe(false);
    expect((r.data.label as { path: string }).path).toBe(target);
  });
});

describe("customer, post offices and pickup", () => {
  it("reports payment readiness as a summary with no card data", async () => {
    const h = await start([
      {
        method: "GET",
        path: /\/customerinfo\/v1\/customers\/1234567$/,
        reply: json(CUSTOMER_WIRE),
      },
    ]);
    const r = await h.call("canadapost_customer_payment_readiness");
    expect(r.isError).toBe(false);
    const text = JSON.stringify(r.data);
    expect(text).not.toContain("FAKE-CARD-ALIAS");
    expect(text).not.toContain("ccAlias");
    expect(text).not.toContain("creditCardAliases");
    expect(r.data.readiness).toEqual({
      hasCreditCard: true,
      contracts: 1,
      authorizedPayers: 1,
      paymentMethods: ["Account", "CreditCard"],
    });
  });

  it("finds post offices", async () => {
    const h = await start([
      {
        method: "GET",
        path: /\/postoffice\/v1\/post-offices$/,
        reply: json([
          {
            address: { city: "OTTAWA", postalCode: "K1A0B1", province: "ON" },
            distance: 0.65,
            name: "Example Post Office",
            officeId: "0000102978",
          },
        ]),
      },
    ]);
    const r = await h.call("canadapost_post_offices_find", { postalCode: "k1a 0b1", maximum: 3 });
    expect(r.isError).toBe(false);
    expect(h.apiRequests().at(-1)?.url).toContain("K1A0B1");
    expect((r.data.postOffices as unknown[]).length).toBe(1);
  });

  it("checks pickup availability and prices a pickup", async () => {
    const h = await start([
      {
        method: "GET",
        path: /\/pickup\/v1\/pickup-availability\/K1A0B1$/,
        reply: json({ postalCode: "K1A0B1", onDemandCutoff: "15:00", onDemandTour: true }),
      },
      {
        method: "GET",
        path: /\/pickup\/v1\/1234567\/pickup-request\/price$/,
        reply: json(PICKUP_PRICE),
      },
    ]);
    const availability = await h.call("canadapost_pickup_availability", { postalCode: "K1A 0B1" });
    expect(availability.isError).toBe(false);
    const price = await h.call("canadapost_pickup_price", { date: "2026-12-01" });
    expect(price.isError).toBe(false);
  });
});

describe("errors and secrets", () => {
  it("maps a Canada Post API error to a structured payload", async () => {
    const h = await start([
      {
        method: "GET",
        path: new RegExp(`/shipments/${SHIPMENT_ID}$`),
        reply: json({ messages: [{ code: "E1234", description: "Shipment not found" }] }, 404),
      },
    ]);
    const r = await h.call("canadapost_shipment_get", { shipmentId: SHIPMENT_ID });
    expect(r.isError).toBe(true);
    expect(r.data.errorCode).toBe("api_error");
    expect(r.data.httpStatus).toBe(404);
  });

  it("maps an empty 403 to access_denied", async () => {
    const h = await start([
      {
        method: "GET",
        path: /\/customerinfo\/v1\/customers\/1234567$/,
        reply: { status: 403, body: "" },
      },
    ]);
    const r = await h.call("canadapost_customer_payment_readiness");
    expect(r.isError).toBe(true);
    expect(r.data.errorCode).toBe("access_denied");
    expect(r.data.emptyBody).toBe(true);
  });

  it("never returns or logs the credentials or the access token", async () => {
    const h = await start([
      ...shipmentRoutes(),
      {
        method: "GET",
        path: /\/tracking\/v1\/pins\/.*\/summaries$/,
        reply: { status: 500, body: `boom ${SECRET} Bearer ${ACCESS_TOKEN}-abcdef` },
      },
    ]);
    const results = [
      await h.call("canadapost_shipment_get", { shipmentId: SHIPMENT_ID }),
      await h.call("canadapost_track_by_pin", { pin: PIN }),
      await h.call("canadapost_quote", QUOTE_INPUT),
    ];
    const everything = JSON.stringify([results, h.logs]);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(ACCESS_TOKEN);
  });
});
