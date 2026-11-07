import { describe, expect, it } from "vitest";
import {
  CanadaPostValidationError,
  MEDIA_TYPES,
  type GetRatesInput,
  type NcShipmentInput,
  type ShipmentInput,
} from "../src/index.js";
import { NC_CREATE_RESPONSE, RATES_RESPONSE, SHIPMENT_CREATE_RESPONSE } from "./fixtures.js";
import { first, makeClient, xml } from "./helpers.js";

const NC_INPUT: NcShipmentInput = {
  serviceCode: "DOM.EP",
  sender: {
    company: "Example Co",
    contactPhone: "555-555-5555",
    address: {
      addressLine1: "100 Example Street",
      city: "Exampleville",
      provState: "ON",
      postalZipCode: "a1a1a1",
    },
  },
  destination: {
    name: "Jane Example",
    address: {
      addressLine1: "200 Sample Avenue",
      city: "Sampletown",
      provState: "ON",
      postalZipCode: "b2b2b2",
    },
  },
  parcel: { weightKg: 1, dimensionsCm: { length: 1, width: 1, height: 1 } },
  preferences: { showPackingInstructions: true },
};

const SHIPMENT_INPUT: ShipmentInput = {
  groupId: "g1",
  serviceCode: "DOM.EP",
  sender: NC_INPUT.sender,
  destination: NC_INPUT.destination,
  parcel: NC_INPUT.parcel,
  preferences: NC_INPUT.preferences,
};

function section(body: string | undefined, element: string): string {
  const m = new RegExp(`<${element}>[\\s\\S]*?</${element}>`).exec(body ?? "");
  if (m === null) throw new Error(`<${element}> not found in body`);
  return m[0];
}

describe("address types follow the XSDs", () => {
  // ncshipment.xsd: SenderType uses DomesticAddressDetailsType, which has NO country-code
  // (a live sandbox run rejected it: "country-code may not appear here").
  it("non-contract sender omits country-code; non-contract destination keeps it", async () => {
    const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, MEDIA_TYPES.ncShipment));
    await client.ncShipments.create(NC_INPUT);
    const body = first(mock).body;
    const sender = section(body, "sender");
    expect(sender).not.toContain("country-code");
    expect(sender).toContain("<postal-zip-code>A1A1A1</postal-zip-code>");
    expect(sender).toContain("<city>Exampleville</city>");
    expect(sender).toContain("<prov-state>ON</prov-state>");
    expect(section(body, "destination")).toContain("<country-code>CA</country-code>");
  });

  it("non-contract sender must be domestic and complete", async () => {
    const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, MEDIA_TYPES.ncShipment));
    const withSender = (
      address: Partial<NcShipmentInput["sender"]["address"]>,
    ): NcShipmentInput => ({
      ...NC_INPUT,
      sender: { ...NC_INPUT.sender, address: { ...NC_INPUT.sender.address, ...address } },
    });
    await expect(client.ncShipments.create(withSender({ countryCode: "US" }))).rejects.toThrow(
      /must be in Canada/,
    );
    await expect(
      client.ncShipments.create(withSender({ postalZipCode: undefined })),
    ).rejects.toThrow(/sender\.address\.postalZipCode/);
    await expect(client.ncShipments.create(withSender({ city: undefined }))).rejects.toThrow(
      /sender\.address\.city/,
    );
    expect(mock.requests).toHaveLength(0);
  });

  // shipment.xsd: SenderType uses AddressDetailsType, where country-code is required
  // (confirmed working live), and the destination uses DestinationAddressDetailsType.
  it("contract sender and destination both carry country-code", async () => {
    const { client, mock } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, MEDIA_TYPES.shipment));
    await client.shipments.create(SHIPMENT_INPUT);
    const body = first(mock).body;
    expect(section(body, "sender")).toContain("<country-code>CA</country-code>");
    expect(section(body, "destination")).toContain("<country-code>CA</country-code>");
  });

  it("a destination may omit city, province and postal code (international)", async () => {
    const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, MEDIA_TYPES.ncShipment));
    await client.ncShipments.create({
      ...NC_INPUT,
      destination: { name: "Jane", address: { addressLine1: "1 Rue Exemple", countryCode: "fr" } },
    });
    const dest = section(first(mock).body, "destination");
    expect(dest).toContain("<country-code>FR</country-code>");
    expect(dest).not.toContain("<city>");
  });
});

describe("rating.getRates input validation", () => {
  const base: GetRatesInput = {
    originPostalCode: "K2B8J6",
    destination: { type: "domestic", postalCode: "J0E1X0" },
    parcel: { weightKg: 1 },
  };

  it("rejects a destination in the wrong (untagged) shape instead of sending none", async () => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating));
    const untagged = { ...base, destination: { domestic: { postalCode: "J0E1X0" } } };
    const err = await client.rating.getRates(untagged as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostValidationError);
    expect(String(err)).toContain("destination.type");
    expect(String(err)).toContain('{ type: "domestic"');
    expect(mock.requests).toHaveLength(0);
  });

  it.each([
    ["missing destination", { ...base, destination: undefined }, /destination is required/],
    ["null destination", { ...base, destination: null }, /destination is required/],
    [
      "unknown type",
      { ...base, destination: { type: "mars", postalCode: "X" } },
      /destination\.type/,
    ],
    [
      "missing postal code",
      { ...base, destination: { type: "domestic" } },
      /destination\.postalCode/,
    ],
    ["missing zip", { ...base, destination: { type: "united-states" } }, /destination\.zipCode/],
    [
      "missing country",
      { ...base, destination: { type: "international" } },
      /destination\.countryCode/,
    ],
    ["missing origin", { ...base, originPostalCode: undefined }, /originPostalCode/],
    ["missing parcel", { ...base, parcel: undefined }, /parcel is required/],
    ["missing weight", { ...base, parcel: {} }, /parcel\.weightKg/],
    ["missing input", undefined, /getRates input/],
  ])("rejects %s", async (_name, input, message) => {
    const { client, mock } = makeClient(xml(RATES_RESPONSE, MEDIA_TYPES.rating));
    const err = await client.rating.getRates(input as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CanadaPostValidationError);
    expect(String(err)).toMatch(message);
    expect(mock.requests).toHaveLength(0);
  });
});

describe("create inputs validate required fields", () => {
  const cases: Array<[string, (i: NcShipmentInput) => unknown, RegExp]> = [
    ["serviceCode", (i) => ({ ...i, serviceCode: "" }), /serviceCode/],
    ["sender", (i) => ({ ...i, sender: undefined }), /sender is required/],
    ["destination", (i) => ({ ...i, destination: undefined }), /destination is required/],
    ["parcel", (i) => ({ ...i, parcel: undefined }), /parcel is required/],
    ["weight", (i) => ({ ...i, parcel: {} }), /weightKg/],
    ["preferences", (i) => ({ ...i, preferences: undefined }), /preferences is required/],
    ["showPackingInstructions", (i) => ({ ...i, preferences: {} }), /showPackingInstructions/],
    [
      "destination address",
      (i) => ({ ...i, destination: { name: "x" } }),
      /destination\.address is required/,
    ],
    [
      "sender company",
      (i) => ({ ...i, sender: { ...i.sender, company: undefined } }),
      /sender\.company/,
    ],
  ];

  it.each(cases)(
    "ncShipments.create rejects a missing %s before any request",
    async (_n, mutate, msg) => {
      const { client, mock } = makeClient(xml(NC_CREATE_RESPONSE, MEDIA_TYPES.ncShipment));
      const err = await client.ncShipments
        .create(mutate(NC_INPUT) as never)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CanadaPostValidationError);
      expect(String(err)).toMatch(msg);
      expect(mock.requests).toHaveLength(0);
    },
  );

  it.each(cases)(
    "shipments.create rejects a missing %s before any request",
    async (_n, mutate, msg) => {
      const { client, mock } = makeClient(xml(SHIPMENT_CREATE_RESPONSE, MEDIA_TYPES.shipment));
      const err = await client.shipments
        .create(mutate(SHIPMENT_INPUT as unknown as NcShipmentInput) as never)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CanadaPostValidationError);
      expect(String(err)).toMatch(msg);
      expect(mock.requests).toHaveLength(0);
    },
  );
});
