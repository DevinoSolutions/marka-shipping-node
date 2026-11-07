import { describe, expect, it } from "vitest";
import {
  CanadaPostConfigurationError,
  CanadaPostValidationError,
  findLink,
  MEDIA_TYPES,
  requireLink,
  type CanadaPostLink,
} from "../src/index.js";
import { FIXTURE_HOST, NC_CREATE_RESPONSE, SHIPMENT_CREATE_RESPONSE } from "./fixtures.js";
import { first, makeClient, xml } from "./helpers.js";

const LINKS: CanadaPostLink[] = [
  { rel: "self", href: `${FIXTURE_HOST}/a`, mediaType: "x", index: undefined },
  { rel: "label", href: `${FIXTURE_HOST}/l0`, mediaType: "application/pdf", index: 0 },
  { rel: "label", href: `${FIXTURE_HOST}/l1`, mediaType: "application/pdf", index: 1 },
];

describe("link helpers", () => {
  it("findLink matches rel case-insensitively and by page index", () => {
    expect(findLink(LINKS, "SELF")?.href).toBe(`${FIXTURE_HOST}/a`);
    expect(findLink(LINKS, "label")?.href).toBe(`${FIXTURE_HOST}/l0`);
    expect(findLink(LINKS, "label", 1)?.href).toBe(`${FIXTURE_HOST}/l1`);
    expect(findLink(LINKS, "refund")).toBeUndefined();
  });

  it("requireLink explains what is available when the link is missing", () => {
    expect(() => requireLink(LINKS, "refund")).toThrow(/rel="refund".*self, label, label/);
  });
});

describe("client.followLink", () => {
  it("follows an XML link with its own media type and returns the parsed document", async () => {
    const { client, mock } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, MEDIA_TYPES.shipment));
    const result = await client.followLink({
      rel: "details",
      href: `${FIXTURE_HOST}/rs/1234567/1234567/shipment/347881315405043891/details`,
      mediaType: MEDIA_TYPES.shipment,
      index: undefined,
    });
    expect(first(mock).method).toBe("GET");
    expect(first(mock).headers["accept"]).toBe(MEDIA_TYPES.shipment);
    expect(result.kind).toBe("xml");
    if (result.kind === "xml") {
      expect(Object.keys(result.raw)).toEqual(["shipment-info"]);
      expect(result.text).toContain("<shipment-id>347881315405043891</shipment-id>");
    }
  });

  it("follows a PDF link as binary", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0xff, 0x00]);
    const { client } = makeClient({ body: bytes, headers: { "content-type": "application/pdf" } });
    const result = await client.followLink({
      rel: "label",
      href: `${FIXTURE_HOST}/rs/artifact/1/2/0`,
      mediaType: "application/pdf",
      index: 0,
    });
    expect(result.kind).toBe("binary");
    if (result.kind === "binary") expect(Array.from(result.data)).toEqual(Array.from(bytes));
  });

  it("refuses refund links (they are POST endpoints) and foreign hosts", async () => {
    const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, MEDIA_TYPES.ncShipment));
    await expect(
      client.followLink({
        rel: "refund",
        href: `${FIXTURE_HOST}/rs/1/ncshipment/1/refund`,
        mediaType: MEDIA_TYPES.ncShipment,
        index: undefined,
      }),
    ).rejects.toBeInstanceOf(CanadaPostValidationError);
    await expect(
      client.followLink({
        rel: "self",
        href: "https://evil.example.com/x",
        mediaType: MEDIA_TYPES.ncShipment,
        index: undefined,
      }),
    ).rejects.toBeInstanceOf(CanadaPostConfigurationError);
    expect(mock.requests).toHaveLength(0);
  });
});
