import { describe, expect, it } from "vitest";
import { OPERATIONS } from "../src/index.js";
import { makeClient } from "./helpers.js";

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
    expect(Object.keys(OPERATIONS).sort()).toEqual(actual);
  });

  it("marks exactly the state-changing operations as writes", () => {
    const writes = Object.values(OPERATIONS)
      .filter((op) => op.access === "write")
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

  it("classifies by effect, not by HTTP verb", () => {
    expect(OPERATIONS["rating.getRates"]).toMatchObject({ http: "POST", access: "read" });
    expect(OPERATIONS["shipments.void"]).toMatchObject({ http: "DELETE", access: "write" });
  });
});
