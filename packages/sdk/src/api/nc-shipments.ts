import { MEDIA_TYPES, NAMESPACES } from "../config.js";
import { CanadaPostValidationError } from "../errors.js";
import { queryString, rootElement } from "../http.js";
import { mapLinks, type CanadaPostLink } from "../links.js";
import { document, leaf, wrap } from "../xml/build.js";
import { child, num, parseXml, str, type XmlNode } from "../xml/parse.js";
import {
  formatCompactDateTime,
  normalizePostalCode,
  resolveTarget,
  type ApiContext,
  type LinkOrId,
} from "./context.js";
import {
  buildCustoms,
  buildDestination,
  buildDimensions,
  buildNotification,
  buildOptions,
  buildPreferences,
  buildReferences,
  buildSender,
  buildWeight,
  mapCreditCardReceipt,
  mapDeliverySpec,
  mapPricing,
  mapRefundTicket,
  mapRootLinks,
  mapServiceStandard,
  type AdjustmentOutput,
  type CreditCardReceiptOutput,
  type CustomsInput,
  type DeliverySpecOutput,
  type DestinationInput,
  type DimensionsInput,
  type NotificationInput,
  type PreferencesInput,
  type PricedOptionOutput,
  type ReferencesInput,
  type RefundTicketOutput,
  type SenderInput,
  type ServiceStandardOutput,
  type ShipmentOptionInput,
} from "./shipping-common.js";

/** Input of {@link NcShipmentsApi.create}. */
export interface NcShipmentInput {
  /** Service code such as `DOM.EP`, `DOM.XP`, `USA.TP`, `INT.TP`. See `rating.discoverServices`. */
  serviceCode: string;
  sender: SenderInput;
  destination: DestinationInput;
  options?: readonly ShipmentOptionInput[];
  parcel: {
    weightKg: number;
    /** Required unless `document` is true. */
    dimensionsCm?: DimensionsInput;
    document?: boolean;
    unpackaged?: boolean;
    mailingTube?: boolean;
  };
  notification?: NotificationInput;
  preferences: PreferencesInput;
  references?: ReferencesInput;
  /** Required for non-domestic shipments. */
  customs?: CustomsInput;
  /** Postal code of the pickup/drop-off location when it differs from the sender's. */
  requestedShippingPoint?: string;
  promoCode?: string;
  /** Request the public label URL and expiry (PDF 8.5x11 only). */
  createPublicKey?: boolean;
  /** Request a QR code of the public label (PDF 8.5x11 only). */
  createQrCode?: boolean;
  /** Zonos account key for US-bound shipments without a `customs.usDeclarationId`. */
  zonosKey?: string;
}

/** Result of create / get. Fetch the label with `artifacts.get(findLink(links, "label"))`. */
export interface NcShipmentInfo {
  shipmentId: string;
  trackingPin: string | undefined;
  /** `self`, `details`, `receipt`, `label`, `refund`, `commercialInvoice`, ... */
  links: CanadaPostLink[];
  raw: unknown;
}

/** Result of {@link NcShipmentsApi.getDetails}. */
export interface NcShipmentDetails {
  finalShippingPoint: string | undefined;
  trackingPin: string | undefined;
  deliverySpec: DeliverySpecOutput;
  refundRequest: RefundTicketOutput | undefined;
  raw: unknown;
}

/** Result of {@link NcShipmentsApi.getReceipt}. */
export interface NcShipmentReceipt {
  finalShippingPoint: string | undefined;
  shippingPointName: string | undefined;
  shippingPointId: string | undefined;
  mailedByCustomer: string | undefined;
  serviceCode: string | undefined;
  ratedWeight: number | undefined;
  baseAmount: number | undefined;
  preTaxAmount: number | undefined;
  gstAmount: number | undefined;
  pstAmount: number | undefined;
  hstAmount: number | undefined;
  pricedOptions: PricedOptionOutput[];
  adjustments: AdjustmentOutput[];
  creditCard: CreditCardReceiptOutput | undefined;
  serviceStandard: ServiceStandardOutput;
  raw: unknown;
}

/** Input of {@link NcShipmentsApi.list}: a date range or one tracking PIN. */
export type NcShipmentListInput =
  | {
      /** `Date` or `YYYYMMDDHHMM`; interpreted by Canada Post as Eastern time. */
      from: Date | string;
      /** Defaults to now. */
      to?: Date | string;
    }
  | { trackingPin: string };

/** Result of {@link NcShipmentsApi.list}. */
export interface NcShipmentList {
  /** One `shipment` link per shipment. Pass them to `get`, `getDetails`, `requestRefund`. */
  links: CanadaPostLink[];
  /** Shipment ids parsed from the link URLs (last path segment). */
  shipmentIds: string[];
  raw: unknown;
}

function mapInfo(root: XmlNode): NcShipmentInfo {
  return {
    shipmentId: str(root, "shipment-id") ?? "",
    trackingPin: str(root, "tracking-pin"),
    links: mapRootLinks(root),
    raw: root,
  };
}

/** Builds the `non-contract-shipment` body. */
function buildNcShipment(input: NcShipmentInput): string {
  return document(
    "non-contract-shipment",
    NAMESPACES.ncShipment,
    leaf(
      "requested-shipping-point",
      input.requestedShippingPoint === undefined
        ? undefined
        : normalizePostalCode(input.requestedShippingPoint),
    ),
    wrap(
      "delivery-spec",
      leaf("service-code", input.serviceCode),
      buildSender(input.sender),
      buildDestination(input.destination),
      buildOptions(input.options),
      wrap(
        "parcel-characteristics",
        buildWeight(input.parcel.weightKg),
        buildDimensions(input.parcel.dimensionsCm),
        leaf("document", input.parcel.document),
        leaf("unpackaged", input.parcel.unpackaged),
        leaf("mailing-tube", input.parcel.mailingTube),
      ),
      buildNotification(input.notification),
      buildPreferences(input.preferences),
      buildReferences(input.references),
      buildCustoms(input.customs),
      wrap("settlement-info", leaf("promo-code", input.promoCode)),
    ),
    leaf("create-public-key", input.createPublicKey),
    leaf("create-qr-code", input.createQrCode),
  );
}

/**
 * Non-contract ("one step") shipping for customers without a commercial contract: pay by the
 * credit card on the profile, get a label immediately.
 *
 * **`create` charges the card in production.** The default environment is the sandbox.
 */
export class NcShipmentsApi {
  constructor(private readonly ctx: ApiContext) {}

  #base(): string {
    return `/rs/${this.ctx.config.customerNumber}/ncshipment`;
  }

  /**
   * Creates a shipment and its label. In production this bills the saved credit card.
   *
   * A timeout, dropped connection or gateway error throws `CanadaPostIndeterminateError`:
   * the shipment may exist. Check `ncShipments.list({ from, to })` before retrying.
   */
  async create(input: NcShipmentInput): Promise<NcShipmentInfo> {
    const { ctx } = this;
    const body = buildNcShipment(input);
    const headers: Record<string, string> = {};
    if (input.zonosKey !== undefined && input.zonosKey !== "") {
      headers["X-CPC-Zonos-Key"] = input.zonosKey;
    }
    const res = await ctx.http.execute({
      operation: "ncShipments.create",
      method: "POST",
      url: `${ctx.config.baseUrl}${this.#base()}`,
      accept: MEDIA_TYPES.ncShipment,
      contentType: MEDIA_TYPES.ncShipment,
      body,
      headers,
      mutating: true,
      recovery:
        "Call ncShipments.list({ from, to }) for the window around this request (Eastern " +
        "time) and look for a shipment matching the recipient and PIN before creating again.",
    });
    return mapInfo(
      rootElement(parseXml(res.text), "non-contract-shipment-info", "ncShipments.create"),
    );
  }

  /** Re-reads a shipment (id, `self` link, or list link). Valid for 90 days. */
  async get(shipment: LinkOrId): Promise<NcShipmentInfo> {
    const { ctx } = this;
    const target = resolveTarget(ctx, shipment, "shipment id", (id) => `${this.#base()}/${id}`);
    const res = await ctx.http.execute({
      operation: "ncShipments.get",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.ncShipment,
    });
    return mapInfo(
      rootElement(parseXml(res.text), "non-contract-shipment-info", "ncShipments.get"),
    );
  }

  /** Reads what was submitted plus system-generated fields (final shipping point, PIN). */
  async getDetails(shipment: LinkOrId): Promise<NcShipmentDetails> {
    const { ctx } = this;
    const target = resolveTarget(
      ctx,
      shipment,
      "shipment id",
      (id) => `${this.#base()}/${id}/details`,
    );
    const res = await ctx.http.execute({
      operation: "ncShipments.getDetails",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.ncShipment,
    });
    const d = rootElement(
      parseXml(res.text),
      "non-contract-shipment-details",
      "ncShipments.getDetails",
    );
    const refund = child(d, "refund-request-info");
    return {
      finalShippingPoint: str(d, "final-shipping-point"),
      trackingPin: str(d, "tracking-pin"),
      deliverySpec: mapDeliverySpec(child(d, "delivery-spec")),
      refundRequest: refund === undefined ? undefined : mapRefundTicket(refund),
      raw: d,
    };
  }

  /** Reads the price breakdown and credit card receipt. Not available in the sandbox. */
  async getReceipt(shipment: LinkOrId): Promise<NcShipmentReceipt> {
    const { ctx } = this;
    const target = resolveTarget(
      ctx,
      shipment,
      "shipment id",
      (id) => `${this.#base()}/${id}/receipt`,
    );
    const res = await ctx.http.execute({
      operation: "ncShipments.getReceipt",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.ncShipment,
    });
    const r = rootElement(
      parseXml(res.text),
      "non-contract-shipment-receipt",
      "ncShipments.getReceipt",
    );
    return {
      finalShippingPoint: str(r, "final-shipping-point"),
      shippingPointName: str(r, "shipping-point-name"),
      shippingPointId: str(r, "shipping-point-id"),
      mailedByCustomer: str(r, "mailed-by-customer"),
      serviceCode: str(r, "service-code"),
      ratedWeight: num(r, "rated-weight"),
      baseAmount: num(r, "base-amount"),
      preTaxAmount: num(r, "pre-tax-amount"),
      gstAmount: num(r, "gst-amount"),
      pstAmount: num(r, "pst-amount"),
      hstAmount: num(r, "hst-amount"),
      ...mapPricing(r),
      creditCard: mapCreditCardReceipt(child(r, "cc-receipt-details")),
      serviceStandard: mapServiceStandard(r),
      raw: r,
    };
  }

  /**
   * Finds shipments created in a date range (Eastern time) or by tracking PIN. Use it to
   * recover after an indeterminate create, or to re-print a label.
   */
  async list(input: NcShipmentListInput): Promise<NcShipmentList> {
    const { ctx } = this;
    let query: string;
    if ("trackingPin" in input) {
      if (input.trackingPin.trim() === "") {
        throw new CanadaPostValidationError("trackingPin must not be empty");
      }
      query = queryString({ trackingPIN: input.trackingPin.trim() });
    } else {
      query = queryString({
        from: formatCompactDateTime(input.from, "from"),
        to: input.to === undefined ? undefined : formatCompactDateTime(input.to, "to"),
      });
    }
    const res = await ctx.http.execute({
      operation: "ncShipments.list",
      method: "GET",
      url: `${ctx.config.baseUrl}${this.#base()}${query}`,
      accept: MEDIA_TYPES.ncShipment,
    });
    const root = rootElement(parseXml(res.text), "non-contract-shipments", "ncShipments.list");
    const links = mapLinks(root);
    return { links, shipmentIds: links.map((l) => lastSegment(l.href)), raw: root };
  }

  /**
   * Requests a refund for an unused, unscanned label. **Mutating**: opens a service ticket.
   * Accepts a shipment id or the `refund` link from create / get / list.
   */
  async requestRefund(shipment: LinkOrId, input: { email: string }): Promise<RefundTicketOutput> {
    const { ctx } = this;
    if (input.email.trim() === "") {
      throw new CanadaPostValidationError("email is required");
    }
    const target = resolveTarget(
      ctx,
      shipment,
      "shipment id",
      (id) => `${this.#base()}/${id}/refund`,
    );
    const res = await ctx.http.execute({
      operation: "ncShipments.requestRefund",
      method: "POST",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.ncShipment,
      contentType: target.mediaType ?? MEDIA_TYPES.ncShipment,
      body: document(
        "non-contract-shipment-refund-request",
        NAMESPACES.ncShipment,
        leaf("email", input.email.trim()),
      ),
      mutating: true,
      recovery:
        "Re-read the shipment with ncShipments.getDetails: a refund-request-info element means " +
        "the ticket was opened (error 7292 on retry means the same).",
    });
    return mapRefundTicket(
      rootElement(
        parseXml(res.text),
        "non-contract-shipment-refund-request-info",
        "ncShipments.requestRefund",
      ),
    );
  }
}

function lastSegment(href: string): string {
  const path = href.split("?")[0] ?? href;
  return path.split("/").filter(Boolean).pop() ?? "";
}
