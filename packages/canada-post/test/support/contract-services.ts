// Contract-test tables for the REST operations added after the first release: which documented
// endpoint each SDK operation must call, how to call it once, and what the stub answers.
import {
  FAKE_AUTHORIZED_RETURN,
  FAKE_AUTHORIZED_RETURN_REQUEST,
  FAKE_CERTIFICATE,
  FAKE_CUSTOMER_MOBO_WIRE,
  FAKE_CUSTOMER_WIRE,
  FAKE_DNC,
  FAKE_GROUPS,
  FAKE_MANIFEST_DETAILS,
  FAKE_MANIFEST_INFO,
  FAKE_MANIFEST_LINKS,
  FAKE_OPEN_RETURN,
  FAKE_OPEN_RETURN_DETAILS,
  FAKE_OPEN_RETURN_ID,
  FAKE_OPEN_RETURN_LINKS,
  FAKE_OPEN_RETURN_REQUEST,
  FAKE_PICKUP_AVAILABILITY,
  FAKE_PICKUP_CREATED,
  FAKE_PICKUP_DETAILS,
  FAKE_PICKUP_ID,
  FAKE_PICKUP_LIST,
  FAKE_PICKUP_PRICE,
  FAKE_PICKUP_REQUEST,
  FAKE_PICKUP_UPDATE,
  FAKE_PIN,
  FAKE_POST_OFFICES,
  FAKE_POST_OFFICE_DETAIL,
  FAKE_QR,
  FAKE_RECEIPT,
  FAKE_REFUND,
  FAKE_SERVICE_MESSAGES,
  FAKE_TRACKING_DETAIL,
  FAKE_TRACKING_SUMMARY,
  FAKE_TRANSMIT_REQUEST,
} from "./rest-services.js";
import { FAKE_SHIPMENT_ID, PDF_HEADERS, fakePdf, json, type RestHarness } from "./rest.js";
import type { SpecName } from "./openapi.js";
import type { MockReply } from "../../src/testing/index.js";

const pdfReply: MockReply = { status: 200, body: fakePdf(1), headers: PDF_HEADERS };

/** SDK operation id -> [spec, operationId of the documented endpoint it must call]. */
export const EXPECTED_SERVICES: Record<string, [SpecName, string]> = {
  "rest.shipments.getReceipt": ["shipping-v1", "GetShipmentReceipt"],
  "rest.shipments.getQrCode": ["shipping-v1", "getShipmentQRCode"],
  "rest.shipments.getGroups": ["shipping-v1", "getShipmentGroups"],
  "rest.shipments.requestRefund": ["shipping-v1", "RequestShipmentRefund"],
  "rest.shipments.transmit": ["shipping-v1", "TransmitShipmentsManifest"],
  "rest.manifests.list": ["shipping-v1", "GetManifests"],
  "rest.manifests.get": ["shipping-v1", "GetManifestById"],
  "rest.manifests.getDetails": ["shipping-v1", "GetManifestIdDetails"],
  "rest.tracking.getSummaryByPin": ["tracking-v1", "trackingSummaryPin"],
  "rest.tracking.getSummaryByDnc": ["tracking-v1", "trackingSummaryDNC"],
  "rest.tracking.getSummaryByReference": ["tracking-v1", "TrackingSummaryReference"],
  "rest.tracking.getDetailsByPin": ["tracking-v1", "trackingDetailsByPin"],
  "rest.tracking.getDetailsByDnc": ["tracking-v1", "trackingDetailsByDNC"],
  "rest.tracking.createCertificate": ["tracking-v1", "createCertificateDNC"],
  "rest.customers.get": ["customerinfo-v1", "CustomerMailedBy"],
  "rest.customers.getMobo": ["customerinfo-v1", "CustomerMailedByMOBO"],
  // getPaymentReadiness is customers.get plus arithmetic: it calls the same endpoint.
  "rest.customers.getPaymentReadiness": ["customerinfo-v1", "CustomerMailedBy"],
  "rest.returns.createAuthorized": ["returns-v1", "authorizeReturn"],
  "rest.returns.createOpen": ["returns-v1", "createOpenReturn"],
  "rest.returns.listOpen": ["returns-v1", "getOpenReturn"],
  "rest.returns.getOpen": ["returns-v1", "openReturnById"],
  "rest.returns.getOpenDetails": ["returns-v1", "openReturnDetails"],
  "rest.returns.deleteOpen": ["returns-v1", "deleteOpenReturnById"],
  "rest.returns.getOpenArtifact": ["returns-v1", "openReturnArtifact"],
  "rest.returns.getAuthorizedLabel": ["returns-v1", "authorizedReturnArtifact"],
  "rest.pickup.create": ["pickup-v1", "createPickup"],
  "rest.pickup.update": ["pickup-v1", "updatePickup"],
  "rest.pickup.cancel": ["pickup-v1", "deletePickup"],
  "rest.pickup.list": ["pickup-v1", "getAllPickups"],
  "rest.pickup.getDetails": ["pickup-v1", "getPickupDetails"],
  "rest.pickup.getPrice": ["pickup-v1", "getPickupPrice"],
  "rest.pickup.getAvailability": ["pickup-v1", "getPickupAvailability"],
  "rest.postOffices.find": ["postoffice-v1", "findNearestPostOffice"],
  "rest.postOffices.getDetails": ["postoffice-v1", "findPostOfficeDetails"],
  "rest.serviceInfo.getMessages": ["serviceinfo-v1", "serviceInfo"],
};

/** Runs each SDK operation once. */
export const CALLS_SERVICES: Record<string, (h: RestHarness) => Promise<unknown>> = {
  "rest.shipments.getReceipt": (h) => h.client.shipments.getReceipt(FAKE_SHIPMENT_ID),
  "rest.shipments.getQrCode": (h) => h.client.shipments.getQrCode(FAKE_SHIPMENT_ID),
  "rest.shipments.getGroups": (h) => h.client.shipments.getGroups(),
  "rest.shipments.requestRefund": (h) =>
    h.client.shipments.requestRefund(FAKE_SHIPMENT_ID, { email: "refunds@example.com" }),
  "rest.shipments.transmit": (h) => h.client.shipments.transmit(FAKE_TRANSMIT_REQUEST),
  "rest.manifests.list": (h) => h.client.manifests.list({ from: "2026-11-01", to: "2026-11-16" }),
  "rest.manifests.get": (h) => h.client.manifests.get("PO00000001"),
  "rest.manifests.getDetails": (h) => h.client.manifests.getDetails("PO00000001"),
  "rest.tracking.getSummaryByPin": (h) => h.client.tracking.getSummaryByPin(FAKE_PIN),
  "rest.tracking.getSummaryByDnc": (h) => h.client.tracking.getSummaryByDnc(FAKE_DNC),
  "rest.tracking.getSummaryByReference": (h) =>
    h.client.tracking.getSummaryByReference({
      referenceNumber: "REF1",
      mailingDateFrom: "2026-11-01",
      mailingDateTo: "2026-11-16",
      customerNumber: "1234567",
      destinationPostalCode: "M5V2T6",
    }),
  "rest.tracking.getDetailsByPin": (h) => h.client.tracking.getDetailsByPin(FAKE_PIN),
  "rest.tracking.getDetailsByDnc": (h) => h.client.tracking.getDetailsByDnc(FAKE_DNC),
  "rest.tracking.createCertificate": (h) =>
    h.client.tracking.createCertificate({ pin: FAKE_PIN, language: "en" }),
  "rest.customers.get": (h) => h.client.customers.get(),
  "rest.customers.getMobo": (h) => h.client.customers.getMobo("7654321"),
  "rest.customers.getPaymentReadiness": (h) => h.client.customers.getPaymentReadiness(),
  "rest.returns.createAuthorized": (h) =>
    h.client.returns.createAuthorized(FAKE_AUTHORIZED_RETURN_REQUEST),
  "rest.returns.createOpen": (h) => h.client.returns.createOpen(FAKE_OPEN_RETURN_REQUEST),
  "rest.returns.listOpen": (h) => h.client.returns.listOpen(),
  "rest.returns.getOpen": (h) => h.client.returns.getOpen(FAKE_OPEN_RETURN_ID),
  "rest.returns.getOpenDetails": (h) => h.client.returns.getOpenDetails(FAKE_OPEN_RETURN_ID),
  "rest.returns.deleteOpen": (h) => h.client.returns.deleteOpen(FAKE_OPEN_RETURN_ID),
  "rest.returns.getOpenArtifact": (h) => h.client.returns.getOpenArtifact(FAKE_OPEN_RETURN_ID),
  "rest.returns.getAuthorizedLabel": (h) =>
    h.client.returns.getAuthorizedLabel(FAKE_AUTHORIZED_RETURN),
  "rest.pickup.create": (h) => h.client.pickup.create(FAKE_PICKUP_REQUEST),
  "rest.pickup.update": (h) => h.client.pickup.update(FAKE_PICKUP_ID, FAKE_PICKUP_UPDATE),
  "rest.pickup.cancel": (h) => h.client.pickup.cancel(FAKE_PICKUP_ID),
  "rest.pickup.list": (h) => h.client.pickup.list(),
  "rest.pickup.getDetails": (h) => h.client.pickup.getDetails(FAKE_PICKUP_ID),
  "rest.pickup.getPrice": (h) =>
    h.client.pickup.getPrice({ date: "2026-12-01", contractId: "0001234567", priorityFlag: true }),
  "rest.pickup.getAvailability": (h) => h.client.pickup.getAvailability("K1A 0B1"),
  "rest.postOffices.find": (h) =>
    h.client.postOffices.find({ postalCode: "K1A0B1", maximum: 5, d2po: true }),
  "rest.postOffices.getDetails": (h) => h.client.postOffices.getDetails("0000102978"),
  "rest.serviceInfo.getMessages": (h) => h.client.serviceInfo.getMessages(),
};

/** What the stub answers for each operation (a documented success status). */
export function replyForServices(id: string): MockReply | undefined {
  switch (id) {
    case "rest.shipments.getReceipt":
      return json(FAKE_RECEIPT);
    case "rest.shipments.getQrCode":
      return json(FAKE_QR);
    case "rest.shipments.getGroups":
      return json(FAKE_GROUPS);
    case "rest.shipments.requestRefund":
      return json(FAKE_REFUND);
    case "rest.shipments.transmit":
    case "rest.manifests.list":
      return json(FAKE_MANIFEST_LINKS);
    case "rest.manifests.get":
      return json(FAKE_MANIFEST_INFO);
    case "rest.manifests.getDetails":
      return json(FAKE_MANIFEST_DETAILS);
    case "rest.tracking.getSummaryByPin":
    case "rest.tracking.getSummaryByDnc":
    case "rest.tracking.getSummaryByReference":
      return json(FAKE_TRACKING_SUMMARY);
    case "rest.tracking.getDetailsByPin":
    case "rest.tracking.getDetailsByDnc":
      return json(FAKE_TRACKING_DETAIL);
    case "rest.tracking.createCertificate":
      return json(FAKE_CERTIFICATE);
    case "rest.customers.get":
    case "rest.customers.getPaymentReadiness":
      return json(FAKE_CUSTOMER_WIRE);
    case "rest.customers.getMobo":
      return json(FAKE_CUSTOMER_MOBO_WIRE);
    case "rest.returns.createAuthorized":
      return json(FAKE_AUTHORIZED_RETURN);
    case "rest.returns.createOpen":
    case "rest.returns.getOpen":
      return json(FAKE_OPEN_RETURN);
    case "rest.returns.listOpen":
      return json(FAKE_OPEN_RETURN_LINKS);
    case "rest.returns.getOpenDetails":
      return json(FAKE_OPEN_RETURN_DETAILS);
    case "rest.returns.deleteOpen":
    case "rest.pickup.update":
    case "rest.pickup.cancel":
      return { status: 204 };
    case "rest.returns.getOpenArtifact":
    case "rest.returns.getAuthorizedLabel":
      return pdfReply;
    case "rest.pickup.create":
      return json(FAKE_PICKUP_CREATED, 201);
    case "rest.pickup.list":
      return json(FAKE_PICKUP_LIST);
    case "rest.pickup.getDetails":
      return json(FAKE_PICKUP_DETAILS);
    case "rest.pickup.getPrice":
      return json(FAKE_PICKUP_PRICE);
    case "rest.pickup.getAvailability":
      return json(FAKE_PICKUP_AVAILABILITY);
    case "rest.postOffices.find":
      return json(FAKE_POST_OFFICES);
    case "rest.postOffices.getDetails":
      return json(FAKE_POST_OFFICE_DETAIL);
    case "rest.serviceInfo.getMessages":
      return json(FAKE_SERVICE_MESSAGES);
    default:
      return undefined;
  }
}
