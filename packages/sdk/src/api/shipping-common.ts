import { CanadaPostValidationError } from "../errors.js";
import { mapLinks, type CanadaPostLink } from "../links.js";
import { decimal, leaf, wrap } from "../xml/build.js";
import { bool, child, children, num, str, type XmlNode } from "../xml/parse.js";
import { normalizePostalCode } from "./context.js";

// ---------------------------------------------------------------------------------------------
// Shared input types (non-contract and contract shipments use the same building blocks)
// ---------------------------------------------------------------------------------------------

/** Postal address. Canada Post limits: lines 44 chars, city 40. */
export interface AddressInput {
  addressLine1: string;
  addressLine2?: string;
  city?: string;
  /** Province code (`ON`) or US state code. */
  provState?: string;
  /** ISO 3166-1 alpha-2. Defaults to `CA`. */
  countryCode?: string;
  postalZipCode?: string;
}

/** The "From" party. Must be a domestic (Canadian) address. */
export interface SenderInput {
  name?: string;
  company: string;
  contactPhone: string;
  address: AddressInput;
}

/** The "To" party. */
export interface DestinationInput {
  name?: string;
  company?: string;
  additionalAddressInfo?: string;
  /** Required for USA.EP/XP/TP, INT.XP/TP and Deliver to Post Office. */
  clientVoiceNumber?: string;
  address: AddressInput;
}

/** A shipping option such as signature (`SO`), coverage (`COV`) or proof of age (`PA18`). */
export interface ShipmentOptionInput {
  code: string;
  /** Required for `COV` (insured amount) and `COD`. */
  amount?: number;
  qualifier1?: boolean;
  qualifier2?: string;
}

/** Parcel dimensions in centimetres. */
export interface DimensionsInput {
  length: number;
  width: number;
  height: number;
}

/** Email notifications for tracking events. */
export interface NotificationInput {
  email: string;
  onShipment: boolean;
  onException: boolean;
  onDelivery: boolean;
}

/** Label printing preferences. */
export interface PreferencesInput {
  showPackingInstructions: boolean;
  /** US/international only. */
  showPostageRate?: boolean;
  /** US/international only. */
  showInsuredValue?: boolean;
}

/** Your own references; they print on the label and appear in tracking. */
export interface ReferencesInput {
  costCentre?: string;
  customerRef1?: string;
  customerRef2?: string;
}

/** One distinct item type in a customs declaration. */
export interface CustomsItemInput {
  customsDescription: string;
  unitWeightKg: number;
  /** CAD value per unit. */
  customsValuePerUnit: number;
  customsNumberOfUnits: number;
  sku?: string;
  hsTariffCode?: string;
  customsUnitOfMeasure?: string;
  countryOfOrigin?: string;
  provinceOfOrigin?: string;
}

/** Customs declaration for non-domestic shipments. */
export interface CustomsInput {
  currency: string;
  conversionFromCad?: number;
  /** `DOC`, `SAM`, `REP`, `SOG` or `OTH`. */
  reasonForExport: string;
  otherReason?: string;
  items: readonly CustomsItemInput[];
  usDeclarationId?: string;
  certificateNumber?: string;
  licenceNumber?: string;
  invoiceNumber?: string;
  iossId?: string;
}

// ---------------------------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------------------------

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CanadaPostValidationError(`${field} is required`);
  }
  return value;
}

function positive(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CanadaPostValidationError(`${field} must be a positive number`);
  }
  return value;
}

/** Throws unless the value is a non-null object (guards JS callers and bad casts). */
export function requireRecord<T extends object>(value: unknown, field: string): T {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CanadaPostValidationError(`${field} is required and must be an object`);
  }
  return value as T;
}

/** Required text field (non-empty string). */
export function requireText(value: unknown, field: string): string {
  return required(value, field);
}

/**
 * Checks the fields every shipment create input needs, with clear messages, before any XML is
 * built (a JS caller can omit them, and Canada Post answers with an opaque schema 400).
 */
export function validateShipmentCore(input: object, label: string): void {
  const i = input as Record<string, unknown>;
  required(i["serviceCode"], `${label}.serviceCode`);
  requireRecord(i["sender"], `${label}.sender`);
  requireRecord(i["destination"], `${label}.destination`);
  const parcel = requireRecord<Record<string, unknown>>(i["parcel"], `${label}.parcel`);
  if (typeof parcel["weightKg"] !== "number") {
    throw new CanadaPostValidationError(`${label}.parcel.weightKg is required (a number, in kg)`);
  }
  const prefs = requireRecord<Record<string, unknown>>(i["preferences"], `${label}.preferences`);
  if (typeof prefs["showPackingInstructions"] !== "boolean") {
    throw new CanadaPostValidationError(
      `${label}.preferences.showPackingInstructions is required (true or false)`,
    );
  }
}

/**
 * Which XSD address type applies (see docs/research/canadapost-api-contracts.md section 1):
 *
 * - `domestic`: DomesticAddressDetailsType - city, prov-state and postal-zip-code required and
 *   NO country-code element (non-contract sender, return-recipient).
 * - `full`: AddressDetailsType - country-code required (contract sender).
 * - `destination`: DestinationAddressDetailsType - country-code required, city / province /
 *   postal code optional (destination of both services).
 */
type AddressKind = "domestic" | "full" | "destination";

function buildAddressDetails(a: AddressInput, label: string, kind: AddressKind): string {
  const address = requireRecord<AddressInput>(a, `${label}.address`);
  const country = (address.countryCode ?? "CA").toUpperCase();
  if (kind === "domestic" && country !== "CA") {
    throw new CanadaPostValidationError(`${label} address must be in Canada (countryCode CA)`);
  }
  if (kind !== "destination") {
    required(address.city, `${label}.address.city`);
    required(address.provState, `${label}.address.provState`);
  }
  if (kind === "domestic") {
    required(address.postalZipCode, `${label}.address.postalZipCode`);
  }
  const postal =
    address.postalZipCode === undefined
      ? undefined
      : country === "CA"
        ? normalizePostalCode(address.postalZipCode)
        : address.postalZipCode.trim();
  return wrap(
    "address-details",
    leaf("address-line-1", required(address.addressLine1, `${label}.address.addressLine1`)),
    leaf("address-line-2", address.addressLine2),
    leaf("city", address.city),
    leaf("prov-state", address.provState),
    kind === "domestic" ? "" : leaf("country-code", country),
    leaf("postal-zip-code", postal),
  );
}

/**
 * `<sender>`. `domestic` omits country-code (non-contract shipping); the default includes it
 * (contract shipping).
 */
export function buildSender(s: SenderInput, kind: "domestic" | "full" = "full"): string {
  const sender = requireRecord<SenderInput>(s, "sender");
  return wrap(
    "sender",
    leaf("name", sender.name),
    leaf("company", required(sender.company, "sender.company")),
    leaf("contact-phone", required(sender.contactPhone, "sender.contactPhone")),
    buildAddressDetails(sender.address, "sender", kind),
  );
}

/** `<destination>` (same type in both services; country-code is required). */
export function buildDestination(d: DestinationInput): string {
  const dest = requireRecord<DestinationInput>(d, "destination");
  return wrap(
    "destination",
    leaf("name", dest.name),
    leaf("company", dest.company),
    leaf("additional-address-info", dest.additionalAddressInfo),
    leaf("client-voice-number", dest.clientVoiceNumber),
    buildAddressDetails(dest.address, "destination", "destination"),
  );
}

/** `<options>` (omitted when empty). Canada Post allows at most 20. */
export function buildOptions(options: readonly ShipmentOptionInput[] | undefined): string {
  if (options === undefined || options.length === 0) return "";
  if (options.length > 20) {
    throw new CanadaPostValidationError("A shipment can carry at most 20 options");
  }
  return wrap(
    "options",
    ...options.map((o) =>
      wrap(
        "option",
        leaf("option-code", required(o.code, "option.code")),
        o.amount === undefined ? "" : leaf("option-amount", decimal(o.amount, 2)),
        leaf("option-qualifier-1", o.qualifier1),
        leaf("option-qualifier-2", o.qualifier2),
      ),
    ),
  );
}

/** `<dimensions>` */
export function buildDimensions(d: DimensionsInput | undefined): string {
  if (d === undefined) return "";
  return wrap(
    "dimensions",
    leaf("length", decimal(positive(d.length, "dimensions.length"), 1)),
    leaf("width", decimal(positive(d.width, "dimensions.width"), 1)),
    leaf("height", decimal(positive(d.height, "dimensions.height"), 1)),
  );
}

/** `<weight>` in kilograms with up to three decimals. */
export function buildWeight(weightKg: number): string {
  return leaf("weight", decimal(positive(weightKg, "parcel.weightKg"), 3));
}

/** `<notification>` */
export function buildNotification(n: NotificationInput | undefined): string {
  if (n === undefined) return "";
  return wrap(
    "notification",
    leaf("email", required(n.email, "notification.email")),
    leaf("on-shipment", n.onShipment),
    leaf("on-exception", n.onException),
    leaf("on-delivery", n.onDelivery),
  );
}

/** `<preferences>` */
export function buildPreferences(p: PreferencesInput): string {
  return wrap(
    "preferences",
    leaf("show-packing-instructions", p.showPackingInstructions),
    leaf("show-postage-rate", p.showPostageRate),
    leaf("show-insured-value", p.showInsuredValue),
  );
}

/** `<references>` */
export function buildReferences(r: ReferencesInput | undefined): string {
  if (r === undefined) return "";
  return wrap(
    "references",
    leaf("cost-centre", r.costCentre),
    leaf("customer-ref-1", r.customerRef1),
    leaf("customer-ref-2", r.customerRef2),
  );
}

/** `<customs>` */
export function buildCustoms(c: CustomsInput | undefined): string {
  if (c === undefined) return "";
  if (c.items.length === 0 || c.items.length > 500) {
    throw new CanadaPostValidationError("customs.items must contain 1 to 500 items");
  }
  return wrap(
    "customs",
    leaf("currency", required(c.currency, "customs.currency")),
    c.conversionFromCad === undefined
      ? ""
      : leaf("conversion-from-cad", decimal(c.conversionFromCad, 6)),
    leaf("reason-for-export", required(c.reasonForExport, "customs.reasonForExport")),
    leaf("other-reason", c.otherReason),
    wrap(
      "sku-list",
      ...c.items.map((i) =>
        wrap(
          "item",
          leaf("customs-number-of-units", i.customsNumberOfUnits),
          leaf("customs-description", required(i.customsDescription, "customs item description")),
          leaf("sku", i.sku),
          leaf("hs-tariff-code", i.hsTariffCode),
          leaf("unit-weight", decimal(positive(i.unitWeightKg, "customs item unitWeightKg"), 3)),
          leaf("customs-value-per-unit", decimal(i.customsValuePerUnit, 2)),
          leaf("customs-unit-of-measure", i.customsUnitOfMeasure),
          leaf("country-of-origin", i.countryOfOrigin),
          leaf("province-of-origin", i.provinceOfOrigin),
        ),
      ),
    ),
    leaf("certificate-number", c.certificateNumber),
    leaf("licence-number", c.licenceNumber),
    leaf("invoice-number", c.invoiceNumber),
    leaf("ioss-id", c.iossId),
    leaf("us-declaration-id", c.usDeclarationId),
  );
}

// ---------------------------------------------------------------------------------------------
// Response mappers
// ---------------------------------------------------------------------------------------------

/** Mapped address. */
export interface AddressOutput {
  addressLine1: string | undefined;
  addressLine2: string | undefined;
  city: string | undefined;
  provState: string | undefined;
  countryCode: string | undefined;
  postalZipCode: string | undefined;
}

/** Mapped sender / destination / recipient. */
export interface PartyOutput {
  name: string | undefined;
  company: string | undefined;
  contactPhone: string | undefined;
  clientVoiceNumber: string | undefined;
  additionalAddressInfo: string | undefined;
  address: AddressOutput;
}

/** Mapped option. */
export interface OptionOutput {
  code: string | undefined;
  amount: number | undefined;
  qualifier1: boolean | undefined;
  qualifier2: string | undefined;
}

/** Mapped `delivery-spec` of a details response. */
export interface DeliverySpecOutput {
  serviceCode: string | undefined;
  sender: PartyOutput | undefined;
  destination: PartyOutput | undefined;
  /** Present for Deliver-to-Post-Office shipments: the real recipient. */
  recipient: PartyOutput | undefined;
  options: OptionOutput[];
  parcel: {
    weightKg: number | undefined;
    dimensionsCm: { length: number; width: number; height: number } | undefined;
    document: boolean | undefined;
    unpackaged: boolean | undefined;
    mailingTube: boolean | undefined;
    oversized: boolean | undefined;
  };
  notification:
    | {
        email: string | undefined;
        onShipment: boolean | undefined;
        onException: boolean | undefined;
        onDelivery: boolean | undefined;
      }
    | undefined;
  preferences: {
    showPackingInstructions: boolean | undefined;
    showPostageRate: boolean | undefined;
    showInsuredValue: boolean | undefined;
  };
  references: {
    costCentre: string | undefined;
    customerRef1: string | undefined;
    customerRef2: string | undefined;
  };
  printPreferences: { outputFormat: string | undefined; encoding: string | undefined };
  settlement: {
    paidByCustomer: string | undefined;
    contractId: string | undefined;
    intendedMethodOfPayment: string | undefined;
    promoCode: string | undefined;
  };
}

function mapAddress(node: XmlNode | undefined): AddressOutput {
  const a = child(node, "address-details");
  return {
    addressLine1: str(a, "address-line-1"),
    addressLine2: str(a, "address-line-2"),
    city: str(a, "city"),
    provState: str(a, "prov-state"),
    countryCode: str(a, "country-code"),
    postalZipCode: str(a, "postal-zip-code"),
  };
}

function mapParty(node: XmlNode | undefined): PartyOutput | undefined {
  if (node === undefined) return undefined;
  return {
    name: str(node, "name"),
    company: str(node, "company"),
    contactPhone: str(node, "contact-phone"),
    clientVoiceNumber: str(node, "client-voice-number"),
    additionalAddressInfo: str(node, "additional-address-info"),
    address: mapAddress(node),
  };
}

/** Maps a `delivery-spec` element of a details response. */
export function mapDeliverySpec(spec: XmlNode | undefined): DeliverySpecOutput {
  const parcel = child(spec, "parcel-characteristics");
  const dims = child(parcel, "dimensions");
  const length = num(dims, "length");
  const width = num(dims, "width");
  const height = num(dims, "height");
  const notification = child(spec, "notification");
  const prefs = child(spec, "preferences");
  const refs = child(spec, "references");
  const print = child(spec, "print-preferences");
  const settle = child(spec, "settlement-info");
  return {
    serviceCode: str(spec, "service-code"),
    sender: mapParty(child(spec, "sender")),
    destination: mapParty(child(spec, "destination")),
    recipient: mapParty(child(spec, "recipient")),
    options: children(child(spec, "options"), "option").map((o) => ({
      code: str(o, "option-code"),
      amount: num(o, "option-amount"),
      qualifier1: bool(o, "option-qualifier-1"),
      qualifier2: str(o, "option-qualifier-2"),
    })),
    parcel: {
      weightKg: num(parcel, "weight"),
      dimensionsCm:
        length !== undefined && width !== undefined && height !== undefined
          ? { length, width, height }
          : undefined,
      document: bool(parcel, "document"),
      unpackaged: bool(parcel, "unpackaged"),
      mailingTube: bool(parcel, "mailing-tube"),
      oversized: bool(parcel, "oversized"),
    },
    notification:
      notification === undefined
        ? undefined
        : {
            email: str(notification, "email"),
            onShipment: bool(notification, "on-shipment"),
            onException: bool(notification, "on-exception"),
            onDelivery: bool(notification, "on-delivery"),
          },
    preferences: {
      showPackingInstructions: bool(prefs, "show-packing-instructions"),
      showPostageRate: bool(prefs, "show-postage-rate"),
      showInsuredValue: bool(prefs, "show-insured-value"),
    },
    references: {
      costCentre: str(refs, "cost-centre"),
      customerRef1: str(refs, "customer-ref-1"),
      customerRef2: str(refs, "customer-ref-2"),
    },
    printPreferences: {
      outputFormat: str(print, "output-format"),
      encoding: str(print, "encoding"),
    },
    settlement: {
      paidByCustomer: str(settle, "paid-by-customer"),
      contractId: str(settle, "contract-id"),
      intendedMethodOfPayment: str(settle, "intended-method-of-payment"),
      promoCode: str(settle, "promo-code"),
    },
  };
}

/** Price/receipt adjustments as sent by Get Shipment Price / receipts. */
export interface AdjustmentOutput {
  code: string | undefined;
  amount: number | undefined;
}

/** Priced option as sent by Get Shipment Price / receipts. */
export interface PricedOptionOutput {
  code: string | undefined;
  price: number | undefined;
}

/** Maps `priced-options` and `adjustments` (shared by shipment price and NC receipt). */
export function mapPricing(node: XmlNode | undefined): {
  pricedOptions: PricedOptionOutput[];
  adjustments: AdjustmentOutput[];
} {
  return {
    pricedOptions: children(child(node, "priced-options"), "priced-option").map((o) => ({
      code: str(o, "option-code"),
      price: num(o, "option-price"),
    })),
    adjustments: children(child(node, "adjustments"), "adjustment").map((a) => ({
      code: str(a, "adjustment-code"),
      amount: num(a, "adjustment-amount"),
    })),
  };
}

/** Delivery standard as sent by prices and receipts. */
export interface ServiceStandardOutput {
  amDelivery: boolean | undefined;
  guaranteedDelivery: boolean | undefined;
  expectedTransitTimeDays: number | undefined;
  expectedDeliveryDate: string | undefined;
}

/** Maps `service-standard`. Accepts the documented typo `expected-transmit-time`. */
export function mapServiceStandard(node: XmlNode | undefined): ServiceStandardOutput {
  const s = child(node, "service-standard");
  return {
    amDelivery: bool(s, "am-delivery"),
    guaranteedDelivery: bool(s, "guaranteed-delivery"),
    expectedTransitTimeDays: num(s, "expected-transit-time") ?? num(s, "expected-transmit-time"),
    expectedDeliveryDate: str(s, "expected-delivery-date"),
  };
}

/** Credit card receipt. */
export interface CreditCardReceiptOutput {
  merchantName: string | undefined;
  merchantUrl: string | undefined;
  nameOnCard: string | undefined;
  authCode: string | undefined;
  authTimestamp: string | undefined;
  cardType: string | undefined;
  /** Masked by Canada Post when present. */
  cardNumber: string | undefined;
  chargeAmount: number | undefined;
  currency: string | undefined;
  transactionType: string | undefined;
}

/** Maps `cc-receipt-details`. */
export function mapCreditCardReceipt(
  node: XmlNode | undefined,
): CreditCardReceiptOutput | undefined {
  if (node === undefined) return undefined;
  return {
    merchantName: str(node, "merchant-name"),
    merchantUrl: str(node, "merchant-url"),
    nameOnCard: str(node, "name-on-card"),
    authCode: str(node, "auth-code"),
    authTimestamp: str(node, "auth-timestamp"),
    cardType: str(node, "card-type"),
    cardNumber: str(node, "card-number"),
    chargeAmount: num(node, "charge-amount"),
    currency: str(node, "currency"),
    transactionType: str(node, "transaction-type"),
  };
}

/** Refund ticket returned by the refund endpoints. */
export interface RefundTicketOutput {
  serviceTicketDate: string | undefined;
  serviceTicketId: string | undefined;
}

/** Maps a refund-request-info element. */
export function mapRefundTicket(node: XmlNode | undefined): RefundTicketOutput {
  return {
    serviceTicketDate: str(node, "service-ticket-date"),
    serviceTicketId: str(node, "service-ticket-id"),
  };
}

/** Links of a response root: `<links><link/></links>` or direct `<link/>` children. */
export function mapRootLinks(root: XmlNode): CanadaPostLink[] {
  const wrapped = mapLinks(child(root, "links"));
  return wrapped.length > 0 ? wrapped : mapLinks(root);
}
