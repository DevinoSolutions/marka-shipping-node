import { CanadaPostValidationError } from "../errors.js";
import { queryString } from "../http.js";
import { REST_BASE_URL } from "./config.js";
import { assertRestCode, jsonArray, jsonObject, type RestContext } from "./context.js";
import type {
  RestOptionDetails,
  RestPriceQuote,
  RestPriceRequest,
  RestServiceDetails,
  RestServiceSummary,
} from "./types.js";

/** Filters of {@link RestRatingApi.listServices}. */
export interface RestListServicesInput {
  /** ISO country code of the destination (default `CA`). */
  country?: string;
  /** Contract id, to list the services of that contract. */
  contract?: string;
}

/** Quotes, service discovery and options (Rating v3). Read-only and free of charge. */
export class RestRatingApi {
  constructor(private readonly ctx: RestContext) {}

  /**
   * Prices a parcel for one or more services. A `POST` that only quotes, so it is classified
   * as a read; like every POST it is never retried.
   *
   * A `commercial` quote (the default) sends `customerNumber`, which defaults to the client's.
   * A `counter` quote (retail rates) sends neither `customerNumber` nor `contractId`: a
   * Production app answers HTTP 400 (errorCode 9114) when either is present, so the client
   * leaves the default out and refuses an explicit one with a {@link CanadaPostValidationError}
   * before any request.
   */
  async getPrices(input: RestPriceRequest): Promise<RestPriceQuote[]> {
    const { ctx } = this;
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(input.originPostalCode)) {
      throw new CanadaPostValidationError(
        "originPostalCode must be an upper case Canadian postal code without a space (K1A0B1)",
      );
    }
    let body: RestPriceRequest;
    if (input.quoteType === "counter") {
      if (input.customerNumber !== undefined || input.contractId !== undefined) {
        throw new CanadaPostValidationError(
          'A "counter" quote must not carry customerNumber or contractId (Canada Post rejects ' +
            'them with errorCode 9114); omit them, or use quoteType "commercial"',
        );
      }
      body = { ...input };
      delete body.customerNumber;
      delete body.contractId;
    } else {
      body = { ...input, customerNumber: input.customerNumber ?? ctx.config.customerNumber };
    }
    const result = await ctx.http.execute({
      operation: "rating.getPrices",
      method: "POST",
      url: `${REST_BASE_URL}/rating/v1/prices`,
      accept: "application/json",
      body,
    });
    return jsonArray(result, "rating.getPrices") as RestPriceQuote[];
  }

  /** Lists the services available for a destination country. */
  async listServices(input: RestListServicesInput = {}): Promise<RestServiceSummary[]> {
    const result = await this.ctx.http.execute({
      operation: "rating.listServices",
      method: "GET",
      url: `${REST_BASE_URL}/rating/v1/services${queryString({
        country: input.country,
        contract: input.contract,
      })}`,
      accept: "application/json",
    });
    return jsonArray(result, "rating.listServices") as RestServiceSummary[];
  }

  /** Options and restrictions of one service (`DOM.RP`). */
  async getService(
    serviceCode: string,
    input: { country?: string } = {},
  ): Promise<RestServiceDetails> {
    const result = await this.ctx.http.execute({
      operation: "rating.getService",
      method: "GET",
      url: `${REST_BASE_URL}/rating/v1/services/${assertRestCode(serviceCode, "serviceCode")}${queryString({ country: input.country })}`,
      accept: "application/json",
    });
    return jsonObject(result, "rating.getService") as unknown as RestServiceDetails;
  }

  /** Description of one option (`DC`, `COV`, `SO`). */
  async getOption(optionCode: string): Promise<RestOptionDetails> {
    const result = await this.ctx.http.execute({
      operation: "rating.getOption",
      method: "GET",
      url: `${REST_BASE_URL}/rating/v1/options/${assertRestCode(optionCode, "optionCode")}`,
      accept: "application/json",
    });
    return jsonObject(result, "rating.getOption") as unknown as RestOptionDetails;
  }
}
