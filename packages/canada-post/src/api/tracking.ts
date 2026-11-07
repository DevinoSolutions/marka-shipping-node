import { MEDIA_TYPES } from "../config.js";
import { CanadaPostValidationError } from "../errors.js";
import { rootElement } from "../http.js";
import { bool, child, children, num, parseXml, str, type XmlNode } from "../xml/parse.js";
import type { ApiContext } from "./context.js";

/** Identify a parcel by PIN (12-16 characters) or Delivery Notice Card number (15 digits). */
export type TrackingQuery = { pin: string } | { dnc: string };

/** One parcel in a tracking summary. Empty elements are `undefined`. */
export interface PinSummary {
  pin: string | undefined;
  originPostalId: string | undefined;
  destinationPostalId: string | undefined;
  destinationProvince: string | undefined;
  serviceName: string | undefined;
  mailedOnDate: string | undefined;
  expectedDeliveryDate: string | undefined;
  actualDeliveryDate: string | undefined;
  /** 0 = at least one option unsatisfied, 1 = all satisfied, 2 = no options. */
  deliveryOptionCompletedInd: number | undefined;
  /** `yyyymmdd:hhmmss` as sent by Canada Post. */
  eventDateTime: string | undefined;
  eventDescription: string | undefined;
  attemptedDate: string | undefined;
  customerRef1: string | undefined;
  customerRef2: string | undefined;
  returnPin: string | undefined;
  eventType: string | undefined;
  eventLocation: string | undefined;
}

/** Result of {@link TrackingApi.getSummary}. */
export interface TrackingSummary {
  pins: PinSummary[];
  raw: unknown;
}

/** One significant event of a parcel. */
export interface TrackingEvent {
  identifier: string | undefined;
  date: string | undefined;
  time: string | undefined;
  timeZone: string | undefined;
  description: string | undefined;
  site: string | undefined;
  province: string | undefined;
  retailLocationId: string | undefined;
  retailName: string | undefined;
}

/** Result of {@link TrackingApi.getDetails}. */
export interface TrackingDetail {
  pin: string | undefined;
  activeExists: boolean | undefined;
  archiveExists: boolean | undefined;
  destinationPostalId: string | undefined;
  expectedDeliveryDate: string | undefined;
  changedExpectedDate: string | undefined;
  changedExpectedDeliveryReason: string | undefined;
  mailedByCustomerNumber: string | undefined;
  mailedOnBehalfOfCustomerNumber: string | undefined;
  originalPin: string | undefined;
  serviceName: string | undefined;
  /** Service name in the other official language. */
  serviceName2: string | undefined;
  customerRef1: string | undefined;
  customerRef2: string | undefined;
  returnPin: string | undefined;
  signatureImageExists: boolean | undefined;
  suppressSignature: boolean | undefined;
  deliveryOptions: Array<{ option: string | undefined; description: string | undefined }>;
  /** Newest first, as sent by Canada Post. */
  events: TrackingEvent[];
  codRemit: { pin: string | undefined; type: string | undefined } | undefined;
  raw: unknown;
}

const PIN = /^[A-Za-z0-9]{12,16}$/;
const DNC = /^[0-9]{15}$/;

function trackingPath(query: TrackingQuery, suffix: "summary" | "detail"): string {
  if ("pin" in query) {
    const pin = query.pin.replace(/\s+/g, "");
    if (!PIN.test(pin)) {
      throw new CanadaPostValidationError("pin must be 12-16 letters or digits");
    }
    return `/vis/track/pin/${pin}/${suffix}`;
  }
  const dnc = query.dnc.replace(/\s+/g, "");
  if (!DNC.test(dnc)) {
    throw new CanadaPostValidationError("dnc must be exactly 15 digits");
  }
  return `/vis/track/dnc/${dnc}/${suffix}`;
}

function mapPinSummary(n: XmlNode): PinSummary {
  return {
    pin: str(n, "pin"),
    originPostalId: str(n, "origin-postal-id"),
    destinationPostalId: str(n, "destination-postal-id"),
    destinationProvince: str(n, "destination-province"),
    serviceName: str(n, "service-name"),
    mailedOnDate: str(n, "mailed-on-date"),
    expectedDeliveryDate: str(n, "expected-delivery-date"),
    actualDeliveryDate: str(n, "actual-delivery-date"),
    deliveryOptionCompletedInd: num(n, "delivery-option-completed-ind"),
    eventDateTime: str(n, "event-date-time"),
    eventDescription: str(n, "event-description"),
    attemptedDate: str(n, "attempted-date"),
    customerRef1: str(n, "customer-ref-1"),
    customerRef2: str(n, "customer-ref-2"),
    returnPin: str(n, "return-pin"),
    eventType: str(n, "event-type"),
    eventLocation: str(n, "event-location"),
  };
}

/** Parcel tracking. Read-only. In the sandbox every query answers "No Pin History". */
export class TrackingApi {
  constructor(private readonly ctx: ApiContext) {}

  /** Latest status of a parcel by PIN or Delivery Notice Card number. */
  async getSummary(query: TrackingQuery): Promise<TrackingSummary> {
    const { ctx } = this;
    const res = await ctx.http.execute({
      operation: "tracking.getSummary",
      method: "GET",
      url: `${ctx.config.baseUrl}${trackingPath(query, "summary")}`,
      accept: MEDIA_TYPES.tracking,
    });
    const root = rootElement(parseXml(res.text), "tracking-summary", "tracking.getSummary");
    return { pins: children(root, "pin-summary").map(mapPinSummary), raw: root };
  }

  /** Full event history of a parcel by PIN or Delivery Notice Card number. */
  async getDetails(query: TrackingQuery): Promise<TrackingDetail> {
    const { ctx } = this;
    const res = await ctx.http.execute({
      operation: "tracking.getDetails",
      method: "GET",
      url: `${ctx.config.baseUrl}${trackingPath(query, "detail")}`,
      accept: MEDIA_TYPES.tracking,
    });
    const d = rootElement(parseXml(res.text), "tracking-detail", "tracking.getDetails");
    const events = child(d, "significant-events");
    const cod = child(d, "cod-remit-info");
    return {
      pin: str(d, "pin"),
      activeExists: bool(d, "active-exists"),
      archiveExists: bool(d, "archive-exists"),
      destinationPostalId: str(d, "destination-postal-id"),
      expectedDeliveryDate: str(d, "expected-delivery-date"),
      changedExpectedDate: str(d, "changed-expected-date"),
      changedExpectedDeliveryReason: str(d, "changed-expected-delivery-reason"),
      mailedByCustomerNumber: str(d, "mailed-by-customer-number"),
      mailedOnBehalfOfCustomerNumber: str(d, "mailed-on-behalf-of-customer-number"),
      originalPin: str(d, "original-pin"),
      serviceName: str(d, "service-name"),
      serviceName2: str(d, "service-name-2"),
      customerRef1: str(d, "customer-ref-1"),
      customerRef2: str(d, "customer-ref-2"),
      returnPin: str(d, "return-pin"),
      signatureImageExists: bool(d, "signature-image-exists"),
      suppressSignature: bool(d, "suppress-signature"),
      deliveryOptions: children(child(d, "delivery-options"), "item").map((i) => ({
        option: str(i, "delivery-option"),
        description: str(i, "delivery-option-description"),
      })),
      // The XSD says <occurrence>; one documentation sample uses <item>.
      events: [...children(events, "occurrence"), ...children(events, "item")].map((e) => ({
        identifier: str(e, "event-identifier"),
        date: str(e, "event-date"),
        time: str(e, "event-time"),
        timeZone: str(e, "event-time-zone"),
        description: str(e, "event-description"),
        site: str(e, "event-site"),
        province: str(e, "event-province"),
        retailLocationId: str(e, "event-retail-location-id"),
        retailName: str(e, "event-retail-name"),
      })),
      codRemit: cod === undefined ? undefined : { pin: str(cod, "pin"), type: str(cod, "type") },
      raw: d,
    };
  }
}
