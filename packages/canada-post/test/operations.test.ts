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
    const actual = (["rating", "shipments"] as const)
      .flatMap((ns) => methodsOf(client[ns]).map((m) => `rest.${ns}.${m}`))
      .sort();
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
    expect(writes).toEqual(["rest.shipments.create", "rest.shipments.void"]);
    expect(OPERATIONS["rest.shipments.create"]).toMatchObject({ charges: true, http: "POST" });
    expect(OPERATIONS["rest.shipments.void"]).toMatchObject({ charges: false, http: "DELETE" });
  });

  it("classifies by effect, not by HTTP verb", () => {
    expect(OPERATIONS["rest.rating.getPrices"]).toMatchObject({ http: "POST", access: "read" });
    expect(OPERATIONS["rating.getRates"]).toMatchObject({ http: "POST", access: "read" });
    expect(OPERATIONS["shipments.void"]).toMatchObject({ http: "DELETE", access: "write" });
  });
});
