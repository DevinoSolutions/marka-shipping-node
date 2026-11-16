/**
 * Wire types of the Canada Post REST/JSON APIs (new Developer Portal): Shipping v1 and
 * Rating v3. They mirror the OpenAPI documents kept in `docs/research/openapi/` one to one
 * (the JSON field names are Canada Post's own), narrowed where the specification has
 * mutually exclusive branches. The contract tests validate requests and responses against
 * those documents, so a drift between these types and the real schemas fails the build.
 *
 * The other Developer Portal APIs (tracking, customer information, returns, pickup, post
 * offices, service information) are typed in `types-services.ts`.
 *
 * Not modelled yet (see the contracts doc): pre-authorized payments.
 */

/**
 * Which Canada Post Developer Portal app the credentials belong to, as DECLARED by the caller.
 * The SDK cannot see it: both apps use the same host and token URL, and the app alone decides
 * whether answers are static stubs (`"test"`) or real, billed postage (`"production"`).
 */
export type RestApp = "test" | "production";

/** A hypermedia link returned by the API. Follow it as given; never rebuild it. */
export interface RestLink {
  /** `self`, `details`, `price`, `label`, `group`, `publicLabel`, `publicKeyInfo`, `service`, ... */
  rel: string;
  /** Absolute URL on the Canada Post API host. */
  href: string;
  /** Value for the `Accept` header when following the link. */
  mediaType: string;
  /** Page index of multi-page artifacts. */
  index?: number;
}

/** Domestic address of a sender. */
export interface RestSenderAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  /** Two letter province code. */
  provState: string;
  /** Canadian postal code without a space, upper case (`K1A0B1`). */
  postalZipCode: string;
  /** Always `"CA"`: Canada Post only ships from Canada. */
  countryCode: "CA";
}

/** Who sends the parcel. */
export interface RestSender {
  name?: string;
  /** Required by the API even for individuals. */
  company: string;
  contactPhone: string;
  addressDetails: RestSenderAddress;
}

/** Address of a recipient, domestic or international. */
export interface RestDestinationAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  provState?: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
  postalZipCode?: string;
}

/** Who receives the parcel. For domestic destinations `name` or `company` is required. */
export interface RestDestination {
  name?: string;
  company?: string;
  additionalAddressInfo?: string;
  clientVoiceNumber?: string;
  addressDetails: RestDestinationAddress;
}

/** Parcel dimensions in centimetres (one decimal). */
export interface RestDimensions {
  length: number;
  width: number;
  height: number;
}

/** Weight in kilograms (three decimals) and optional dimensions. */
export interface RestParcelCharacteristics {
  weight: number;
  dimensions?: RestDimensions;
  unpackaged?: boolean;
  mailingTube?: boolean;
  oversized?: boolean;
}

/** One option (for example `DC` delivery confirmation, `COV` coverage). */
export interface RestShipmentOption {
  optionCode: string;
  optionAmount?: number;
  optionQualifier1?: boolean;
  optionQualifier2?: string;
}

/** Notification e-mails sent by Canada Post. */
export interface RestNotification {
  email: string;
  onShipment: boolean;
  onException: boolean;
  onDelivery: boolean;
}

/** Label output preferences. */
export interface RestPrintPreferences {
  outputFormat?: "8.5x11" | "4x6";
  encoding?: "PDF" | "ZPL";
}

/** What the label shows. */
export interface RestPreferences {
  showPackingInstructions: boolean;
  showPostageRate?: boolean;
  showInsuredValue?: boolean;
}

/** Free-form references printed on the label. */
export interface RestReferences {
  costCentre?: string;
  customerRef1?: string;
  customerRef2?: string;
}

/** One customs line. */
export interface RestCustomsSku {
  customsNumberOfUnits: number;
  customsDescription: string;
  sku?: string;
  hsTariffCode?: string;
  unitWeight: number;
  customsValuePerUnit: number;
  customsUnitOfMeasure?: string;
  countryOfOrigin?: string;
  provinceOfOrigin?: string;
}

/** Customs declaration for international shipments. */
export interface RestCustoms {
  currency: string;
  /** Three character reason-for-export code, for example `SOG`. */
  reasonForExport: string;
  skuList: RestCustomsSku[];
  usdeclarationid?: string;
  usDeclarationId?: string;
  conversionFromCad?: number;
  otherReason?: string;
  dutiesAndTaxesPrepaid?: number;
  certificateNumber?: string;
  licenseNumber?: string;
  invoiceNumber?: string;
  iossId?: string;
}

/** How the shipment is paid for. */
export type RestMethodOfPayment = "CreditCard" | "Account" | "SupplierAccount";

/** Billing of a shipment. */
export interface RestSettlementInfo {
  paidByCustomer?: string;
  contractId?: string;
  cifShipment?: true;
  intendedMethodOfPayment: RestMethodOfPayment;
  promoCode?: string;
}

/** The parcel, route, options and billing of a shipment. */
export interface RestDeliverySpec {
  /** For example `DOM.RP`, `DOM.EP`, `DOM.XP`, `DOM.PC`. */
  serviceCode: string;
  sender: RestSender;
  destination: RestDestination;
  options?: RestShipmentOption[];
  parcelCharacteristics: RestParcelCharacteristics;
  notification?: RestNotification;
  printPreferences?: RestPrintPreferences;
  preferences: RestPreferences;
  references?: RestReferences;
  customs?: RestCustoms;
  settlementInfo: RestSettlementInfo;
}

/** Fields shared by both forms of {@link RestCreateShipmentRequest}. */
export interface RestCreateShipmentBase {
  /**
   * Your own unique request id (max 35 characters). It is the only way to find a shipment
   * again after an indeterminate create (ADR 0001), so always set it.
   */
  customerRequestId?: string;
  /** Postal code of the shipping point (`K1A0B1`). */
  requestedShippingPoint?: string;
  shippingPointId?: string;
  /** `YYYY-MM-DD`. */
  expectedMailingDate?: string;
  cpcPickupIndicator?: true;
  quickshipLabelRequested?: boolean;
  /** Ask for the price in the response (`shipmentPrice`). */
  providePricingInfo?: true;
  /** Ask for the receipt in the response (`shipmentReceipt`). */
  provideReceiptInfo?: true;
  createPublicKey?: boolean;
  createQrCode?: boolean;
  deliverySpec: RestDeliverySpec;
}

/**
 * Body of `POST /{mailedBy}/{mobo}/shipments`. Exactly one of `transmitShipment: true`
 * (no manifest needed) or a `groupId` (manifest later) is required.
 */
export type RestCreateShipmentRequest = RestCreateShipmentBase &
  ({ transmitShipment: true; groupId?: never } | { groupId: string; transmitShipment?: never });

/** Status and links of a shipment. */
export interface RestShipmentInfo {
  customerRequestId?: string;
  shipmentId: string;
  /** For example `created`, `transmitted`, `voided`. */
  shipmentStatus: string;
  trackingPin?: string;
  returnTrackingPin?: string;
  poNumber?: string;
  links: RestLink[];
}

/** Price of a shipment. All amounts are CAD. */
export interface RestShipmentPrice {
  serviceCode: string;
  baseAmount: number;
  pricedOptions?: Array<{ optionCode: string; optionPrice?: number }>;
  adjustments?: Array<{ adjustmentCode: string; adjustmentAmount: number }>;
  preTaxAmount: number;
  gstAmount: number;
  pstAmount: number;
  hstAmount: number;
  dueAmount: number;
  serviceStandard: {
    amDelivery: boolean;
    guaranteedDelivery: boolean;
    expectedTransitTime?: number;
    expectedDeliveryDate?: string;
  };
  ratedWeight: number;
}

/** Response of creating a shipment. */
export interface RestCreateShipmentResponse extends RestShipmentInfo {
  /** Present when `providePricingInfo: true` was sent. */
  shipmentPrice?: RestShipmentPrice;
  /** Present when `provideReceiptInfo: true` was sent. */
  shipmentReceipt?: RestShipmentReceipt;
}

/** Response of `GET .../shipments/{id}/details`. */
export interface RestShipmentDetails {
  customerRequestId?: string;
  shipmentStatus?: string;
  finalShippingPoint?: string;
  trackingPin?: string;
  poNumber?: string;
  shippingPointId?: string;
  cpcPickupIndicator?: boolean;
  shipmentDetail?: {
    groupId?: string;
    transmitShipment?: boolean;
    quickshipLabelRequested?: boolean;
    expectedMailingDate?: string;
    deliverySpec?: Omit<Partial<RestDeliverySpec>, "destination"> & {
      destination?: RestDestination;
      recipient?: RestDestination;
    };
    returnSpec?: Record<string, unknown>;
    refundRequestInfo?: Record<string, unknown>;
  };
}

/** Destination of a quote: exactly one of the three keys. */
export type RestQuoteDestination =
  | { domestic: { postalCode: string }; unitedStates?: never; international?: never }
  | { unitedStates: { zipCode: string }; domestic?: never; international?: never }
  | {
      international: { countryCode: string; postalCode?: string };
      domestic?: never;
      unitedStates?: never;
    };

/** Body of `POST /rating/v1/prices`. */
export interface RestPriceRequest {
  /** Defaults to the client's customer number. Must be omitted for a `counter` quote. */
  customerNumber?: string;
  /** Must be omitted for a `counter` quote. */
  contractId?: string;
  promoCode?: string;
  /**
   * `commercial` (contract rates, default) or `counter` (retail). A `counter` quote is sent
   * without `customerNumber` and `contractId`; passing either throws a validation error.
   */
  quoteType?: "commercial" | "counter";
  /** `YYYY-MM-DD`. */
  expectedMailingDate?: string;
  options?: Array<{ optionCode: string; optionAmount?: number }>;
  parcelCharacteristics: RestParcelCharacteristics;
  /** Restrict the quote to these service codes. */
  services?: string[];
  /** Origin postal code without a space, upper case. */
  originPostalCode: string;
  destination: RestQuoteDestination;
}

/** One tax line of a quote. */
export interface RestTax {
  amt?: number;
  percent?: number;
}

/** One service price of a quote. */
export interface RestPriceQuote {
  serviceCode: string;
  serviceLink: RestLink;
  serviceName: string;
  priceDetails: {
    base: number;
    taxes?: { gst?: RestTax; pst?: RestTax; hst?: RestTax };
    due: number;
    options?: Array<{
      optionCode: string;
      optionName: string;
      optionPrice: number;
      qualifier?: {
        stepSize?: number;
        stepCost?: number;
        includedAmount?: number;
        maxValue?: number;
        included?: boolean;
        percent?: number;
      };
    }>;
    adjustments?: Array<{
      adjustmentCode: string;
      adjustmentName: string;
      adjustmentCost: number;
      qualifier?: { percent: number };
    }>;
  };
  weightDetails: { cubedWeight?: number };
  serviceStandard: {
    amDelivery: boolean;
    guaranteedDelivery: boolean;
    expectedTransitTime?: number;
    expectedDeliveryDate?: string;
  };
}

/** One entry of `GET /rating/v1/services`. */
export interface RestServiceSummary {
  serviceCode: string;
  serviceName: string;
  link: RestLink;
}

/**
 * A dimension limit of a service. The OpenAPI document specifies a number (the maximum); the
 * Test app was observed (2026-11-15) answering `{ min, max }` instead. Which one a Production
 * app returns is an **ASSUMPTION**, so both are typed.
 */
export type RestDimensionLimit = number | { min: number; max: number };

/** Response of `GET /rating/v1/services/{serviceCode}`. */
export interface RestServiceDetails {
  serviceCode: string;
  serviceName: string;
  comment?: string;
  options?: Array<{
    optionCode: string;
    optionName: string;
    mandatory: boolean;
    qualifierRequired: boolean;
    qualifierMax?: number;
    link: RestLink;
  }>;
  restrictions: {
    weightRestriction: { min: number; max: number };
    densityFactor?: number;
    canShipInMailingTube: boolean;
    canShipUnpackaged: boolean;
    allowedAsReturnService: boolean;
    dimensionalRestrictions: {
      length: RestDimensionLimit;
      width: RestDimensionLimit;
      height: RestDimensionLimit;
      lengthPlusGirthMax?: number;
      lengthHeightWidthSumMax?: number;
      oversizeLimit?: number;
    };
  };
}

/** Response of `GET /rating/v1/options/{optionCode}`. */
export interface RestOptionDetails {
  optionCode: string;
  optionName: string;
  /** `FEAT` feature, `DI` direct-impact, `NDI` no-direct-impact. */
  optionClass: "FEAT" | "DI" | "NDI";
  printsOnLabel: boolean;
  qualifierRequired: boolean;
  conflictingOptions?: string[];
  prerequisiteOptions?: string[];
}

/** A downloaded label. */
export interface RestArtifact {
  /** `application/pdf` or `application/zpl` (without parameters). */
  contentType: string;
  /** Raw bytes. ZPL is ASCII text. */
  data: Uint8Array;
}

/** Card payment details on a receipt (never the card number: Canada Post does not return it). */
export interface RestCcReceiptDetails {
  merchantName: string;
  merchantUrl: string;
  nameOnCard?: string;
  authCode: string;
  /** ISO 8601 date-time. */
  authTimestamp: string;
  /** `MC`, `VIS`, `AME`, `DC`, `DIS`, `ER`. */
  cardType: string;
  currency: string;
  transactionType: string;
}

/** Contract-account payment details on a receipt. */
export interface RestSupplierAccountReceiptDetails {
  merchantName: string;
  merchantUrl: string;
  authCode: string;
  authTimestamp: string;
  supplierId: string;
  currency: string;
  transactionType: string;
}

/** Receipt of a shipment: exactly one of the two detail blocks is present. */
export type RestShipmentReceipt =
  | { ccReceiptDetails: RestCcReceiptDetails & { chargeAmount: number } }
  | { supplierAccountReceiptDetails: RestSupplierAccountReceiptDetails & { chargeAmount: number } };

/** Public QR-code / public-key information of a shipment (`GET .../shipments/{id}/qr-code`). */
export interface RestPublicKeyInfo {
  /** ISO 8601 date-time. */
  expiryDate: string;
  /** The public label URL. */
  url: string;
  /** Base64 PNG of the QR code, when one was requested at creation. */
  qrCode?: string;
}

/** Body of `POST .../shipments/{id}/refund`. */
export interface RestRefundRequest {
  /** Where Canada Post sends the refund confirmation (max 60 characters). */
  email: string;
}

/** Service ticket Canada Post opens for a refund request. */
export interface RestRefundInfo {
  /** `YYYY-MM-DD`. */
  serviceTicketDate: string;
  serviceTicketId: string;
}

/** One entry of `GET .../groups`. */
export interface RestShipmentGroup {
  groupId: string;
  link: RestLink;
}

/** Address printed on a manifest. */
export interface RestManifestAddress {
  manifestCompany: string;
  manifestName?: string;
  phoneNumber: string;
  addressDetails: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    provState: string;
    countryCode?: string;
    postalZipCode: string;
  };
}

/** Body of `POST .../manifests`: transmits the shipments of one or more groups. */
export interface RestTransmitRequest {
  customerRequestId?: string;
  /** The groups to transmit (at least one). */
  groupIds: string[];
  cpcPickupIndicator?: true;
  /** Postal code of the shipping point (`K1A0B1`). */
  requestedShippingPoint?: string;
  shippingPointId?: string;
  detailedManifests: boolean;
  methodOfPayment: string;
  manifestAddress: RestManifestAddress;
  /** Max 12 characters. */
  customerReference?: string;
  /** Shipment ids to leave out of the manifest. */
  excludedShipments?: string[];
}

/** Response of `GET .../manifests/{id}`. */
export interface RestManifestInfo {
  customerRequestId?: string;
  poNumber: string;
  links: RestLink[];
}

/** Cost block of a manifest. All amounts are CAD. */
export interface RestManifestPricingInfo {
  baseCost: number;
  automationDiscount: number;
  optionsAndSurcharges: number;
  gst: number;
  pst: number;
  hst: number;
  totalDueCpc: number;
}

/** Response of `GET .../manifests/{id}/details`. */
export interface RestManifestDetails {
  poNumber: string;
  finalShippingPoint: string;
  shippingPointName: string;
  shippingPointId: string;
  cpcPickupIndicator?: true;
  mailedByCustomer: string;
  "mailed-on-behalf-of": string;
  paidByCustomer: string;
  customerRef?: string;
  /** `YYYY-MM-DD`. */
  manifestDate: string;
  manifestTime: string;
  contractId?: string;
  methodOfPayment: string;
  ccReceiptDetails?: RestCcReceiptDetails;
  supplierAccountReceiptDetails?: RestSupplierAccountReceiptDetails;
  manifestPricingInfo: RestManifestPricingInfo;
  manifestAddress: RestManifestAddress;
}
