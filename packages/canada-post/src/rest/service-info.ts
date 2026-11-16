import { REST_BASE_URL } from "./config.js";
import { getJson, jsonArray, type RestContext } from "./context.js";
import type { RestServiceMessage } from "./types-services.js";

/** Canada Post service messages such as outages (Service Information v1). Read-only. */
export class RestServiceInfoApi {
  constructor(private readonly ctx: RestContext) {}

  /** The current service-outage messages (`message-type=SO`, the only type documented). */
  async getMessages(): Promise<RestServiceMessage[]> {
    const result = await getJson(
      this.ctx,
      "serviceInfo.getMessages",
      `${REST_BASE_URL}/serviceinfo/v1/shipments-service?message-type=SO`,
    );
    return jsonArray(result, "serviceInfo.getMessages") as RestServiceMessage[];
  }
}
