import { MEDIA_TYPES, NAMESPACES } from "../config.js";
import { CanadaPostValidationError } from "../errors.js";
import { queryString, rootElement } from "../http.js";
import { mapLink, mapLinks, type CanadaPostLink } from "../links.js";
import { document, leaf, wrap } from "../xml/build.js";
import { bool, child, children, num, parseXml, str, type XmlNode } from "../xml/parse.js";
import {
  assertSafeId,
  contractPrefix,
  formatCompactDate,
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
  validateShipmentCore,
  mapCreditCardReceipt,
  mapDeliverySpec,
  mapPricing,
  mapRefundTicket,
  mapRootLinks,
  mapServiceStandard,
  type AddressInput,
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

/** How the postage is paid. */
export type MethodOfPayment = "CreditCard" | "Account" | "SupplierAccount";

/** Input of {@link ShipmentsApi.create}. */
export interface ShipmentInput {
  /**
   * Your unique id (max 35 chars). Duplicates are rejected, and it lets you find the shipment
   * again with `shipments.list({ requestId })` if a create ends up indeterminate.
   * Strongly recommended.
   */
  customerRequestId?: string;
  /** Manifest group (max 32 chars). Required unless `transmitShipment` is true. */
  groupId?: string;
  /**
   * Skip the manifest: the shipment is billed immediately and cannot be voided. Mutually
   * exclusive with `groupId`.
   */
  transmitShipment?: boolean;
  quickshipLabelRequested?: boolean;
  /** Canada Post picks the parcel up at `requestedShippingPoint`. */
  cpcPickupIndicator?: boolean;
  /** Pickup postal code. Mutually exclusive with `shippingPointId`. */
  requestedShippingPoint?: string;
  /** Deposit site number (4 chars). Mutually exclusive with `requestedShippingPoint`. */
  shippingPointId?: string;
  /** `YYYY-MM-DD`. */
  expectedMailingDate?: string;
  /** Include the price in the response (only with `transmitShipment`). */
  provideShipmentPrice?: boolean;
  /** Include the receipt in the response (only with `transmitShipment`). */
  provideReceipt?: boolean;
  createPublicKey?: boolean;
  createQrCode?: boolean;

  serviceCode: string;
  sender: SenderInput;
  destination: DestinationInput;
  options?: readonly ShipmentOptionInput[];
  parcel: {
    weightKg: number;
    dimensionsCm?: DimensionsInput;
    unpackaged?: boolean;
    mailingTube?: boolean;
    oversized?: boolean;
  };
  notification?: NotificationInput;
  /** `outputFormat` `4x6` is thermal, `8.5x11` is paper. `ZPL` encoding needs `4x6`. */
  print?: { outputFormat?: "8.5x11" | "4x6"; encoding?: "PDF" | "ZPL" };
  preferences: PreferencesInput;
  references?: ReferencesInput;
  customs?: CustomsInput;
  settlement?: {
    /** Defaults to the mailed-on-behalf-of customer. */
    paidByCustomer?: string;
    /** Defaults to the configured contract id when paying by `Account`. */
    contractId?: string;
    cifShipment?: boolean;
    /** Defaults to `Account` when a contract id is configured, otherwise `CreditCard`. */
    intendedMethodOfPayment?: MethodOfPayment;
    promoCode?: string;
  };
  /** Zonos account key for US-bound shipments without a `customs.usDeclarationId`. */
  zonosKey?: string;
}

/** Price breakdown (from `getPrice` or embedded in a create response). */
export interface ShipmentPrice {
  serviceCode: string | undefined;
  baseAmount: number | undefined;
  pricedOptions: PricedOptionOutput[];
  adjustments: AdjustmentOutput[];
  preTaxAmount: number | undefined;
  gstAmount: number | undefined;
  pstAmount: number | undefined;
  hstAmount: number | undefined;
  dueAmount: number | undefined;
  serviceStandard: ServiceStandardOutput;
  ratedWeight: number | undefined;
}

/** Receipt of a shipment that needs no manifest. */
export interface ShipmentReceipt {
  creditCard: CreditCardReceiptOutput | undefined;
  supplierAccount:
    | {
        merchantName: string | undefined;
        authCode: string | undefined;
        authTimestamp: string | undefined;
        supplierId: string | undefined;
        chargeAmount: number | undefined;
        currency: string | undefined;
        transactionType: string | undefined;
      }
    | undefined;
}

/** Result of create / get. */
export interface ShipmentInfo {
  customerRequestId: string | undefined;
  shipmentId: string;
  /** `created`, `transmitted` or `suspended`. */
  shipmentStatus: string | undefined;
  trackingPin: string | undefined;
  returnTrackingPin: string | undefined;
  poNumber: string | undefined;
  /** Present when `provideShipmentPrice` was requested with `transmitShipment`. */
  price: ShipmentPrice | undefined;
  /** Present when `provideReceipt` was requested with `transmitShipment`. */
  receipt: ShipmentReceipt | undefined;
  /** `self`, `details`, `group`, `price`, `receipt`, `refund`, `label`, ... */
  links: CanadaPostLink[];
  raw: unknown;
}

/** Result of {@link ShipmentsApi.getDetails}. */
export interface ShipmentDetails {
  customerRequestId: string | undefined;
  shipmentStatus: string | undefined;
  finalShippingPoint: string | undefined;
  trackingPin: string | undefined;
  poNumber: string | undefined;
  shippingPointId: string | undefined;
  cpcPickupIndicator: boolean | undefined;
  groupId: string | undefined;
  transmitShipment: boolean | undefined;
  expectedMailingDate: string | undefined;
  deliverySpec: DeliverySpecOutput;
  refundRequest: RefundTicketOutput | undefined;
  raw: unknown;
}

/** Input of {@link ShipmentsApi.transmit}. */
export interface TransmitInput {
  /** Groups to transmit (recommended at most 30 per call). */
  groupIds: readonly string[];
  cpcPickupIndicator?: boolean;
  requestedShippingPoint?: string;
  shippingPointId?: string;
  /** Full detailed manifest (default true). */
  detailedManifests?: boolean;
  /** Defaults like `ShipmentInput.settlement.intendedMethodOfPayment`. */
  methodOfPayment?: MethodOfPayment;
  manifestAddress: {
    name?: string;
    company: string;
    phoneNumber: string;
    address: AddressInput;
  };
  /** Up to 12 characters; printed on the manifest. */
  customerReference?: string;
  /** Shipments to leave in their group for the next transmit. */
  excludedShipmentIds?: readonly string[];
}

/** Result of {@link ShipmentsApi.transmit}. */
export interface TransmitResult {
  /** One `manifest` link per manifest created. Poll each with `manifests.get(link)`. */
  manifestLinks: CanadaPostLink[];
  raw: unknown;
}

/** Entry of {@link ShipmentsApi.getGroups}. */
export interface ShipmentGroup {
  groupId: string;
  /** `group` link: pass it to `shipments.list({ link })`. */
  link: CanadaPostLink | undefined;
}

/** Search for {@link ShipmentsApi.list}. Exactly one criterion. */
export type ShipmentListInput =
  | { groupId: string; provideShipmentInfo?: boolean }
  | { trackingPin: string }
  | { requestId: string }
  | {
      /** Shipments that need no manifest (created with `transmitShipment`). */
      noManifest: true;
      /** `Date` or `YYYYMMDD` / `YYYY-MM-DD`; defaults to today. */
      date?: Date | string;
      /** Most recent N (default 100, max 99,999). */
      limit?: number;
      provideShipmentInfo?: boolean;
    }
  | {
      /** A `group` or `manifestShipments` link from a previous response. */
      link: CanadaPostLink;
    };

/** Result of {@link ShipmentsApi.list}. */
export interface ShipmentList {
  links: CanadaPostLink[];
  /** Shipment ids parsed from the link URLs. */
  shipmentIds: string[];
  /** Full infos when `provideShipmentInfo` was set. */
  shipments: ShipmentInfo[];
  raw: unknown;
}

function mapPrice(node: XmlNode | undefined): ShipmentPrice | undefined {
  if (node === undefined) return undefined;
  return {
    serviceCode: str(node, "service-code"),
    baseAmount: num(node, "base-amount"),
    ...mapPricing(node),
    preTaxAmount: num(node, "pre-tax-amount"),
    gstAmount: num(node, "gst-amount"),
    pstAmount: num(node, "pst-amount"),
    hstAmount: num(node, "hst-amount"),
    dueAmount: num(node, "due-amount"),
    serviceStandard: mapServiceStandard(node),
    ratedWeight: num(node, "rated-weight"),
  };
}

function mapReceipt(node: XmlNode | undefined): ShipmentReceipt | undefined {
  if (node === undefined) return undefined;
  const supplier = child(node, "supplier-account-receipt-details");
  return {
    creditCard: mapCreditCardReceipt(child(node, "cc-receipt-details")),
    supplierAccount:
      supplier === undefined
        ? undefined
        : {
            merchantName: str(supplier, "merchant-name"),
            authCode: str(supplier, "auth-code"),
            authTimestamp: str(supplier, "auth-timestamp"),
            supplierId: str(supplier, "supplier-id"),
            chargeAmount: num(supplier, "charge-amount"),
            currency: str(supplier, "currency"),
            transactionType: str(supplier, "transaction-type"),
          },
  };
}

function mapInfo(root: XmlNode): ShipmentInfo {
  return {
    customerRequestId: str(root, "customer-request-id"),
    shipmentId: str(root, "shipment-id") ?? "",
    shipmentStatus: str(root, "shipment-status"),
    trackingPin: str(root, "tracking-pin"),
    returnTrackingPin: str(root, "return-tracking-pin"),
    poNumber: str(root, "po-number"),
    price: mapPrice(child(root, "shipment-price")),
    receipt: mapReceipt(child(root, "shipment-receipt")),
    links: mapRootLinks(root),
    raw: root,
  };
}

function defaultPayment(ctx: ApiContext): MethodOfPayment {
  return ctx.config.contractId === undefined ? "CreditCard" : "Account";
}

/** Builds the `shipment` request body. */
function buildShipment(
  input: ShipmentInput,
  defaults: { contractId: string | undefined; method: MethodOfPayment },
): string {
  validateShipmentCore(input, "shipment");
  const hasGroup = input.groupId !== undefined && input.groupId !== "";
  const transmit = input.transmitShipment === true;
  if (hasGroup === transmit) {
    throw new CanadaPostValidationError(
      "Provide exactly one of groupId or transmitShipment: true (transmitShipment bills immediately and skips the manifest)",
    );
  }
  if (input.requestedShippingPoint !== undefined && input.shippingPointId !== undefined) {
    throw new CanadaPostValidationError(
      "requestedShippingPoint and shippingPointId are mutually exclusive",
    );
  }
  if (input.print?.encoding === "ZPL" && input.print.outputFormat !== "4x6") {
    throw new CanadaPostValidationError('ZPL labels require print.outputFormat "4x6"');
  }
  if (input.customerRequestId !== undefined && input.customerRequestId.length > 35) {
    throw new CanadaPostValidationError("customerRequestId must be at most 35 characters");
  }
  const method = input.settlement?.intendedMethodOfPayment ?? defaults.method;
  const settlement = input.settlement ?? {};
  const contractId =
    settlement.contractId ?? (method === "Account" ? defaults.contractId : undefined);
  return document(
    "shipment",
    NAMESPACES.shipment,
    leaf("customer-request-id", input.customerRequestId),
    hasGroup ? leaf("group-id", input.groupId) : leaf("transmit-shipment", true),
    leaf("quickship-label-requested", input.quickshipLabelRequested),
    leaf("cpc-pickup-indicator", input.cpcPickupIndicator),
    leaf(
      "requested-shipping-point",
      input.requestedShippingPoint === undefined
        ? undefined
        : normalizePostalCode(input.requestedShippingPoint),
    ),
    leaf("shipping-point-id", input.shippingPointId),
    leaf("expected-mailing-date", input.expectedMailingDate),
    leaf("provide-pricing-info", input.provideShipmentPrice),
    leaf("provide-receipt-info", input.provideReceipt),
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
        leaf("unpackaged", input.parcel.unpackaged),
        leaf("mailing-tube", input.parcel.mailingTube),
        leaf("oversized", input.parcel.oversized),
      ),
      buildNotification(input.notification),
      wrap(
        "print-preferences",
        leaf("output-format", input.print?.outputFormat),
        leaf("encoding", input.print?.encoding),
      ),
      buildPreferences(input.preferences),
      buildReferences(input.references),
      buildCustoms(input.customs),
      wrap(
        "settlement-info",
        leaf("paid-by-customer", settlement.paidByCustomer),
        leaf("contract-id", contractId),
        leaf("cif-shipment", settlement.cifShipment === true ? true : undefined),
        leaf("intended-method-of-payment", method),
        leaf("promo-code", settlement.promoCode),
      ),
    ),
    leaf("create-public-key", input.createPublicKey),
    leaf("create-qr-code", input.createQrCode),
  );
}

/** Builds the `transmit-set` body. */
function buildTransmitSet(input: TransmitInput, method: MethodOfPayment): string {
  if (input.groupIds.length === 0) {
    throw new CanadaPostValidationError("groupIds must contain at least one group");
  }
  if (input.requestedShippingPoint !== undefined && input.shippingPointId !== undefined) {
    throw new CanadaPostValidationError(
      "requestedShippingPoint and shippingPointId are mutually exclusive",
    );
  }
  const a = input.manifestAddress;
  const country = (a.address.countryCode ?? "CA").toUpperCase();
  return document(
    "transmit-set",
    NAMESPACES.manifest,
    wrap("group-ids", ...input.groupIds.map((g) => leaf("group-id", g))),
    leaf("cpc-pickup-indicator", input.cpcPickupIndicator),
    leaf(
      "requested-shipping-point",
      input.requestedShippingPoint === undefined
        ? undefined
        : normalizePostalCode(input.requestedShippingPoint),
    ),
    leaf("shipping-point-id", input.shippingPointId),
    leaf("detailed-manifests", input.detailedManifests ?? true),
    leaf("method-of-payment", input.methodOfPayment ?? method),
    wrap(
      "manifest-address",
      leaf("manifest-name", a.name),
      leaf("manifest-company", a.company),
      leaf("phone-number", a.phoneNumber),
      wrap(
        "address-details",
        leaf("address-line-1", a.address.addressLine1),
        leaf("address-line-2", a.address.addressLine2),
        leaf("city", a.address.city),
        leaf("prov-state", a.address.provState),
        leaf("country-code", country),
        leaf(
          "postal-zip-code",
          a.address.postalZipCode === undefined
            ? undefined
            : country === "CA"
              ? normalizePostalCode(a.address.postalZipCode)
              : a.address.postalZipCode.trim(),
        ),
      ),
    ),
    leaf("customer-reference", input.customerReference),
    wrap(
      "excluded-shipments",
      ...(input.excludedShipmentIds ?? []).map((s) => leaf("shipment-id", s)),
    ),
  );
}

/**
 * Contract shipping for Canada Post commercial customers.
 *
 * Flow: `create` (group) -> download labels -> `transmit` the group -> `manifests.get` ->
 * `artifacts.get` the manifest. **`create` with `transmitShipment: true` and `transmit` both
 * bill postage in production.** The default environment is the sandbox.
 */
export class ShipmentsApi {
  constructor(private readonly ctx: ApiContext) {}

  #base(): string {
    return `${contractPrefix(this.ctx)}/shipment`;
  }

  /**
   * Creates a shipment (and its label). Without `transmitShipment` nothing is billed until
   * {@link ShipmentsApi.transmit}; with it the shipment is billed immediately and cannot be
   * voided.
   *
   * A timeout, dropped connection or gateway error throws `CanadaPostIndeterminateError`.
   * The shipment may exist: look it up with `shipments.list({ requestId })` (set
   * `customerRequestId`), `shipments.list({ groupId })` or
   * `shipments.list({ noManifest: true, date })` before creating again, or a label may be
   * charged twice.
   */
  async create(input: ShipmentInput): Promise<ShipmentInfo> {
    const { ctx } = this;
    const body = buildShipment(input, {
      contractId: ctx.config.contractId,
      method: defaultPayment(ctx),
    });
    const headers: Record<string, string> = {};
    if (input.zonosKey !== undefined && input.zonosKey !== "") {
      headers["X-CPC-Zonos-Key"] = input.zonosKey;
    }
    const res = await ctx.http.execute({
      operation: "shipments.create",
      method: "POST",
      url: `${ctx.config.baseUrl}${this.#base()}`,
      accept: MEDIA_TYPES.shipment,
      contentType: MEDIA_TYPES.shipment,
      body,
      headers,
      mutating: true,
      recovery:
        "Call shipments.list({ requestId }) with the customerRequestId you sent, or " +
        "shipments.list({ groupId }) / shipments.list({ noManifest: true, date }) and check " +
        "whether the shipment exists before creating it again.",
    });
    return mapInfo(rootElement(parseXml(res.text), "shipment-info", "shipments.create"));
  }

  /** Re-reads a shipment (id, `self` link, or list link). Valid for 90 days. */
  async get(shipment: LinkOrId): Promise<ShipmentInfo> {
    const { ctx } = this;
    const target = resolveTarget(ctx, shipment, "shipment id", (id) => `${this.#base()}/${id}`);
    const res = await ctx.http.execute({
      operation: "shipments.get",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.shipment,
    });
    return mapInfo(rootElement(parseXml(res.text), "shipment-info", "shipments.get"));
  }

  /** Reads what was submitted plus system-generated fields. */
  async getDetails(shipment: LinkOrId): Promise<ShipmentDetails> {
    const { ctx } = this;
    const target = resolveTarget(
      ctx,
      shipment,
      "shipment id",
      (id) => `${this.#base()}/${id}/details`,
    );
    const res = await ctx.http.execute({
      operation: "shipments.getDetails",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.shipment,
    });
    const d = rootElement(parseXml(res.text), "shipment-details", "shipments.getDetails");
    const detail = child(d, "shipment-detail");
    const refund = child(detail, "refund-request-info");
    return {
      customerRequestId: str(d, "customer-request-id"),
      shipmentStatus: str(d, "shipment-status"),
      finalShippingPoint: str(d, "final-shipping-point"),
      trackingPin: str(d, "tracking-pin"),
      poNumber: str(d, "po-number"),
      shippingPointId: str(d, "shipping-point-id"),
      cpcPickupIndicator: bool(d, "cpc-pickup-indicator"),
      groupId: str(detail, "group-id"),
      transmitShipment: bool(detail, "transmit-shipment"),
      expectedMailingDate: str(detail, "expected-mailing-date"),
      deliverySpec: mapDeliverySpec(child(detail, "delivery-spec")),
      refundRequest: refund === undefined ? undefined : mapRefundTicket(refund),
      raw: d,
    };
  }

  /** Reads the price of a shipment (`price` link or id). */
  async getPrice(shipment: LinkOrId): Promise<ShipmentPrice> {
    const { ctx } = this;
    const target = resolveTarget(
      ctx,
      shipment,
      "shipment id",
      (id) => `${this.#base()}/${id}/price`,
    );
    const res = await ctx.http.execute({
      operation: "shipments.getPrice",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.shipment,
    });
    const price = mapPrice(rootElement(parseXml(res.text), "shipment-price", "shipments.getPrice"));
    return price as ShipmentPrice;
  }

  /** Reads the receipt of a no-manifest shipment (`receipt` link or id). */
  async getReceipt(shipment: LinkOrId): Promise<ShipmentReceipt> {
    const { ctx } = this;
    const target = resolveTarget(
      ctx,
      shipment,
      "shipment id",
      (id) => `${this.#base()}/${id}/receipt`,
    );
    const res = await ctx.http.execute({
      operation: "shipments.getReceipt",
      method: "GET",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.shipment,
    });
    return mapReceipt(
      rootElement(parseXml(res.text), "shipment-receipt", "shipments.getReceipt"),
    ) as ShipmentReceipt;
  }

  /**
   * Voids a shipment that has not been transmitted (the label is spoiled or unused).
   * Accepts a shipment id or the `self` link. Already-transmitted shipments need a refund
   * instead (error `8064`).
   */
  async void(shipment: LinkOrId): Promise<void> {
    const { ctx } = this;
    const target = resolveTarget(ctx, shipment, "shipment id", (id) => `${this.#base()}/${id}`);
    await ctx.http.execute({
      operation: "shipments.void",
      method: "DELETE",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.shipment,
      mutating: true,
      recovery:
        "Call shipments.get(shipmentId): a 404 means the shipment is gone (voided); a " +
        "response means it still exists.",
    });
  }

  /**
   * Requests a refund for a transmitted shipment whose label is unused. **Mutating.**
   * Accepts a shipment id or the `refund` link.
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
      operation: "shipments.requestRefund",
      method: "POST",
      url: target.url,
      accept: target.mediaType ?? MEDIA_TYPES.shipment,
      contentType: target.mediaType ?? MEDIA_TYPES.shipment,
      body: document(
        "shipment-refund-request",
        NAMESPACES.shipment,
        leaf("email", input.email.trim()),
      ),
      mutating: true,
      recovery:
        "Re-read the shipment with shipments.getDetails: a refund-request-info element means " +
        "the ticket was opened (error 7292 on retry means the same).",
    });
    return mapRefundTicket(
      rootElement(parseXml(res.text), "shipment-refund-request-info", "shipments.requestRefund"),
    );
  }

  /**
   * Transmits groups: bills the shipments and creates their manifests. **Charges postage in
   * production.** Returns `manifest` links; poll each with `manifests.get` (a pending
   * transmit answers HTTP 202, thrown as `CanadaPostApiError` with `isPending`).
   */
  async transmit(input: TransmitInput): Promise<TransmitResult> {
    const { ctx } = this;
    const body = buildTransmitSet(input, defaultPayment(ctx));
    const res = await ctx.http.execute({
      operation: "shipments.transmit",
      method: "POST",
      url: `${ctx.config.baseUrl}${contractPrefix(ctx)}/manifest`,
      accept: MEDIA_TYPES.manifest,
      contentType: MEDIA_TYPES.manifest,
      body,
      mutating: true,
      recovery:
        "Call manifests.list({ start, end }) for today and check whether a manifest exists " +
        "for your groups; shipments.getGroups() shows groups that are still untransmitted.",
    });
    const root = rootElement(parseXml(res.text), "manifests", "shipments.transmit");
    return { manifestLinks: mapLinks(root), raw: root };
  }

  /** Lists the manifest groups that can be transmitted. */
  async getGroups(): Promise<ShipmentGroup[]> {
    const { ctx } = this;
    const res = await ctx.http.execute({
      operation: "shipments.getGroups",
      method: "GET",
      url: `${ctx.config.baseUrl}${contractPrefix(ctx)}/group`,
      accept: MEDIA_TYPES.shipment,
    });
    const root = rootElement(parseXml(res.text), "groups", "shipments.getGroups");
    return children(root, "group").map((g) => ({
      groupId: str(g, "group-id") ?? "",
      link: mapLink(child(g, "link") ?? {}),
    }));
  }

  /**
   * Finds shipments: by group, tracking PIN, your `customerRequestId`, the no-manifest list of
   * a day, or a link. This is the recovery tool after an indeterminate `create`.
   *
   * A `requestId` search answers HTTP 202 while a shipment is still being created; that is
   * thrown as `CanadaPostApiError` with `isPending === true`, so poll again.
   */
  async list(input: ShipmentListInput): Promise<ShipmentList> {
    const { ctx } = this;
    let url: string;
    let mediaType: string | undefined;
    if ("link" in input) {
      url = resolveTarget(ctx, input.link, "link", () => "").url;
      mediaType = input.link.mediaType;
    } else {
      let query: string;
      if ("groupId" in input) {
        query = queryString({
          groupid: assertSafeId(input.groupId, "groupId"),
          provideShipmentInfo: input.provideShipmentInfo === true ? true : undefined,
        });
      } else if ("trackingPin" in input) {
        query = queryString({ trackingPIN: input.trackingPin });
      } else if ("requestId" in input) {
        query = queryString({ requestId: input.requestId });
      } else {
        query = queryString({
          noManifest: true,
          date: input.date === undefined ? undefined : formatCompactDate(input.date, "date"),
          limit: input.limit,
          provideShipmentInfo: input.provideShipmentInfo === true ? true : undefined,
        });
      }
      url = `${ctx.config.baseUrl}${this.#base()}${query}`;
    }
    const res = await ctx.http.execute({
      operation: "shipments.list",
      method: "GET",
      url,
      accept: mediaType ?? MEDIA_TYPES.shipment,
    });
    const root = rootElement(parseXml(res.text), "shipments", "shipments.list");
    const links = mapLinks(root);
    return {
      links,
      shipmentIds: links.map((l) => lastSegment(l.href)),
      shipments: children(root, "shipment-info").map(mapInfo),
      raw: root,
    };
  }
}

function lastSegment(href: string): string {
  const path = href.split("?")[0] ?? href;
  return path.split("/").filter(Boolean).pop() ?? "";
}
