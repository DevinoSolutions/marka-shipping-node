/**
 * Catalogue of every SDK operation and whether it can change state.
 *
 * Classify by what the call does, not by HTTP verb: `rating.getRates` is a `POST` but only a
 * quote, while `shipments.void` is a `DELETE` that changes state. The live-suite guard
 * (`npm run check:live-readonly`) derives its forbidden list from the `write` entries here,
 * and `test/operations.test.ts` fails if a public method is missing from this table.
 */
export interface OperationSpec {
  /**
   * `namespace.method`, as called on the XML client; `rest.namespace.method` for the REST
   * client (`createCanadaPostRestClient`), whose namespaces carry the same names.
   */
  id: string;
  /** `write` operations create, void, transmit, bill or request refunds. */
  access: "read" | "write";
  /** In production the call bills postage or opens a refund ticket. */
  charges: boolean;
  /** HTTP method used on the wire. */
  http: "GET" | "POST" | "PUT" | "DELETE";
}

const read = (id: string, http: "GET" | "POST" = "GET"): OperationSpec => ({
  id,
  access: "read",
  charges: false,
  http,
});

const write = (
  id: string,
  http: "GET" | "POST" | "PUT" | "DELETE" = "POST",
  charges = true,
): OperationSpec => ({
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

    // REST/OAuth client (Developer Portal). `rating.getPrices` is a POST that only quotes.
    read("rest.rating.getPrices", "POST"),
    read("rest.rating.listServices"),
    read("rest.rating.getService"),
    read("rest.rating.getOption"),

    write("rest.shipments.create"),
    read("rest.shipments.get"),
    read("rest.shipments.getDetails"),
    read("rest.shipments.getPrice"),
    read("rest.shipments.list"),
    read("rest.shipments.getLabel"),
    write("rest.shipments.void", "DELETE", false),
    read("rest.shipments.getReceipt"),
    read("rest.shipments.getQrCode"),
    read("rest.shipments.getGroups"),
    write("rest.shipments.requestRefund", "POST", false),
    write("rest.shipments.transmit"),

    read("rest.manifests.list"),
    read("rest.manifests.get"),
    read("rest.manifests.getDetails"),

    read("rest.tracking.getSummaryByPin"),
    read("rest.tracking.getSummaryByDnc"),
    read("rest.tracking.getSummaryByReference"),
    read("rest.tracking.getDetailsByPin"),
    read("rest.tracking.getDetailsByDnc"),
    // A POST that only renders a delivery confirmation certificate.
    read("rest.tracking.createCertificate", "POST"),

    read("rest.customers.get"),
    read("rest.customers.getMobo"),
    read("rest.customers.getPaymentReadiness"),

    write("rest.returns.createAuthorized"),
    write("rest.returns.createOpen"),
    read("rest.returns.listOpen"),
    read("rest.returns.getOpen"),
    read("rest.returns.getOpenDetails"),
    write("rest.returns.deleteOpen", "DELETE", false),
    // A GET on the wire, but it consumes one label of the template (and may bill it).
    write("rest.returns.getOpenArtifact", "GET"),
    read("rest.returns.getAuthorizedLabel"),

    write("rest.pickup.create"),
    write("rest.pickup.update", "PUT", false),
    write("rest.pickup.cancel", "DELETE", false),
    read("rest.pickup.list"),
    read("rest.pickup.getDetails"),
    read("rest.pickup.getPrice"),
    read("rest.pickup.getAvailability"),

    read("rest.postOffices.find"),
    read("rest.postOffices.getDetails"),

    read("rest.serviceInfo.getMessages"),
  ].map((op) => [op.id, op]),
);
