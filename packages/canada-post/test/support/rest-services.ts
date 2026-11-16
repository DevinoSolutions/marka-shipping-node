// Fake wire data for the non-shipping REST APIs and the later Shipping endpoints. Everything
// is invented (ids, names, addresses, phone numbers, card aliases): nothing is account data.
import type {
  RestAuthorizedReturnRequest,
  RestCreatePickupRequest,
  RestOpenReturnRequest,
  RestTransmitRequest,
  RestUpdatePickupRequest,
} from "../../src/index.js";
import { BASE, SHIPPING } from "./rest.js";

export const TRACKING = `${BASE}/tracking/v1`;
export const CUSTOMERINFO = `${BASE}/customerinfo/v1`;
export const RETURNS = `${BASE}/returns/v1`;
export const PICKUP = `${BASE}/pickup/v1`;
export const POSTOFFICE = `${BASE}/postoffice/v1`;
export const SERVICEINFO = `${BASE}/serviceinfo/v1`;

export const FAKE_PIN = "7023210215628702";
export const FAKE_DNC = "168067817265091";

const link = (rel: string, url: string, mediaType = "application/json") => ({
  rel,
  href: url,
  mediaType,
});

// --- Shipping additions -----------------------------------------------------------------

export const FAKE_CC_RECEIPT = {
  merchantName: "Example Merchant",
  merchantUrl: "https://example.invalid",
  nameOnCard: "TEST CARDHOLDER",
  authCode: "A1B2C3",
  authTimestamp: "2026-11-16T10:00:00Z",
  cardType: "VIS",
  currency: "CAD",
  transactionType: "CAPT",
};

export const FAKE_RECEIPT = { ccReceiptDetails: { ...FAKE_CC_RECEIPT, chargeAmount: 12.34 } };

export const FAKE_QR = {
  expiryDate: "2026-12-16T10:00:00Z",
  url: "https://example.invalid/label/abc",
  qrCode: "iVBORw0KGgo=",
};

export const FAKE_REFUND = { serviceTicketDate: "2026-11-16", serviceTicketId: "TICKET0001" };

export const FAKE_GROUPS = [
  {
    groupId: "GROUP1",
    link: link("group", `${SHIPPING}/1234567/1234567/shipments?group-id=GROUP1`),
  },
];

export const FAKE_TRANSMIT_REQUEST: RestTransmitRequest = {
  customerRequestId: "MANIFEST-0001",
  groupIds: ["GROUP1"],
  detailedManifests: true,
  methodOfPayment: "CreditCard",
  manifestAddress: {
    manifestCompany: "Example Sender Ltd",
    manifestName: "Example Sender",
    phoneNumber: "555-555-0100",
    addressDetails: {
      addressLine1: "1 Example Street",
      city: "Ottawa",
      provState: "ON",
      postalZipCode: "K1A0B1",
    },
  },
};

export const FAKE_MANIFEST_LINKS = [
  link("manifest", `${SHIPPING}/1234567/1234567/manifests/PO00000001`),
];

export const FAKE_MANIFEST_INFO = {
  poNumber: "PO00000001",
  links: [
    link("self", `${SHIPPING}/1234567/1234567/manifests/PO00000001`),
    link("details", `${SHIPPING}/1234567/1234567/manifests/PO00000001/details`),
  ],
};

export const FAKE_MANIFEST_DETAILS = {
  poNumber: "PO00000001",
  finalShippingPoint: "K1A0B1",
  shippingPointName: "Example Depot",
  shippingPointId: "0001",
  mailedByCustomer: "1234567",
  "mailed-on-behalf-of": "1234567",
  paidByCustomer: "1234567",
  manifestDate: "2026-11-16",
  manifestTime: "10:15 EST",
  methodOfPayment: "CreditCard",
  ccReceiptDetails: FAKE_CC_RECEIPT,
  manifestPricingInfo: {
    baseCost: 10,
    automationDiscount: -1,
    optionsAndSurcharges: 2,
    gst: 0.5,
    pst: 0,
    hst: 0,
    totalDueCpc: 11.5,
  },
  manifestAddress: FAKE_TRANSMIT_REQUEST.manifestAddress,
};

// --- Tracking ---------------------------------------------------------------------------

export const FAKE_TRACKING_SUMMARY = [
  {
    pin: FAKE_PIN,
    originPostalId: "K1A",
    destinationPostalId: "M5V",
    destinationProvince: "ON",
    serviceName: "Expedited Parcel",
    mailedOnDate: "2026-11-10",
    expectedDeliveryDate: "2026-11-13",
    deliveryOptionCompletedInd: "0",
    eventDateTime: "20261112:101500",
    eventDescription: "Item processed",
    customerRef1: "REF1",
    eventType: "INDUCTION",
    eventLocation: "OTTAWA",
  },
];

export const FAKE_TRACKING_DETAIL = {
  pin: FAKE_PIN,
  activeExists: true,
  archiveExists: false,
  destinationPostalId: "M5V2T6",
  expectedDeliveryDate: "2026-11-13",
  serviceName: "Expedited Parcel",
  signatureImageExists: false,
  suppressSignature: false,
  deliveryOptions: [{ deliveryOption: "SO", deliveryOptionDescription: "Signature required" }],
  significantEvents: [
    {
      eventIdentifier: "1496",
      eventDate: "2026-11-12",
      eventTime: "10:15:00",
      eventTimeZone: "EST",
      eventDescription: "Item processed",
      eventSite: "OTTAWA",
      eventProvince: "ON",
    },
  ],
};

export const FAKE_CERTIFICATE = { image: "JVBERi0xLjQKJSVFT0YK" };

// --- Customer information ---------------------------------------------------------------

/** What Canada Post sends: note the card aliases the SDK must never expose. */
export const FAKE_CARD_ALIAS = "FAKE-CARD-ALIAS-0001";

export const FAKE_CUSTOMER_WIRE = {
  number: "1234567",
  name: "Example Customer Ltd",
  contactPhone: "555-555-0100",
  addressDetails: {
    addressLine1: "1 Example Street",
    city: "Ottawa",
    provState: "ON",
    countryCode: "CA",
    postalZipCode: "K1A0B1",
  },
  contracts: ["0001234567", "0007654321"],
  authorizedPayers: [{ payerNumber: "1234567", methodsOfPayment: ["Account", "CreditCard"] }],
  creditCardAliases: [{ ccType: "VIS", ccAlias: FAKE_CARD_ALIAS }],
  links: [link("self", `${CUSTOMERINFO}/customers/1234567`)],
};

export const FAKE_CUSTOMER_MOBO_WIRE = {
  number: "7654321",
  name: "Example Client Inc",
  contactPhone: "555-555-0101",
  addressDetails: FAKE_CUSTOMER_WIRE.addressDetails,
  contracts: ["0001234567"],
  authorizedPayers: [{ payerNumber: "1234567", methodsOfPayment: ["Account"] }],
};

// --- Returns ----------------------------------------------------------------------------

const RETURN_PARTY = {
  name: "Example Person",
  company: "Example Ltd",
  domesticAddress: {
    addressLine1: "1 Example Street",
    city: "Ottawa",
    province: "ON",
    postalCode: "K1A0B1",
  },
};

export const FAKE_AUTHORIZED_RETURN_REQUEST: RestAuthorizedReturnRequest = {
  createPublicKey: false,
  boxFree: false,
  customerBarcode: "RET0000001",
  customerBarcodeType: "LINEAR",
  serviceCode: "DOM.EP",
  returner: RETURN_PARTY,
  receiver: { ...RETURN_PARTY, email: "returns@example.com", receiverVoiceNumber: "555-555-0102" },
  parcelCharacteristics: { weight: 1.2, dimensions: { length: 20, width: 15, height: 6 } },
  printPreferences: { outputFormat: "4x6", encoding: "PDF", showPackingInstructions: false },
  settlementInfo: { paidByCustomer: "1234567" },
  references: { customerRef1: "RMA-0001" },
};

export const FAKE_AUTHORIZED_RETURN = {
  trackingPin: "7023210215628999",
  customerBarcode: "RET0000001",
  links: [
    link(
      "label",
      `${BASE}/returns/v1/artifacts/1234567/authorized-returns/ART0001/0`,
      "application/pdf",
    ),
  ],
};

export const FAKE_OPEN_RETURN_REQUEST: RestOpenReturnRequest = {
  maxNumberOfArtifacts: 3,
  serviceCode: "DOM.EP",
  receiver: { ...RETURN_PARTY, email: "returns@example.com" },
  printPreferences: { outputFormat: "4x6", encoding: "PDF" },
  settlementInfo: { contractId: "0001234567" },
};

export const FAKE_OPEN_RETURN_ID = "976731742911222800";

export const FAKE_OPEN_RETURN = {
  artifactsRemaining: 3,
  links: [
    link("self", `${RETURNS}/1234567/1234567/open-returns/${FAKE_OPEN_RETURN_ID}`),
    link(
      "artifact",
      `${RETURNS}/1234567/1234567/open-returns/${FAKE_OPEN_RETURN_ID}/artifact`,
      "application/pdf",
    ),
  ],
};

export const FAKE_OPEN_RETURN_DETAILS = {
  artifactsRemaining: 3,
  openReturn: FAKE_OPEN_RETURN_REQUEST,
};

export const FAKE_OPEN_RETURN_LINKS = [
  link("self", `${RETURNS}/1234567/1234567/open-returns/${FAKE_OPEN_RETURN_ID}`),
];

// --- Pickup -----------------------------------------------------------------------------

export function fakePickupDate(): string {
  return "2026-12-01";
}

export const FAKE_PICKUP_REQUEST: RestCreatePickupRequest = {
  pickupType: "OnDemand",
  pickupLocation: { businessAddressFlag: true },
  contactInfo: {
    contactName: "Example Person",
    email: "pickup@example.com",
    contactPhone: "555-555-0100",
    receiveEmailUpdatesFlag: true,
    lang: "e",
  },
  locationDetails: { loadingDockFlag: false, pickupInstructions: "Front desk" },
  itemCharacteristics: { priorityFlag: false },
  pickupVolume: "3 boxes",
  pickupTimes: {
    onDemandPickupTime: { date: fakePickupDate(), preferredTime: "13:00", closingTime: "17:00" },
  },
  paymentInfo: { methodOfPayment: "Account", contractId: "0001234567" },
};

export const FAKE_PICKUP_UPDATE: RestUpdatePickupRequest = {
  contactInfo: FAKE_PICKUP_REQUEST.contactInfo,
  locationDetails: FAKE_PICKUP_REQUEST.locationDetails,
  pickupVolume: "4 boxes",
  pickupTimes: FAKE_PICKUP_REQUEST.pickupTimes,
};

export const FAKE_PICKUP_ID = "11104183";

export const FAKE_PICKUP_CREATED = {
  pickupRequestHeader: {
    requestId: FAKE_PICKUP_ID,
    requestStatus: "Pending",
    pickupType: "OnDemand",
    requestDate: "2026-11-16",
  },
  pickupRequestPrice: {
    preTaxAmount: "10.00",
    gstAmount: "0.50",
    pstAmount: "0.00",
    hstAmount: "0.00",
    dueAmount: "10.50",
  },
  links: [link("self", `${PICKUP}/1234567/pickup-request/${FAKE_PICKUP_ID}`)],
};

export const FAKE_PICKUP_LIST = {
  pickupRequest: [
    {
      pickupRequestHeader: {
        requestId: FAKE_PICKUP_ID,
        requestStatus: "Pending",
        pickupType: "OnDemand",
        requestDate: "2026-11-16",
        nextPickupDate: "2026-12-01",
      },
      links: [link("details", `${PICKUP}/1234567/pickup-request/${FAKE_PICKUP_ID}/details`)],
    },
  ],
};

export const FAKE_PICKUP_DETAILS = {
  pickupRequestHeader: FAKE_PICKUP_LIST.pickupRequest[0]?.pickupRequestHeader,
  pickupRequestDetails: {
    pickupLocation: { businessAddressFlag: true },
    contactInfo: FAKE_PICKUP_REQUEST.contactInfo,
    locationDetails: FAKE_PICKUP_REQUEST.locationDetails,
    pickupVolume: "3 boxes",
    pickupTimes: FAKE_PICKUP_REQUEST.pickupTimes,
  },
};

export const FAKE_PICKUP_PRICE = FAKE_PICKUP_CREATED.pickupRequestPrice;

export const FAKE_PICKUP_AVAILABILITY = {
  postalCode: "K1A0B1",
  onDemandCutoff: "15:00",
  onDemandTour: true,
  scheduledPickupsAvailable: false,
};

// --- Post office ------------------------------------------------------------------------

export const FAKE_POST_OFFICES = [
  {
    address: {
      city: "OTTAWA",
      latitude: "45.4215",
      longitude: -75.6972,
      postalCode: "K1A0B1",
      province: "ON",
      officeAddress: "1 EXAMPLE ST",
    },
    distance: 0.65,
    location: "Example Plaza",
    name: "Example Post Office",
    officeId: "0000102978",
    bilingualDesignation: true,
    link: link("details", `${POSTOFFICE}/post-offices/0000102978/details`),
  },
];

export const FAKE_POST_OFFICE_DETAIL = {
  address: FAKE_POST_OFFICES[0]?.address,
  location: "Example Plaza",
  name: "Example Post Office",
  officeId: "0000102978",
  bilingualDesignation: true,
  hoursList: [{ day: 1, time: ["09:00", "17:00"] }],
};

// --- Service information ----------------------------------------------------------------

export const FAKE_SERVICE_MESSAGES = [
  {
    messageType: "SO",
    messageText: "Example outage notice",
    fromDatetime: "2026-11-16T10:00:00Z",
    toDatetime: "2026-11-16T12:00:00Z",
  },
];
