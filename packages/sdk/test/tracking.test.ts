import { describe, expect, it } from "vitest";
import { CanadaPostApiError, CanadaPostValidationError, MEDIA_TYPES } from "../src/index.js";
import {
  ERROR_NO_PIN_HISTORY,
  FIXTURE_HOST,
  TRACKING_DETAIL_RESPONSE,
  TRACKING_SUMMARY_RESPONSE,
} from "./fixtures.js";
import { first, makeClient, xml } from "./helpers.js";

const TR = MEDIA_TYPES.tracking;

describe("tracking", () => {
  it("getSummary by PIN GETs /vis/track/pin/{pin}/summary with the track-v2 media type", async () => {
    const { client, mock } = makeClient(xml(TRACKING_SUMMARY_RESPONSE, TR));
    const res = await client.tracking.getSummary({ pin: "123456789012" });
    expect(first(mock).method).toBe("GET");
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/vis/track/pin/123456789012/summary`);
    expect(first(mock).headers["accept"]).toBe("application/vnd.cpc.track-v2+xml");
    expect(res.pins).toHaveLength(1);
    expect(res.pins[0]).toMatchObject({
      pin: "123456789012",
      originPostalId: "K1G",
      destinationProvince: "ON",
      serviceName: "Expedited Parcels",
      mailedOnDate: "2011-04-04",
      expectedDeliveryDate: "2011-04-05",
      actualDeliveryDate: undefined,
      deliveryOptionCompletedInd: 2,
      eventDateTime: "20110404:133457",
      eventType: "INDUCTION",
      customerRef1: "REF1A",
      returnPin: undefined,
    });
  });

  it("getSummary by DNC uses the dnc path and normalises several pin-summary elements", async () => {
    const two = `<tracking-summary><pin-summary><pin>123456789012</pin></pin-summary><pin-summary><pin>123456789013</pin></pin-summary></tracking-summary>`;
    const { client, mock } = makeClient(xml(two, TR));
    const res = await client.tracking.getSummary({ dnc: "315052413796541" });
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/vis/track/dnc/315052413796541/summary`);
    expect(res.pins.map((p) => p.pin)).toEqual(["123456789012", "123456789013"]);
  });

  it("getDetails by PIN and DNC use /detail and parse events (newest first)", async () => {
    const { client, mock } = makeClient(xml(TRACKING_DETAIL_RESPONSE, TR));
    const d = await client.tracking.getDetails({ pin: "123456789012" });
    await client.tracking.getDetails({ dnc: "315052413796541" });
    expect(mock.requests.map((r) => r.url)).toEqual([
      `${FIXTURE_HOST}/vis/track/pin/123456789012/detail`,
      `${FIXTURE_HOST}/vis/track/dnc/315052413796541/detail`,
    ]);
    expect(d).toMatchObject({
      pin: "123456789012",
      activeExists: true,
      archiveExists: undefined,
      expectedDeliveryDate: "2011-02-01",
      changedExpectedDate: "2011-02-11",
      mailedByCustomerNumber: "0001234567",
      signatureImageExists: true,
      suppressSignature: false,
      serviceName: "Xpresspost",
    });
    expect(d.deliveryOptions).toEqual([
      { option: "CH_SGN_OPTION", description: "Signature Required" },
    ]);
    expect(d.events).toHaveLength(2);
    expect(d.events[0]).toMatchObject({
      identifier: "1496",
      date: "2011-02-01",
      time: "07:59:52",
      timeZone: "EST",
      description: "Item successfully delivered",
      province: "QC",
    });
  });

  it("accepts the <item> spelling of events used by one documentation sample", async () => {
    const body = `<tracking-detail><pin>123456789012</pin><significant-events><item><event-identifier>3000</event-identifier><event-description>Order information received</event-description></item></significant-events></tracking-detail>`;
    const { client } = makeClient(xml(body, TR));
    const d = await client.tracking.getDetails({ pin: "123456789012" });
    expect(d.events).toHaveLength(1);
    expect(d.events[0]?.identifier).toBe("3000");
  });

  it("maps 'No PIN History' to a typed API error with code 004", async () => {
    const { client } = makeClient(xml(ERROR_NO_PIN_HISTORY, TR, 404));
    const err = (await client.tracking
      .getSummary({ pin: "123456789012" })
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(err).toBeInstanceOf(CanadaPostApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("004");
    expect(err.description).toBe("No Pin History");
  });

  it("validates PIN and DNC formats locally", async () => {
    const { client, mock } = makeClient(xml(TRACKING_SUMMARY_RESPONSE, TR));
    await expect(client.tracking.getSummary({ pin: "../x" })).rejects.toBeInstanceOf(
      CanadaPostValidationError,
    );
    await expect(client.tracking.getSummary({ pin: "123" })).rejects.toThrow(/12-16/);
    await expect(client.tracking.getSummary({ dnc: "12345" })).rejects.toThrow(/15 digits/);
    await expect(client.tracking.getDetails({ pin: "1234567890123456789" })).rejects.toBeInstanceOf(
      CanadaPostValidationError,
    );
    expect(mock.requests).toHaveLength(0);
  });

  it("tolerates whitespace around a pasted PIN", async () => {
    const { client, mock } = makeClient(xml(TRACKING_SUMMARY_RESPONSE, TR));
    await client.tracking.getSummary({ pin: " 1234 5678 9012 " });
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/vis/track/pin/123456789012/summary`);
  });
});
