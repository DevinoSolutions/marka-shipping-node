import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../src/index.js";
import { makeClient } from "./helpers.js";
import { makeRestClient, json } from "./support/rest.js";

const NAMESPACES = [
  "rating",
  "ncShipments",
  "shipments",
  "manifests",
  "artifacts",
  "tracking",
] as const;

const REST_NAMESPACES = [
  "rating",
  "shipments",
  "manifests",
  "tracking",
  "customers",
  "returns",
  "pickup",
  "postOffices",
  "serviceInfo",
] as const;

function methodsOf(instance: object): string[] {
  const proto = Object.getPrototypeOf(instance) as object;
  return Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== "constructor" && typeof (instance as Record<string, unknown>)[name] === "function",
  );
}

describe("operations table", () => {
  it("lists every public client method exactly once (so the live guard cannot drift)", () => {
    const { client } = makeClient({});
    const actual = NAMESPACES.flatMap((ns) =>
      methodsOf(client[ns]).map((m) => `${ns}.${m}`),
    ).sort();
    const xmlIds = Object.keys(OPERATIONS).filter((id) => !id.startsWith("rest."));
    expect(xmlIds.sort()).toEqual(actual);
  });

  it("lists every public REST client method exactly once, under the rest. prefix", () => {
    const { client } = makeRestClient(json({}));
    const actual = REST_NAMESPACES.flatMap((ns) =>
      methodsOf(client[ns]).map((m) => `rest.${ns}.${m}`),
    ).sort();
    const restIds = Object.keys(OPERATIONS).filter((id) => id.startsWith("rest."));
    expect(restIds.sort()).toEqual(actual);
  });

  it("marks exactly the state-changing operations as writes", () => {
    const writes = Object.values(OPERATIONS)
      .filter((op) => op.access === "write" && !op.id.startsWith("rest."))
      .map((op) => op.id)
      .sort();
    expect(writes).toEqual([
      "ncShipments.create",
      "ncShipments.requestRefund",
      "shipments.create",
      "shipments.requestRefund",
      "shipments.transmit",
      "shipments.void",
    ]);
  });

  it("marks exactly the state-changing REST operations as writes", () => {
    const writes = Object.values(OPERATIONS)
      .filter((op) => op.access === "write" && op.id.startsWith("rest."))
      .map((op) => op.id)
      .sort();
    expect(writes).toEqual([
      "rest.pickup.cancel",
      "rest.pickup.create",
      "rest.pickup.update",
      "rest.returns.createAuthorized",
      "rest.returns.createOpen",
      "rest.returns.deleteOpen",
      "rest.returns.getOpenArtifact",
      "rest.shipments.create",
      "rest.shipments.requestRefund",
      "rest.shipments.transmit",
      "rest.shipments.void",
    ]);
    expect(OPERATIONS["rest.shipments.create"]).toMatchObject({ charges: true, http: "POST" });
    expect(OPERATIONS["rest.shipments.void"]).toMatchObject({ charges: false, http: "DELETE" });
    // Refunds and manifests: a refund opens a ticket, a transmit bills the shipments.
    expect(OPERATIONS["rest.shipments.requestRefund"]).toMatchObject({ charges: false });
    expect(OPERATIONS["rest.shipments.transmit"]).toMatchObject({ charges: true, http: "POST" });
    expect(OPERATIONS["rest.pickup.create"]).toMatchObject({ charges: true, http: "POST" });
    expect(OPERATIONS["rest.pickup.update"]).toMatchObject({ charges: false, http: "PUT" });
    expect(OPERATIONS["rest.returns.createAuthorized"]).toMatchObject({ charges: true });
    // A GET that consumes a label is still a write.
    expect(OPERATIONS["rest.returns.getOpenArtifact"]).toMatchObject({
      access: "write",
      http: "GET",
    });
  });

  it("classifies by effect, not by HTTP verb", () => {
    expect(OPERATIONS["rest.rating.getPrices"]).toMatchObject({ http: "POST", access: "read" });
    expect(OPERATIONS["rest.tracking.createCertificate"]).toMatchObject({
      http: "POST",
      access: "read",
    });
    expect(OPERATIONS["rating.getRates"]).toMatchObject({ http: "POST", access: "read" });
    expect(OPERATIONS["shipments.void"]).toMatchObject({ http: "DELETE", access: "write" });
  });
});
