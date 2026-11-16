import { CanadaPostValidationError } from "../errors.js";
import { queryString } from "../http.js";
import { REST_BASE_URL } from "./config.js";
import {
  assertIsoDate,
  getJson,
  jsonArrayOrSingleton,
  jsonObject,
  jsonObjectOrSingleton,
  type RestContext,
} from "./context.js";
import type {
  RestCertificate,
  RestCertificateRequest,
  RestTrackingByReferenceInput,
  RestTrackingDetail,
  RestTrackingSummary,
} from "./types-services.js";

const PIN = /^[A-Za-z0-9]{11,16}$/;
const DNC = /^\d{15}$/;

function assertPin(value: string): string {
  if (!PIN.test(value)) {
    throw new CanadaPostValidationError("pin must be 11-16 letters or digits (no spaces)");
  }
  return value;
}

function assertDnc(value: string): string {
  if (!DNC.test(value)) {
    throw new CanadaPostValidationError("dnc must be the 15 digits of the delivery notice card");
  }
  return value;
}

/**
 * Parcel tracking (Tracking v1). Everything here is a read; the one POST
 * ({@link RestTrackingApi.createCertificate}) only renders a certificate. Tracking is not tied
 * to a customer number, so it also works on an app whose organization is not linked yet.
 */
export class RestTrackingApi {
  constructor(private readonly ctx: RestContext) {}

  /**
   * The most recent event of a parcel. An unknown PIN comes back as an element with an
   * `error` (not as an HTTP error), so check `error` on each entry.
   */
  async getSummaryByPin(pin: string): Promise<RestTrackingSummary[]> {
    const result = await getJson(
      this.ctx,
      "tracking.getSummaryByPin",
      `${REST_BASE_URL}/tracking/v1/pins/${assertPin(pin)}/summaries`,
    );
    return jsonArrayOrSingleton(result, "tracking.getSummaryByPin") as RestTrackingSummary[];
  }

  /** The most recent event of the parcel a delivery notice card (DNC) belongs to. */
  async getSummaryByDnc(dnc: string): Promise<RestTrackingSummary[]> {
    const result = await getJson(
      this.ctx,
      "tracking.getSummaryByDnc",
      `${REST_BASE_URL}/tracking/v1/dncs/${assertDnc(dnc)}/summaries`,
    );
    return jsonArrayOrSingleton(result, "tracking.getSummaryByDnc") as RestTrackingSummary[];
  }

  /** The most recent event of every parcel shipped with a reference in a mailing-date window. */
  async getSummaryByReference(input: RestTrackingByReferenceInput): Promise<RestTrackingSummary[]> {
    const ref = input.referenceNumber;
    if (ref === "" || ref.length > 35) {
      throw new CanadaPostValidationError("referenceNumber must be 1-35 characters");
    }
    if (input.customerNumber !== undefined && !/^\d{1,10}$/.test(input.customerNumber)) {
      throw new CanadaPostValidationError("customerNumber must be 1-10 digits");
    }
    const post = input.destinationPostalCode;
    if (post !== undefined && (post === "" || post.length > 14)) {
      throw new CanadaPostValidationError("destinationPostalCode must be 1-14 characters");
    }
    const query = queryString({
      "customer-number": input.customerNumber,
      "reference-number": ref,
      "destination-postal-code": post,
      "mailing-date-from": assertIsoDate(input.mailingDateFrom, "mailingDateFrom"),
      "mailing-date-to": assertIsoDate(input.mailingDateTo, "mailingDateTo"),
    });
    const result = await getJson(
      this.ctx,
      "tracking.getSummaryByReference",
      `${REST_BASE_URL}/tracking/v1/refs/summaries${query}`,
    );
    return jsonArrayOrSingleton(result, "tracking.getSummaryByReference") as RestTrackingSummary[];
  }

  /** The full event history of a parcel. */
  async getDetailsByPin(pin: string): Promise<RestTrackingDetail> {
    const result = await getJson(
      this.ctx,
      "tracking.getDetailsByPin",
      `${REST_BASE_URL}/tracking/v1/pins/${assertPin(pin)}/details`,
    );
    return jsonObjectOrSingleton(
      result,
      "tracking.getDetailsByPin",
    ) as unknown as RestTrackingDetail;
  }

  /** The full event history of the parcel a delivery notice card (DNC) belongs to. */
  async getDetailsByDnc(dnc: string): Promise<RestTrackingDetail> {
    const result = await getJson(
      this.ctx,
      "tracking.getDetailsByDnc",
      `${REST_BASE_URL}/tracking/v1/dncs/${assertDnc(dnc)}/details`,
    );
    return jsonObjectOrSingleton(
      result,
      "tracking.getDetailsByDnc",
    ) as unknown as RestTrackingDetail;
  }

  /**
   * The delivery confirmation certificate of a delivered parcel (a base64 PDF in `image`).
   * A `POST` that only renders a document, so it is classified as a read; like every POST it
   * is never retried. The wire format wants the PIN as a JSON integer, so a PIN that does not
   * fit a safe integer is refused.
   */
  async createCertificate(request: RestCertificateRequest): Promise<RestCertificate> {
    assertPin(request.pin);
    const pin = Number(request.pin);
    if (!/^\d+$/.test(request.pin) || !Number.isSafeInteger(pin)) {
      throw new CanadaPostValidationError(
        "pin must be all digits and fit a JSON integer for a delivery confirmation certificate",
      );
    }
    if (request.language !== "en" && request.language !== "fr") {
      throw new CanadaPostValidationError('language must be "en" or "fr"');
    }
    const result = await this.ctx.http.execute({
      operation: "tracking.createCertificate",
      method: "POST",
      url: `${REST_BASE_URL}/tracking/v1/create-certificate`,
      accept: "application/json",
      body: { pin, language: request.language },
    });
    return jsonObject(result, "tracking.createCertificate") as RestCertificate;
  }
}
