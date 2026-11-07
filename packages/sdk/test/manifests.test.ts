import { describe, expect, it } from "vitest";
import { type CanadaPostApiError, MEDIA_TYPES } from "../src/index.js";
import {
  FIXTURE_HOST,
  MANIFEST_DETAILS_RESPONSE,
  MANIFEST_RESPONSE,
  MANIFESTS_RESPONSE,
} from "./fixtures.js";
import { first, makeClient, TEST_CUSTOMER, xml } from "./helpers.js";

const MF = MEDIA_TYPES.manifest;
const PREFIX = `${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/${TEST_CUSTOMER}`;

describe("manifests", () => {
  it("list sends start/end as YYYYMMDD and returns the manifest links", async () => {
    const { client, mock } = makeClient(xml(MANIFESTS_RESPONSE, MF));
    const res = await client.manifests.list({
      start: "2030-03-24",
      end: new Date("2030-04-05T12:00:00Z"),
    });
    expect(first(mock).method).toBe("GET");
    expect(first(mock).url).toBe(`${PREFIX}/manifest?start=20300324&end=20300405`);
    expect(first(mock).headers["accept"]).toBe("application/vnd.cpc.manifest-v8+xml");
    expect(res.links.map((l) => l.rel)).toEqual(["manifest", "manifest"]);
  });

  it("list treats an empty result as an empty list and rejects bad dates", async () => {
    const { client } = makeClient(xml("<manifests/>", MF));
    expect((await client.manifests.list({ start: "20300101" })).links).toEqual([]);
    await expect(client.manifests.list({ start: "2030/01/01" })).rejects.toThrow(/YYYYMMDD/);
  });

  it("get parses the PO number and exposes the artifact and shipments links", async () => {
    const { client, mock } = makeClient(xml(MANIFEST_RESPONSE, MF));
    const m = await client.manifests.get("33333333");
    expect(first(mock).url).toBe(`${PREFIX}/manifest/33333333`);
    expect(m.poNumber).toBe("P906367941");
    expect(m.links.map((l) => l.rel)).toEqual(["self", "artifact", "details", "manifestShipments"]);
    expect(m.artifactLink?.mediaType).toBe("application/pdf");
    expect(m.shipmentsLink?.rel).toBe("manifestShipments");
  });

  it("get reports a transmit that is still running as a pending error (HTTP 202, code 9153)", async () => {
    const { client } = makeClient(
      xml(
        "<messages><message><code>9153</code><description>The transmit process has not completed yet. Please try again later.</description></message></messages>",
        MF,
        202,
      ),
    );
    const err = (await client.manifests
      .get("33333333")
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(err.isPending).toBe(true);
    expect(err.code).toBe("9153");
  });

  it("getDetails parses totals as numbers", async () => {
    const { client, mock } = makeClient(xml(MANIFEST_DETAILS_RESPONSE, MF));
    const d = await client.manifests.getDetails({
      rel: "details",
      href: `${PREFIX}/manifest/33333333/details`,
      mediaType: MF,
      index: undefined,
    });
    expect(first(mock).url).toBe(`${PREFIX}/manifest/33333333/details`);
    expect(d).toMatchObject({
      poNumber: "D906367941",
      shippingPointId: "0015",
      contractId: "0012345678",
      methodOfPayment: "account",
      manifestDate: "2011-09-01",
      manifestTime: "16:42 EDT",
    });
    expect(d.pricing).toEqual({
      baseCost: 39.57,
      automationDiscount: 0,
      optionsAndSurcharges: 26.37,
      gst: 0,
      pst: 0,
      hst: 8.58,
      totalDueCpc: 74.52,
    });
  });

  it("uses mobo in the path when it differs from the customer number", async () => {
    const { client, mock } = makeClient(xml(MANIFEST_RESPONSE, MF), { mobo: "7654321" });
    await client.manifests.get("1");
    expect(first(mock).url).toBe(`${FIXTURE_HOST}/rs/${TEST_CUSTOMER}/7654321/manifest/1`);
  });
});
