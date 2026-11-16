import { CanadaPostValidationError } from "../errors.js";
import { queryString } from "../http.js";
import { REST_BASE_URL } from "./config.js";
import {
  assertIsoDate,
  getJson,
  jsonObjectOrSingleton,
  normalizePostalCode,
  resolveRestTarget,
  type RestContext,
  type RestTarget,
} from "./context.js";
import type {
  RestCreatePickupRequest,
  RestCreatePickupResponse,
  RestPickupAvailability,
  RestPickupDetailsResponse,
  RestPickupPrice,
  RestPickupPriceInput,
  RestPickupRequestsResponse,
  RestUpdatePickupRequest,
} from "./types-services.js";

const CREATE_RECOVERY =
  "Look the pickup up before retrying: pickup.list() shows the requests that exist. A second " +
  "create is a second pickup request, billed in a Production app.";
const UPDATE_RECOVERY =
  "Check pickup.getDetails(id) before retrying: it shows whether the change took effect.";
const CANCEL_RECOVERY =
  "Check pickup.getDetails(id) or pickup.list() before retrying: the status says whether the " +
  "request was cancelled.";

function pickupUrl(ctx: RestContext): string {
  return `${REST_BASE_URL}/pickup/v1/${ctx.config.customerNumber}/pickup-request`;
}

function checkTimes(request: RestCreatePickupRequest | RestUpdatePickupRequest): void {
  const t = request.pickupTimes.onDemandPickupTime;
  assertIsoDate(t.date, "pickupTimes.onDemandPickupTime.date");
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!hhmm.test(t.preferredTime) || !hhmm.test(t.closingTime)) {
    throw new CanadaPostValidationError("preferredTime and closingTime must be HH:MM (24 hours)");
  }
  if (request.pickupVolume.length > 40 || request.locationDetails.pickupInstructions.length > 40) {
    throw new CanadaPostValidationError(
      "pickupVolume and pickupInstructions are at most 40 characters",
    );
  }
  if (!/^\d{3}-\d{3}-\d{4}$/.test(request.contactInfo.contactPhone)) {
    throw new CanadaPostValidationError("contactInfo.contactPhone must be 999-999-9999");
  }
}

/**
 * On-demand pickups (Pickup v1). `create` can bill in a Production app. Creating, changing
 * and cancelling are never retried.
 *
 * The customer in the URL is the client's `customerNumber` (an **ASSUMPTION**: the OpenAPI
 * document only calls it `customer`).
 */
export class RestPickupApi {
  constructor(private readonly ctx: RestContext) {}

  /** Requests an on-demand pickup. **Can bill in a Production app.** Never retried. */
  async create(request: RestCreatePickupRequest): Promise<RestCreatePickupResponse> {
    if (request.pickupType !== "OnDemand") {
      throw new CanadaPostValidationError('pickupType must be "OnDemand"');
    }
    checkTimes(request);
    const result = await this.ctx.http.execute({
      operation: "pickup.create",
      method: "POST",
      url: pickupUrl(this.ctx),
      accept: "application/json",
      body: request,
      mutating: true,
      recovery: CREATE_RECOVERY,
    });
    return jsonObjectOrSingleton(result, "pickup.create") as RestCreatePickupResponse;
  }

  /** Changes a pickup request that has not happened yet. Never retried. */
  async update(target: RestTarget, request: RestUpdatePickupRequest): Promise<void> {
    checkTimes(request);
    await this.ctx.http.execute({
      operation: "pickup.update",
      method: "PUT",
      url: resolveRestTarget(target, "pickup request id", (id) => `${pickupUrl(this.ctx)}/${id}`),
      accept: "application/json",
      body: request,
      mutating: true,
      recovery: UPDATE_RECOVERY,
    });
  }

  /** Cancels a pickup request. Never retried. */
  async cancel(target: RestTarget): Promise<void> {
    await this.ctx.http.execute({
      operation: "pickup.cancel",
      method: "DELETE",
      url: resolveRestTarget(target, "pickup request id", (id) => `${pickupUrl(this.ctx)}/${id}`),
      accept: "application/json",
      mutating: true,
      recovery: CANCEL_RECOVERY,
    });
  }

  /** All on-demand pickup requests of the account. */
  async list(): Promise<RestPickupRequestsResponse> {
    const result = await getJson(this.ctx, "pickup.list", pickupUrl(this.ctx));
    return jsonObjectOrSingleton(result, "pickup.list") as RestPickupRequestsResponse;
  }

  /** The location, contact, volume and times of one pickup request. */
  async getDetails(target: RestTarget): Promise<RestPickupDetailsResponse> {
    const result = await getJson(
      this.ctx,
      "pickup.getDetails",
      resolveRestTarget(
        target,
        "pickup request id",
        (id) => `${pickupUrl(this.ctx)}/${id}/details`,
      ),
    );
    return jsonObjectOrSingleton(result, "pickup.getDetails") as RestPickupDetailsResponse;
  }

  /** What a pickup on a date would cost. Free to call. */
  async getPrice(input: RestPickupPriceInput): Promise<RestPickupPrice> {
    const contract = input.contractId;
    if (contract !== undefined && !/^\d{1,10}$/.test(contract)) {
      throw new CanadaPostValidationError("contractId must be 1-10 digits");
    }
    const query = queryString({
      date: assertIsoDate(input.date, "date"),
      contractId: contract,
      priorityFlag: input.priorityFlag,
      alternateAddressPostalCode:
        input.alternateAddressPostalCode === undefined
          ? undefined
          : normalizePostalCode(input.alternateAddressPostalCode, "alternateAddressPostalCode"),
    });
    const result = await getJson(
      this.ctx,
      "pickup.getPrice",
      `${pickupUrl(this.ctx)}/price${query}`,
    );
    return jsonObjectOrSingleton(result, "pickup.getPrice") as RestPickupPrice;
  }

  /** Whether on-demand pickups are available at a postal code, and the cut-off time. */
  async getAvailability(postalCode: string): Promise<RestPickupAvailability> {
    const result = await getJson(
      this.ctx,
      "pickup.getAvailability",
      `${REST_BASE_URL}/pickup/v1/pickup-availability/${normalizePostalCode(postalCode, "postalCode")}`,
    );
    return jsonObjectOrSingleton(result, "pickup.getAvailability") as RestPickupAvailability;
  }
}
