// LIVE TEST-APP suite: receipts, QR codes, groups, manifests and refunds of Shipping v1.
//
// Allowed to write (refund request, manifest transmit) ONLY because `assertTestApp()` runs in
// beforeAll and proves a Test app: nothing is refunded, billed or transmitted, the stubs just
// answer. The Test app accepts both writes (observed 2026-11-16). Every response is validated
// against Canada Post's OpenAPI schema. Runs only with CANADAPOST_TEST_APP_LIVE=true.
import { beforeAll, describe, expect, it } from "vitest";
import { CanadaPostApiError, findRestLink } from "../../src/index.js";
import { expectValid, loadSpec, validateRequest, validateResponse } from "../support/openapi.js";
import { buildTransmitRequest } from "./data.js";
import { liveEnabled, testAppClient, uniqueRequestId } from "./setup.js";

/**
 * KNOWN STUB DEVIATION (observed 2026-11-16): the Test app answers `authCode` of a card receipt
 * as a JSON number where the document says string. Pinned precisely: only that field.
 */
function normalizeReceipt(receipt: object): unknown {
  const copy = structuredClone(receipt) as Record<string, { authCode?: unknown } | undefined>;
  for (const block of Object.values(copy)) {
    if (block !== undefined && typeof block.authCode === "number") {
      block.authCode = String(block.authCode);
    }
  }
  return copy;
}

describe.skipIf(!liveEnabled)("Canada Post Test app: receipts, groups, manifests, refunds", () => {
  const shipping = loadSpec("shipping-v1");
  // The stubs answer any id, so a made-up one is enough to exercise the wire contract.
  const shipmentId = "100000000000000001";

  beforeAll(async () => {
    await testAppClient().assertTestApp();
  });

  it("returns a schema-valid receipt", async () => {
    const receipt = await testAppClient().shipments.getReceipt(shipmentId);
    expectValid(
      "GetShipmentReceipt 200",
      validateResponse(shipping, "GetShipmentReceipt", 200, normalizeReceipt(receipt)),
    );
    const detail =
      "ccReceiptDetails" in receipt
        ? receipt.ccReceiptDetails
        : receipt.supplierAccountReceiptDetails;
    expect(detail.chargeAmount).toBeGreaterThanOrEqual(0);
  });

  it("returns schema-valid public key info (QR code)", async () => {
    const info = await testAppClient().shipments.getQrCode(shipmentId);
    expectValid(
      "getShipmentQRCode 200",
      validateResponse(shipping, "getShipmentQRCode", 200, info),
    );
    expect(new URL(info.url).protocol).toBe("https:");
  });

  it("lists schema-valid shipment groups", async () => {
    const groups = await testAppClient().shipments.getGroups();
    expectValid(
      "getShipmentGroups 200",
      validateResponse(shipping, "getShipmentGroups", 200, groups),
    );
    for (const group of groups) expect(group.groupId).not.toBe("");
  });

  it("lists, reads and details manifests", async () => {
    const client = testAppClient();
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const ranged = await client.manifests.list({ from: weekAgo, to: today });
    expectValid("GetManifests 200", validateResponse(shipping, "GetManifests", 200, ranged));
    const all = await client.manifests.list({ from: "2020-01-01" });
    expectValid("GetManifests 200", validateResponse(shipping, "GetManifests", 200, all));
    const first = all[0];
    if (first === undefined) throw new Error("the Test app listed no manifests");
    const info = await client.manifests.get(first);
    expectValid("GetManifestById 200", validateResponse(shipping, "GetManifestById", 200, info));
    const detailsLink = findRestLink(info.links, "details");
    if (detailsLink === undefined) throw new Error("manifest has no details link");
    const details = await client.manifests.getDetails(detailsLink);
    expectValid(
      "GetManifestIdDetails 200",
      validateResponse(shipping, "GetManifestIdDetails", 200, details),
    );
    expect(details.manifestPricingInfo.totalDueCpc).toBeGreaterThanOrEqual(0);
  });

  it("the transmit request we send satisfies the OpenAPI request schema", () => {
    expectValid(
      "TransmitShipmentsManifest request",
      validateRequest(shipping, "TransmitShipmentsManifest", buildTransmitRequest("SDKLIVE-REQ")),
    );
  });

  it("transmits a manifest (a stub: nothing is billed) and returns schema-valid links", async () => {
    const links = await testAppClient().shipments.transmit(
      buildTransmitRequest(uniqueRequestId("SDKLIVE")),
    );
    expectValid(
      "TransmitShipmentsManifest 200",
      validateResponse(shipping, "TransmitShipmentsManifest", 200, links),
    );
    expect(links.length).toBeGreaterThanOrEqual(1);
  });

  it("asks for a refund, which the stub answers without opening a ticket, with a schema-valid ticket", async () => {
    const info = await testAppClient().shipments.requestRefund(shipmentId, {
      email: "sdk-live-test@example.com",
    });
    expectValid(
      "RequestShipmentRefund 200",
      validateResponse(shipping, "RequestShipmentRefund", 200, info),
    );
    expect(info.serviceTicketId).not.toBe("");
  });

  it("refuses a malformed refund e-mail locally, before anything is sent", async () => {
    await expect(
      testAppClient().shipments.requestRefund(shipmentId, { email: "not-an-email" }),
    ).rejects.toMatchObject({ name: "CanadaPostValidationError" });
  });

  it("rejects a manifest request the API refuses with a typed 4xx or accepts it as a stub", async () => {
    const outcome = await testAppClient()
      .shipments.transmit({
        ...buildTransmitRequest(uniqueRequestId("SDKLIVE")),
        methodOfPayment: "x".repeat(16),
      })
      .then(() => "accepted" as const)
      .catch((e: unknown) => e);
    if (outcome !== "accepted") {
      expect(outcome).toBeInstanceOf(CanadaPostApiError);
      expect((outcome as CanadaPostApiError).status).toBe(400);
    }
  });
});
