// LIVE TEST-APP suite: the shipment lifecycle against the Test app's static stubs.
//
// create -> get -> details -> price -> label -> void, plus negative cases. Allowed to write
// ONLY because `assertTestApp()` runs in beforeAll and proves a Test app (no postage, canned
// answers). Every response is validated against Canada Post's OpenAPI schema.
// Runs only with CANADAPOST_TEST_APP_LIVE=true.
import { beforeAll, describe, expect, it } from "vitest";
import {
  CanadaPostApiError,
  findRestLink,
  requireRestLink,
  type RestCreateShipmentResponse,
} from "../../src/index.js";
import { expectValid, loadSpec, validateRequest, validateResponse } from "../support/openapi.js";
import { buildShipmentRequest } from "./data.js";
import { liveEnabled, testAppClient, uniqueRequestId } from "./setup.js";

/** Counts `/Type /Page` objects (not `/Pages`) in an uncompressed PDF. */
function pdfPageCount(data: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(data);
  return (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

describe.skipIf(!liveEnabled)("Canada Post Test app: shipment lifecycle", () => {
  const shipping = loadSpec("shipping-v1");
  const requestId = uniqueRequestId("SDKLIVE");
  let created: RestCreateShipmentResponse;

  beforeAll(async () => {
    await testAppClient().assertTestApp();
  });

  it("the request we send satisfies the OpenAPI request schema", () => {
    expectValid(
      "PostShipment request",
      validateRequest(shipping, "PostShipment", buildShipmentRequest(requestId)),
    );
  });

  it("creates a shipment (transmitShipment: true) and returns a schema-valid response", async () => {
    created = await testAppClient().shipments.create(buildShipmentRequest(requestId));
    expectValid("PostShipment 200", validateResponse(shipping, "PostShipment", 200, created));
    expect(created.shipmentId).toMatch(/^\d+$/);
    expect(typeof created.shipmentStatus).toBe("string");
    for (const rel of ["self", "details", "price", "label"]) {
      expect(findRestLink(created.links, rel), `rel=${rel}`).toBeDefined();
    }
    const label = requireRestLink(created.links, "label");
    expect(label.mediaType).toBe("application/pdf");
  });

  it("gets the shipment through its self link and by id", async () => {
    const byLink = await testAppClient().shipments.get(requireRestLink(created.links, "self"));
    expectValid("getShipmentById 200", validateResponse(shipping, "getShipmentById", 200, byLink));
    const byId = await testAppClient().shipments.get(created.shipmentId);
    expectValid("getShipmentById 200", validateResponse(shipping, "getShipmentById", 200, byId));
  });

  it("gets schema-valid details through the details link", async () => {
    const details = await testAppClient().shipments.getDetails(
      requireRestLink(created.links, "details"),
    );
    expectValid(
      "GetShipmentIdDetails 200",
      validateResponse(shipping, "GetShipmentIdDetails", 200, details),
    );
    expect(details.shipmentDetail?.deliverySpec?.serviceCode).toMatch(/^[A-Z]+\.[A-Z0-9]+$/);
  });

  it("documents the Test app's array-wrapped details and price (the OpenAPI document says object)", async () => {
    const client = testAppClient();
    for (const rel of ["details", "price"]) {
      const raw = await client.followLink(requireRestLink(created.links, rel));
      expect(raw.kind).toBe("json");
      if (raw.kind !== "json") continue;
      // Either the specified object, or the stub's one-element array: nothing else.
      const ok =
        (typeof raw.body === "object" && raw.body !== null && !Array.isArray(raw.body)) ||
        (Array.isArray(raw.body) && raw.body.length === 1);
      expect(
        ok,
        `${rel}: unexpected shape ${Array.isArray(raw.body) ? "array" : typeof raw.body}`,
      ).toBe(true);
    }
  });

  it("gets a schema-valid price through the price link", async () => {
    const price = await testAppClient().shipments.getPrice(requireRestLink(created.links, "price"));
    expectValid("getShipmentPrice 200", validateResponse(shipping, "getShipmentPrice", 200, price));
    expect(price.dueAmount).toBeGreaterThan(0);
    expect(price.dueAmount).toBeCloseTo(
      Math.round((price.preTaxAmount + price.gstAmount + price.pstAmount + price.hstAmount) * 100) /
        100,
      2,
    );
  });

  it("downloads a real PDF label (magic bytes, pages, size)", async () => {
    const label = await testAppClient().shipments.getLabel(created);
    expect(label.contentType).toBe("application/pdf");
    expect(new TextDecoder("latin1").decode(label.data.subarray(0, 5))).toBe("%PDF-");
    expect(pdfPageCount(label.data)).toBeGreaterThanOrEqual(1);
    expect(label.data.byteLength).toBeGreaterThan(1_000);
    expect(label.data.byteLength).toBeLessThan(5_000_000);
    expect(new TextDecoder("latin1").decode(label.data.subarray(-64))).toContain("%%EOF");
  });

  it("downloads the label through the label link as well", async () => {
    const label = await testAppClient().shipments.getLabel(requireRestLink(created.links, "label"));
    expect(label.contentType).toBe("application/pdf");
    expect(label.data.byteLength).toBeGreaterThan(1_000);
  });

  it("finds shipments again by customerRequestId (the indeterminate-create recovery path)", async () => {
    // The Test app answers canned data; the contract is a list of schema-valid links.
    const links = await testAppClient().shipments.list({ requestId });
    expectValid("getShipments 200", validateResponse(shipping, "getShipments", 200, links));
  });

  it("voids the shipment through its self link (HTTP 204)", async () => {
    await expect(
      testAppClient().shipments.void(requireRestLink(created.links, "self")),
    ).resolves.toBeUndefined();
  });

  it("voiding an unknown shipment id is either accepted by the stub or a typed 4xx", async () => {
    const outcome = await testAppClient()
      .shipments.void("999999999999999999")
      .then(() => "voided" as const)
      .catch((e: unknown) => e);
    if (outcome !== "voided") {
      expect(outcome).toBeInstanceOf(CanadaPostApiError);
      expect([400, 404]).toContain((outcome as CanadaPostApiError).status);
    }
  });

  it("rejects a create request that breaks the schema with a typed 400 (and no shipment)", async () => {
    const error = await testAppClient()
      .shipments.create({ transmitShipment: true, deliverySpec: {} } as never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CanadaPostApiError);
    expect((error as CanadaPostApiError).status).toBe(400);
  });

  it("never follows a label link that leaves the Canada Post host", async () => {
    await expect(
      testAppClient().shipments.getLabel({
        rel: "label",
        href: "https://example.invalid/prod/devportal-portaildesdeveloppeurs/shipping/v1/artifacts/x/shipping/1/0",
        mediaType: "application/pdf",
      }),
    ).rejects.toMatchObject({ name: "CanadaPostConfigurationError" });
  });
});
