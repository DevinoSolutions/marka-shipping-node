/**
 * Wire types of the remaining Canada Post Developer Portal APIs: Tracking v1, Customer
 * Information v1, Returns v1, Pickup v1, Post Office v1 and Service Information v1. They mirror
 * the OpenAPI documents in `docs/research/openapi/` (Canada Post's own field names), and the
 * contract tests validate requests and fixtures against those documents.
 */
import type { RestLink } from "./types.js";

/** Language of free-text answers (`Accept-Language`). */
export type RestLanguage = "en-CA" | "fr-CA";

// ---------------------------------------------------------------------------------------------
// Tracking v1
// ---------------------------------------------------------------------------------------------

/** Error entry Canada Post embeds in a tracking summary for a PIN it could not resolve. */
export interface RestTrackingEntryError {
  code: string;
  descEn: string;
  descFr: string;
}

/** The most recent event of a parcel (one element of a tracking summary answer). */
export interface RestTrackingSummary {
  pin: string;
  originPostalId?: string;
  destinationPostalId?: string;
  destinationProvince?: string;
  serviceName?: string;
  /** `YYYY-MM-DD`. */
  mailedOnDate?: string;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  /** `"0"`, `"1"` or `"2"`. */
  deliveryOptionCompletedInd?: string;
  /** `YYYYMMDD:HHMMSS`. */
  eventDateTime?: string;
  eventDescription?: string;
  attemptedDate?: string;
  customerRef1?: string;
  customerRef2?: string;
  returnPin?: string;
  eventType?: string;
  eventLocation?: string;
  /** Present instead of the event data when the lookup of that PIN failed. */
  error?: RestTrackingEntryError;
}

/** One event of a parcel's history. */
export interface RestTrackingEvent {
  eventIdentifier?: string;
  /** `YYYY-MM-DD`. */
  eventDate: string;
  eventTime: string;
  eventTimeZone?: string;
  eventDescription?: string;
  eventSite?: string;
  eventProvince?: string;
  eventRetailLocationId?: string;
  eventRetailName?: string;
}

/** Full tracking history of a parcel. */
export interface RestTrackingDetail {
  pin: string;
  activeExists: boolean;
  archiveExists: boolean;
  changedExpectedDate?: string;
  destinationPostalId?: string;
  expectedDeliveryDate?: string;
  changedExpectedDeliveryReason?: string;
  originalPin?: string;
  serviceName?: string;
  serviceName2?: string;
  customerRef1?: string;
  customerRef2?: string;
  returnPin?: string;
  signatureImageExists: boolean;
  suppressSignature: boolean;
  deliveryOptions?: Array<{ deliveryOption: string; deliveryOptionDescription: string }>;
  codRemitInfo?: { pin: string; type: "COD_PIN" | "REMIT_PIN" };
  significantEvents?: RestTrackingEvent[];
}

/** Lookup by the reference a shipper stored on the parcel. */
export interface RestTrackingByReferenceInput {
  /** `customerRef1` or `customerRef2` of the shipment (max 35 characters). */
  referenceNumber: string;
  /** `YYYY-MM-DD`: start of the mailing-date window (not earlier than two months ago). */
  mailingDateFrom: string;
  /** `YYYY-MM-DD`: end of the mailing-date window. */
  mailingDateTo: string;
  /** Customer number (max 10 characters), when not the authenticated one. */
  customerNumber?: string;
  destinationPostalCode?: string;
}

/** Body of `POST /create-certificate`. */
export interface RestCertificateRequest {
  /** Parcel PIN (12, 13 or 16 digits). */
  pin: string;
  language: "en" | "fr";
}

/** The delivery confirmation certificate. */
export interface RestCertificate {
  /** Base64 of the certificate (a PDF). */
  image?: string;
}

// ---------------------------------------------------------------------------------------------
// Customer Information v1
// ---------------------------------------------------------------------------------------------

/** Postal address of a customer. */
export interface RestCustomerAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  provState: string;
  countryCode: string;
  postalZipCode?: string;
}

/** A payer authorized on the account and the payment methods it may use. */
export interface RestAuthorizedPayer {
  payerNumber: string;
  methodsOfPayment?: string[];
}

/**
 * Account profile of a customer number, **without card data**. Canada Post also returns the
 * aliases of the credit cards on file; this SDK drops them (they only ever feed
 * {@link RestPaymentReadiness}) and keeps their count in `creditCardCount`.
 */
export interface RestCustomerInfo {
  number: string;
  name: string;
  contactPhone?: string;
  addressDetails: RestCustomerAddress;
  /** Contract ids of the customer. */
  contracts?: string[];
  authorizedPayers?: RestAuthorizedPayer[];
  /** How many credit cards are on file (the cards themselves are never exposed). */
  creditCardCount: number;
  links?: RestLink[];
}

/** Account profile of a customer a MOBO shipper ships for. */
export interface RestCustomerMoboInfo {
  number?: string;
  name?: string;
  contactPhone?: string;
  addressDetails?: RestCustomerAddress;
  contracts?: string[];
  authorizedPayers?: RestAuthorizedPayer[];
}

/** Whether an account can pay for a label, derived from {@link RestCustomerInfo}. No card data. */
export interface RestPaymentReadiness {
  /** At least one credit card is on file. */
  hasCreditCard: boolean;
  /** Number of contract ids. */
  contracts: number;
  /** Number of authorized payers. */
  authorizedPayers: number;
  /** Distinct payment methods the authorized payers may use (for example `Account`). */
  paymentMethods: string[];
}

// ---------------------------------------------------------------------------------------------
// Returns v1
// ---------------------------------------------------------------------------------------------

/** Domestic address of a returner or receiver. */
export interface RestReturnAddress {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  /** Two-letter province code. */
  province: string;
  postalCode: string;
}

/** The person returning the parcel. */
export interface RestReturner {
  name: string;
  company?: string;
  domesticAddress: RestReturnAddress;
}

/** The person receiving the returned parcel. */
export interface RestReturnReceiver extends RestReturner {
  email?: string;
  receiverVoiceNumber?: string;
}

/** Body of `POST .../authorized-returns`: one return label. May bill in a Production app. */
export interface RestAuthorizedReturnRequest {
  createPublicKey?: boolean;
  createQrCode?: boolean;
  boxFree?: boolean;
  customerBarcode?: string;
  customerBarcodeType?: "LINEAR" | "2D";
  serviceCode: string;
  returner: RestReturner;
  receiver: RestReturnReceiver;
  parcelCharacteristics?: {
    weight?: number;
    dimensions?: { length: number; width: number; height: number };
  };
  printPreferences?: {
    outputFormat?: "8.5x11" | "4x6";
    encoding?: "PDF" | "ZPL";
    showPackingInstructions?: boolean;
  };
  settlementInfo?: { paidByCustomer?: string; contractId?: string };
  references?: { customerRef1?: string; customerRef2?: string };
  notifications?: {
    notificationsList: Array<{
      email: string;
      onShipment: boolean;
      onException: boolean;
      onDelivery: boolean;
    }>;
    emailSubject?: "tracking" | "customer-ref-1" | "customer-ref-2";
  };
}

/** Response of an authorized return. */
export interface RestAuthorizedReturnInfo {
  trackingPin: string;
  customerBarcode?: string;
  publicKeyInfo?: { expiryDate: string; url: string; qrCode?: string };
  links: RestLink[];
}

/** Body of `POST .../open-returns`: a template that yields up to `maxNumberOfArtifacts` labels. */
export interface RestOpenReturnRequest {
  maxNumberOfArtifacts: number;
  serviceCode: string;
  receiver: RestReturnReceiver;
  printPreferences?: {
    outputFormat?: "8.5x11" | "4x6" | "3x5";
    customerInputType?: string;
    encoding?: "PDF" | "ZPL";
    showPackingInstructions?: boolean;
  };
  settlementInfo?: { contractId?: string };
}

/** An open-return template and how many labels it can still produce. */
export interface RestOpenReturnInfo {
  artifactsRemaining: number;
  links: RestLink[];
}

/** Details of an open-return template. */
export interface RestOpenReturnDetails {
  artifactsRemaining: number;
  openReturn: RestOpenReturnRequest;
}

// ---------------------------------------------------------------------------------------------
// Pickup v1
// ---------------------------------------------------------------------------------------------

/** Who Canada Post contacts about the pickup. */
export interface RestPickupContact {
  contactName: string;
  email: string;
  /** `999-999-9999`. */
  contactPhone: string;
  telephoneExt?: string;
  receiveEmailUpdatesFlag?: boolean;
  /** `e` (English) or `f` (French). */
  lang: "e" | "f";
}

/** Where on the premises the driver collects the parcels. */
export interface RestPickupLocationDetails {
  fiveTonFlag?: boolean;
  loadingDockFlag?: boolean;
  /** Max 40 characters. */
  pickupInstructions: string;
}

/** What is picked up. */
export interface RestPickupItemCharacteristics {
  priorityFlag?: boolean;
  returnsFlag?: boolean;
  heavyItemFlag?: boolean;
}

/** Billing of the pickup. */
export interface RestPickupPayment {
  methodOfPayment?: string;
  contractId?: string;
}

/** When the pickup happens. */
export interface RestPickupTimes {
  onDemandPickupTime: {
    /** `YYYY-MM-DD`. */
    date: string;
    /** `HH:MM`. */
    preferredTime: string;
    /** `HH:MM`. */
    closingTime: string;
  };
}

/** Alternate pickup address (only when it is not the business address). */
export interface RestPickupAlternateAddress {
  company: string;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string;
}

/** Pickup at the business address, or at an alternate address. */
export type RestPickupLocation =
  | { businessAddressFlag: true; alternateAddress?: never }
  | { businessAddressFlag: false; alternateAddress: RestPickupAlternateAddress };

/** Body of `POST .../pickup-request`. May bill in a Production app. */
export interface RestCreatePickupRequest {
  pickupType: "OnDemand";
  pickupLocation: RestPickupLocation;
  contactInfo: RestPickupContact;
  locationDetails: RestPickupLocationDetails;
  itemCharacteristics?: RestPickupItemCharacteristics;
  /** Free text, max 40 characters. */
  pickupVolume: string;
  pickupTimes: RestPickupTimes;
  paymentInfo?: RestPickupPayment;
}

/** Body of `PUT .../pickup-request/{requestId}`. */
export interface RestUpdatePickupRequest {
  contactInfo: RestPickupContact;
  locationDetails: RestPickupLocationDetails;
  itemCharacteristics?: RestPickupItemCharacteristics;
  pickupVolume: string;
  pickupTimes: RestPickupTimes;
  paymentInfo?: RestPickupPayment;
}

/** Status header of a pickup request. */
export interface RestPickupRequestHeader {
  requestId?: string;
  requestStatus?: string;
  pickupType?: string;
  requestDate?: string;
  nextPickupDate?: string;
}

/** Price block of a pickup (amounts are strings on the wire, CAD). */
export interface RestPickupPrice {
  preTaxAmount?: string;
  gstAmount?: string;
  pstAmount?: string;
  hstAmount?: string;
  dueAmount?: string;
}

/** Response of creating a pickup request. */
export interface RestCreatePickupResponse {
  pickupRequestHeader?: RestPickupRequestHeader;
  pickupRequestPrice?: RestPickupPrice & {
    ccReceiptDetails?: Record<string, string | undefined>;
  };
  links?: Array<Partial<RestLink>>;
}

/** Response of listing pickup requests. */
export interface RestPickupRequestsResponse {
  pickupRequest?: Array<{
    pickupRequestHeader?: RestPickupRequestHeader;
    links?: Array<Partial<RestLink>>;
  }>;
}

/** Response of `GET .../pickup-request/{requestId}/details`. */
export interface RestPickupDetailsResponse {
  pickupRequestHeader?: RestPickupRequestHeader;
  pickupRequestDetails?: {
    pickupLocation?: RestPickupLocation;
    contactInfo?: RestPickupContact;
    locationDetails?: RestPickupLocationDetails;
    itemCharacteristics?: RestPickupItemCharacteristics;
    pickupVolume?: string;
    pickupTimes?: RestPickupTimes;
  };
}

/** Filters of the pickup price quote. */
export interface RestPickupPriceInput {
  /** `YYYY-MM-DD`. */
  date: string;
  contractId?: string;
  priorityFlag?: boolean;
  alternateAddressPostalCode?: string;
}

/** Response of `GET /pickup-availability/{postalCode}`. */
export interface RestPickupAvailability {
  postalCode?: string;
  onDemandCutoff?: string;
  onDemandTour?: boolean;
  scheduledPickupsAvailable?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Post Office v1
// ---------------------------------------------------------------------------------------------

/** Address and coordinates of a post office. */
export interface RestPostOfficeAddress {
  city: string;
  latitude: string;
  longitude: number;
  postalCode: string;
  province: string;
  officeAddress: string;
}

/** One post office of a nearest-office search. */
export interface RestPostOffice {
  address: RestPostOfficeAddress;
  /** Kilometres. */
  distance: number;
  location: string;
  name: string;
  officeId: string;
  bilingualDesignation: boolean;
  link: RestLink;
}

/** Opening hours of one weekday (1 = Monday ... 7 = Sunday). */
export interface RestPostOfficeHours {
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** `HH:MM` entries, alternating open and close. */
  time: string[];
}

/** One post office with its hours. */
export interface RestPostOfficeDetail {
  address: RestPostOfficeAddress;
  location: string;
  name: string;
  officeId: string;
  bilingualDesignation: boolean;
  hoursList: RestPostOfficeHours[];
}

/** Search criteria of {@link RestPostOfficeApi.find}. At least one location is required. */
export interface RestPostOfficeSearchInput {
  /** Postal code, with or without a space. */
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  province?: string;
  city?: string;
  streetName?: string;
  /** Max 50. */
  maximum?: number;
  /** Only offices with the Delivered-to-Post-Office service. */
  d2po?: boolean;
  /** Only offices with the Buy-Online-Pick-up-at-store service. */
  bflf?: boolean;
  /** Only offices open tonight. */
  tonight?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Service Information v1
// ---------------------------------------------------------------------------------------------

/** A service-outage or service-information message. */
export interface RestServiceMessage {
  /** `SO` (service outage). */
  messageType: string;
  messageText: string;
  /** ISO 8601 date-time. */
  fromDatetime: string;
  toDatetime: string;
}
