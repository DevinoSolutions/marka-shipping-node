import { CanadaPostValidationError } from "../errors.js";
import { queryString } from "../http.js";
import { REST_BASE_URL } from "./config.js";
import {
  getJson,
  jsonArray,
  jsonObjectOrSingleton,
  normalizePostalCode,
  resolveRestTarget,
  type RestContext,
  type RestTarget,
} from "./context.js";
import type {
  RestPostOffice,
  RestPostOfficeDetail,
  RestPostOfficeSearchInput,
} from "./types-services.js";

/** Post office lookup (Post Office v1). Read-only. */
export class RestPostOfficeApi {
  constructor(private readonly ctx: RestContext) {}

  /**
   * The post offices nearest to a postal code, coordinates, or city / street. At least one of
   * those is required (an unfiltered search is refused locally).
   */
  async find(input: RestPostOfficeSearchInput): Promise<RestPostOffice[]> {
    const hasPoint = input.latitude !== undefined && input.longitude !== undefined;
    if (
      input.postalCode === undefined &&
      !hasPoint &&
      input.city === undefined &&
      input.streetName === undefined
    ) {
      throw new CanadaPostValidationError(
        "postOffices.find needs a postalCode, latitude and longitude, a city or a streetName",
      );
    }
    if ((input.latitude === undefined) !== (input.longitude === undefined)) {
      throw new CanadaPostValidationError("latitude and longitude must be given together");
    }
    const max = input.maximum;
    if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 50)) {
      throw new CanadaPostValidationError("maximum must be an integer from 1 to 50");
    }
    if (input.province !== undefined && !/^[A-Za-z]{2}$/.test(input.province)) {
      throw new CanadaPostValidationError("province must be a two-letter code");
    }
    const query = queryString({
      maximum: max,
      d2po: input.d2po,
      bflf: input.bflf,
      tonight: input.tonight,
      longitude: input.longitude,
      latitude: input.latitude,
      "postal-code":
        input.postalCode === undefined
          ? undefined
          : normalizePostalCode(input.postalCode, "postalCode"),
      province: input.province?.toUpperCase(),
      city: input.city,
      "street-name": input.streetName,
    });
    const result = await getJson(
      this.ctx,
      "postOffices.find",
      `${REST_BASE_URL}/postoffice/v1/post-offices${query}`,
    );
    return jsonArray(result, "postOffices.find") as RestPostOffice[];
  }

  /** One post office with its opening hours. Pass an `officeId` or a `details` link. */
  async getDetails(target: RestTarget): Promise<RestPostOfficeDetail> {
    const result = await getJson(
      this.ctx,
      "postOffices.getDetails",
      resolveRestTarget(
        target,
        "office id",
        (id) => `${REST_BASE_URL}/postoffice/v1/post-offices/${id}/details`,
      ),
    );
    return jsonObjectOrSingleton(
      result,
      "postOffices.getDetails",
    ) as unknown as RestPostOfficeDetail;
  }
}
