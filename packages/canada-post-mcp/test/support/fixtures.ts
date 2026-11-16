// Invented wire data for the MCP tests. Nothing here is account data.
import { ACCOUNT, BASE, LINK, json, type Route } from "./harness.js";

export const SHIPMENT_ID = "100000000000000001";
export const PIN = "1234567890123456";
const SHIPPING = `${BASE}/shipping/v1`;

export const SHIPMENT_INFO = {
  shipmentId: SHIPMENT_ID,
  shipmentStatus: "created",
  trackingPin: PIN,
  links: [
    LINK("self", `/shipments/${SHIPMENT_ID}`),
    LINK("details", `/shipments/${SHIPMENT_ID}/details`),
    LINK("price", `/shipments/${SHIPMENT_ID}/price`),
    {
      rel: "label",
      href: `${SHIPPING}/artifacts/fakeconsumer0001/shipping/20000000001/0?token=SHOULD-NOT-LEAK&format=pdf`,
      mediaType: "application/pdf",
      index: 0,
    },
  ],
};

export const CREATE_RESPONSE = {
  customerRequestId: "REQ-0001",
  shipmentId: SHIPMENT_ID,
  shipmentStatus: "created",
  trackingPin: PIN,
  shipmentPrice: { dueAmount: 13, serviceCode: "DOM.RP" },
  links: SHIPMENT_INFO.links,
};

export const SHIPMENT_PRICE = { serviceCode: "DOM.RP", baseAmount: 10, dueAmount: 13 };

export const CREATE_INPUT = {
  customerRequestId: "REQ-0001",
  expectedMailingDate: "2026-12-01",
  deliverySpec: {
    serviceCode: "DOM.RP",
    sender: {
      name: "Example Sender",
      company: "Example Sender Ltd",
      contactPhone: "555-555-0100",
      addressDetails: {
        addressLine1: "1 Example Street",
        city: "Ottawa",
        provState: "ON",
        postalZipCode: "K1A0B1",
      },
    },
    destination: {
      name: "Test Recipient",
      addressDetails: {
        addressLine1: "123 Test Avenue",
        city: "Toronto",
        provState: "ON",
        countryCode: "CA",
        postalZipCode: "M5V2T6",
      },
    },
    parcelCharacteristics: { weight: 1, dimensions: { length: 20, width: 15, height: 6 } },
    settlementInfo: { paidByCustomer: "1234567", intendedMethodOfPayment: "CreditCard" },
  },
};

export const TRANSMIT_INPUT = {
  groupIds: ["GROUP1"],
  detailedManifests: true,
  methodOfPayment: "CreditCard",
  manifestAddress: {
    manifestCompany: "Example Sender Ltd",
    phoneNumber: "555-555-0100",
    addressDetails: {
      addressLine1: "1 Example Street",
      city: "Ottawa",
      provState: "ON",
      postalZipCode: "K1A0B1",
    },
  },
};

export const PICKUP_INPUT = {
  pickupLocation: { businessAddressFlag: true as const },
  contactInfo: {
    contactName: "Example Person",
    email: "pickup@example.com",
    contactPhone: "555-555-0100",
    lang: "e" as const,
  },
  locationDetails: { pickupInstructions: "Front desk" },
  pickupVolume: "3 boxes",
  pickupTimes: {
    onDemandPickupTime: { date: "2026-12-01", preferredTime: "13:00", closingTime: "17:00" },
  },
  paymentInfo: { methodOfPayment: "Account", contractId: "0001234567" },
};

const PARTY = {
  name: "Example Person",
  company: "Example Ltd",
  domesticAddress: {
    addressLine1: "1 Example Street",
    city: "Ottawa",
    province: "ON",
    postalCode: "K1A0B1",
  },
};

export const RETURN_INPUT = {
  serviceCode: "DOM.EP",
  returner: PARTY,
  receiver: { ...PARTY, email: "returns@example.com" },
  customerBarcode: "RET0000001",
};

export const PICKUP_PRICE = {
  preTaxAmount: "10.00",
  gstAmount: "0.50",
  pstAmount: "0.00",
  hstAmount: "0.00",
  dueAmount: "10.50",
};

export const TRACKING_SUMMARY = [
  {
    pin: PIN,
    originPostalId: "K1A",
    destinationPostalId: "M5V",
    serviceName: "Expedited Parcel",
    mailedOnDate: "2026-11-10",
    eventDateTime: "20261112:101500",
    eventDescription: "Item processed",
    eventType: "INDUCTION",
    eventLocation: "OTTAWA",
  },
];

export const CUSTOMER_WIRE = {
  number: "1234567",
  name: "Example Customer Ltd",
  contracts: ["0001234567"],
  authorizedPayers: [{ payerNumber: "1234567", methodsOfPayment: ["Account", "CreditCard"] }],
  creditCardAliases: [{ ccType: "VIS", ccAlias: "FAKE-CARD-ALIAS-0001" }],
};

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

/** Routes of the account shipping API for one shipment. */
export function shipmentRoutes(): Route[] {
  return [
    { method: "GET", path: new RegExp(`/shipments/${SHIPMENT_ID}$`), reply: json(SHIPMENT_INFO) },
    {
      method: "GET",
      path: new RegExp(`/shipments/${SHIPMENT_ID}/price$`),
      reply: json(SHIPMENT_PRICE),
    },
    {
      method: "GET",
      path: new RegExp(`/shipments/${SHIPMENT_ID}/details$`),
      reply: json({ shipmentStatus: "created", trackingPin: PIN }),
    },
    {
      method: "GET",
      path: /\/artifacts\/fakeconsumer0001\/shipping\/20000000001\/0$/,
      reply: { status: 200, body: PDF_BYTES, headers: { "content-type": "application/pdf" } },
    },
  ];
}

export { ACCOUNT };
