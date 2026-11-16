import { CanadaPostParseError, CanadaPostValidationError } from "../errors.js";
import { REST_BASE_URL } from "./config.js";
import { getJson, jsonObjectOrSingleton, type RestContext } from "./context.js";
import type {
  RestCustomerInfo,
  RestCustomerMoboInfo,
  RestPaymentReadiness,
} from "./types-services.js";

const CARD_KEY = "creditCardAliases";

/**
 * Removes the credit-card aliases from a customer answer, registers them with the redactor
 * (so they are scrubbed from any error or debug text later) and returns how many there were.
 */
function takeCardAliases(ctx: RestContext, body: Record<string, unknown>): number {
  const aliases = body[CARD_KEY];
  delete body[CARD_KEY];
  if (!Array.isArray(aliases)) return 0;
  for (const card of aliases) {
    if (typeof card === "object" && card !== null) {
      const alias = (card as { ccAlias?: unknown }).ccAlias;
      if (typeof alias === "string") ctx.redactor.add(alias);
    }
  }
  return aliases.length;
}

/**
 * Customer account information (Customer Information v1).
 *
 * Canada Post's answer lists the aliases of the credit cards on file. This API never hands
 * them out: they are dropped on receipt (only a count survives) and registered with the secret
 * redactor so they cannot reach an error message either.
 */
export class RestCustomersApi {
  constructor(private readonly ctx: RestContext) {}

  /** The profile of the client's own customer number, without card data. */
  async get(): Promise<RestCustomerInfo> {
    const { ctx } = this;
    const result = await getJson(
      ctx,
      "customers.get",
      `${REST_BASE_URL}/customerinfo/v1/customers/${ctx.config.customerNumber}`,
    );
    const body = jsonObjectOrSingleton(result, "customers.get");
    const creditCardCount = takeCardAliases(ctx, body);
    if (typeof body.number !== "string") {
      throw new CanadaPostParseError("customers.get: the response has no customer number");
    }
    return { ...body, creditCardCount } as unknown as RestCustomerInfo;
  }

  /**
   * The profile of a customer the client ships on behalf of (MOBO). Defaults to the client's
   * `mobo` option.
   */
  async getMobo(mobo?: string): Promise<RestCustomerMoboInfo> {
    const { ctx } = this;
    const target = mobo ?? ctx.config.mobo;
    if (!/^\d{1,10}$/.test(target)) {
      throw new CanadaPostValidationError("mobo must be a customer number of 1-10 digits");
    }
    const result = await getJson(
      ctx,
      "customers.getMobo",
      `${REST_BASE_URL}/customerinfo/v1/customers/${ctx.config.customerNumber}/behalfof/${target}`,
    );
    const body = jsonObjectOrSingleton(result, "customers.getMobo");
    takeCardAliases(ctx, body);
    return body as RestCustomerMoboInfo;
  }

  /**
   * Whether the account can pay for labels: a card on file, contracts and authorized payers,
   * without any card data. Use it to check that an org link or a newly added card has taken
   * effect.
   */
  async getPaymentReadiness(): Promise<RestPaymentReadiness> {
    const info = await this.get();
    const methods = new Set<string>();
    for (const payer of info.authorizedPayers ?? []) {
      for (const method of payer.methodsOfPayment ?? []) methods.add(method);
    }
    return {
      hasCreditCard: info.creditCardCount > 0,
      contracts: info.contracts?.length ?? 0,
      authorizedPayers: info.authorizedPayers?.length ?? 0,
      paymentMethods: [...methods].sort(),
    };
  }
}
