// LIVE TEST-APP smoke suite of the MCP server: list the tools, quote, track, and run a full
// shipment through preview then apply (create, then cancel it again). Allowed to write ONLY
// because `assertTestApp()` runs in beforeAll and proves a Test app (no postage, canned
// answers). Runs only with CANADAPOST_TEST_APP_LIVE=true.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  liveEnabled,
  openMcpSession,
  testAppClient,
  testCustomerNumber,
  uniqueRequestId,
  type McpSession,
} from "./setup.js";

// The PIN printed as an example in Canada Post's own documentation.
const PIN = "7023210215628702";

function nextWeekday(): string {
  const d = new Date();
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("expected an object");
  return value as Record<string, unknown>;
}

describe.skipIf(!liveEnabled)("Canada Post Test app: MCP smoke", () => {
  let reader: McpSession;
  let writer: McpSession;

  beforeAll(async () => {
    await testAppClient().assertTestApp();
    reader = await openMcpSession(false);
    writer = await openMcpSession(true);
  });

  afterAll(async () => {
    await reader.close();
    await writer.close();
  });

  it("lists the read tools only without the write flag, and the write tools with it", () => {
    expect(reader.toolNames).toHaveLength(20);
    expect(reader.toolNames.some((n) => n.startsWith("canadapost_preview_"))).toBe(false);
    expect(writer.toolNames).toHaveLength(28);
    expect(writer.toolNames).toContain("canadapost_apply");
  });

  it("quotes a parcel", async () => {
    const r = await reader.call("canadapost_quote", {
      originPostalCode: "K1A0B1",
      destination: { domestic: { postalCode: "M5V2T6" } },
      parcelCharacteristics: { weight: 1.2, dimensions: { length: 20, width: 15, height: 6 } },
    });
    expect(r.isError).toBe(false);
    const quotes = asObject(r.data).quotes;
    expect(Array.isArray(quotes) && quotes.length >= 1).toBe(true);
  });

  it("tracks a PIN", async () => {
    const r = await reader.call("canadapost_track_by_pin", { pin: PIN });
    expect(r.isError).toBe(false);
    const summary = asObject(r.data).summary;
    expect(Array.isArray(summary) && summary.length >= 1).toBe(true);
  });

  it("makes a shipment and takes it back through preview and apply", async () => {
    const preview = await writer.call("canadapost_preview_create_shipment", {
      customerRequestId: uniqueRequestId("MCPLIVE"),
      expectedMailingDate: nextWeekday(),
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
        parcelCharacteristics: { weight: 1.2, dimensions: { length: 20, width: 15, height: 6 } },
        settlementInfo: {
          paidByCustomer: testCustomerNumber(),
          intendedMethodOfPayment: "CreditCard",
        },
      },
    });
    expect(preview.isError, JSON.stringify(preview.data)).toBe(false);
    const previewData = asObject(preview.data);
    expect(previewData.app).toBe("test");
    expect(previewData.mayCharge).toBe(false);
    const token = String(previewData.confirmToken);

    const applied = await writer.call("canadapost_apply", { confirmToken: token });
    expect(applied.isError, JSON.stringify(applied.data)).toBe(false);
    const appliedData = asObject(applied.data);
    expect(appliedData.charged).toBe(false);
    const shipmentId = String(appliedData.shipmentId);
    expect(shipmentId).toMatch(/^\d+$/);

    const replay = await writer.call("canadapost_apply", { confirmToken: token });
    expect(replay.isError).toBe(true);
    expect(asObject(replay.data).errorCode).toBe("preview_already_used");

    const takeBack = await writer.call("canadapost_preview_void_shipment", { shipmentId });
    expect(takeBack.isError, JSON.stringify(takeBack.data)).toBe(false);
    const done = await writer.call("canadapost_apply", {
      confirmToken: String(asObject(takeBack.data).confirmToken),
    });
    expect(done.isError, JSON.stringify(done.data)).toBe(false);
    expect(asObject(done.data).voided).toBe(true);
  });
});
