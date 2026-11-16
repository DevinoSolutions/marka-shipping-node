// Request bodies of the live test-app suite. The Test app ignores the payload (it answers
// static stubs), so every name, address and phone number here is obviously fake.
import type {
  RestCreateShipmentRequest,
  RestPriceRequest,
  RestTransmitRequest,
} from "../../src/index.js";
import { testCustomerNumber } from "./setup.js";

/** A schema-valid domestic shipment request. `transmitShipment: true`: no manifest needed. */
export function buildShipmentRequest(requestId: string): RestCreateShipmentRequest {
  return {
    customerRequestId: requestId,
    transmitShipment: true,
    requestedShippingPoint: "K1A0B1",
    expectedMailingDate: nextWeekday(),
    providePricingInfo: true,
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
          countryCode: "CA",
          postalZipCode: "K1A0B1",
        },
      },
      destination: {
        name: "Test Recipient",
        clientVoiceNumber: "555-555-0101",
        addressDetails: {
          addressLine1: "123 Test Avenue",
          city: "Toronto",
          provState: "ON",
          countryCode: "CA",
          postalZipCode: "M5V2T6",
        },
      },
      options: [{ optionCode: "DC" }],
      parcelCharacteristics: { weight: 1.2, dimensions: { length: 20, width: 15, height: 6 } },
      references: { customerRef1: "SDK-LIVE-TEST" },
      printPreferences: { outputFormat: "4x6", encoding: "PDF" },
      preferences: { showPackingInstructions: false, showPostageRate: false },
      settlementInfo: {
        paidByCustomer: testCustomerNumber(),
        intendedMethodOfPayment: "CreditCard",
      },
    },
  };
}

/** A schema-valid domestic quote request. */
export function buildQuoteRequest(overrides: Partial<RestPriceRequest> = {}): RestPriceRequest {
  return {
    quoteType: "commercial",
    originPostalCode: "K1A0B1",
    destination: { domestic: { postalCode: "M5V2T6" } },
    parcelCharacteristics: { weight: 1.2, dimensions: { length: 20, width: 15, height: 6 } },
    ...overrides,
  };
}

/** The next Monday-Friday after today, as `YYYY-MM-DD` (a valid expected mailing date). */
function nextWeekday(): string {
  const d = new Date();
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** A schema-valid manifest transmit request (groups come from `shipments.getGroups()`). */
export function buildTransmitRequest(requestId: string): RestTransmitRequest {
  return {
    customerRequestId: requestId,
    groupIds: ["SDKLIVE-GROUP"],
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
}
