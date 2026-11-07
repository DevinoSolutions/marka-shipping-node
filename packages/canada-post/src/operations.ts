/**
 * Catalogue of every SDK operation and whether it can change state.
 *
 * Classify by what the call does, not by HTTP verb: `rating.getRates` is a `POST` but only a
 * quote, while `shipments.void` is a `DELETE` that changes state. The live-suite guard
 * (`npm run check:live-readonly`) derives its forbidden list from the `write` entries here,
 * and `test/operations.test.ts` fails if a public method is missing from this table.
 */
export interface OperationSpec {
  /** `namespace.method`, as called on the client. */
  id: string;
  /** `write` operations create, void, transmit, bill or request refunds. */
  access: "read" | "write";
  /** In production the call bills postage or opens a refund ticket. */
  charges: boolean;
  /** HTTP method used on the wire. */
  http: "GET" | "POST" | "DELETE";
}

const read = (id: string, http: "GET" | "POST" = "GET"): OperationSpec => ({
  id,
  access: "read",
  charges: false,
  http,
});

const write = (id: string, http: "POST" | "DELETE" = "POST", charges = true): OperationSpec => ({
  id,
  access: "write",
  charges,
  http,
});

/** All operations, keyed by id. */
export const OPERATIONS: Readonly<Record<string, OperationSpec>> = Object.fromEntries(
  [
    read("rating.getRates", "POST"),
    read("rating.discoverServices"),
    read("rating.getService"),
    read("rating.getOption"),

    write("ncShipments.create"),
    read("ncShipments.get"),
    read("ncShipments.getDetails"),
    read("ncShipments.getReceipt"),
    read("ncShipments.list"),
    write("ncShipments.requestRefund", "POST", false),

    write("shipments.create"),
    read("shipments.get"),
    read("shipments.getDetails"),
    read("shipments.getPrice"),
    read("shipments.getReceipt"),
    read("shipments.list"),
    read("shipments.getGroups"),
    write("shipments.void", "DELETE", false),
    write("shipments.requestRefund", "POST", false),
    write("shipments.transmit"),

    read("manifests.get"),
    read("manifests.list"),
    read("manifests.getDetails"),

    read("artifacts.get"),
    read("artifacts.saveToFile"),

    read("tracking.getSummary"),
    read("tracking.getDetails"),
  ].map((op) => [op.id, op]),
);
