/**
 * Write tools: preview then apply (the same two-step flow as ADR 0005 of the Newegg MCP server).
 *
 * - Every `canadapost_preview_*` tool validates and normalizes a request, shows it exactly as it
 *   will be sent (plus a quote or a lookup where one exists), stores it under a random,
 *   single-use, short-lived confirm token sealed with an HMAC, and sends NOTHING to Canada Post
 *   that changes state.
 * - `canadapost_apply` takes only that token. It consumes the token, re-verifies the MAC and
 *   executes exactly the stored request: nothing can be altered at apply time and a replay is
 *   refused.
 *
 * These tools are registered only when writes are enabled (see `writePolicy`).
 */
import { z } from "zod";
import {
  OPERATIONS,
  type CanadaPostRestClient,
  type RestAuthorizedReturnRequest,
  type RestCreatePickupRequest,
  type RestCreateShipmentRequest,
  type RestDeliverySpec,
  type RestPriceRequest,
  type RestTransmitRequest,
} from "@joinmarka/canada-post";
import {
  macMatches,
  sealPreview,
  type MacContext,
  type OperationKind,
  type PreviewRecord,
} from "../preview-store.js";
import {
  emailAddress,
  isoDate,
  parcelCharacteristics,
  resourceId,
  returnParty,
} from "./schemas.js";
import {
  businessError,
  defineTool,
  errorResult,
  linkViews,
  mapErrorToPayload,
  newRequestId,
  okResult,
  type ToolContext,
  type ToolDefinition,
  type ToolErrorPayload,
  type ToolResult,
} from "./shared.js";

/** The SDK operation each previewed kind runs: the source of its `charges` flag. */
const OPERATION_ID: Record<OperationKind, string> = {
  "shipment.create": "rest.shipments.create",
  "shipment.void": "rest.shipments.void",
  "shipment.refund": "rest.shipments.requestRefund",
  "manifest.transmit": "rest.shipments.transmit",
  "pickup.create": "rest.pickup.create",
  "pickup.cancel": "rest.pickup.cancel",
  "return.create": "rest.returns.createAuthorized",
};

const KIND_LABEL: Record<OperationKind, string> = {
  "shipment.create": "create a shipment and its label",
  "shipment.void": "void a shipment",
  "shipment.refund": "request a shipment refund",
  "manifest.transmit": "transmit a manifest",
  "pickup.create": "book an on-demand pickup",
  "pickup.cancel": "cancel an on-demand pickup",
  "return.create": "create an authorized return label",
};

function charges(kind: OperationKind): boolean {
  return OPERATIONS[OPERATION_ID[kind]]?.charges === true;
}

function macContext(ctx: ToolContext): MacContext {
  return {
    key: ctx.config.previewHmacKey,
    app: ctx.config.app,
    customerNumber: ctx.config.customerNumber,
  };
}

function modeText(ctx: ToolContext, kind: OperationKind): string {
  if (ctx.config.app === "test") {
    return "TEST APP: Canada Post answers canned stubs; nothing is created or charged.";
  }
  return charges(kind)
    ? "PRODUCTION: applying this CHARGES REAL POSTAGE / FEES to the Canada Post account."
    : "PRODUCTION: applying this changes the real Canada Post account.";
}

/** Stores a previewed request and builds the preview answer. */
function storePreview(
  ctx: ToolContext,
  kind: OperationKind,
  request: unknown,
  extras: Record<string, unknown>,
): ToolResult {
  const record = sealPreview(macContext(ctx), {
    kind,
    request,
    now: ctx.now(),
    ttlSeconds: ctx.config.previewTtlSeconds,
  });
  try {
    ctx.previewStore.put(record);
  } catch (error) {
    return errorResult(
      businessError("too_many_previews", error instanceof Error ? error.message : "store full"),
    );
  }
  return okResult({
    confirmToken: record.id,
    expiresAt: new Date(record.expiresAt).toISOString(),
    expiresInSeconds: ctx.config.previewTtlSeconds,
    operation: kind,
    summary: `Preview: ${KIND_LABEL[kind]}.`,
    app: ctx.config.app,
    mode: modeText(ctx, kind),
    mayCharge: ctx.config.app === "production" && charges(kind),
    request,
    ...extras,
    next:
      "Show this preview to the user. Only after they explicitly agree, call canadapost_apply " +
      "with { confirmToken }. The request is fixed: it cannot be changed at apply time, the " +
      "token works once, and it expires at expiresAt.",
  });
}

/** A best-effort lookup for a preview: a failure is reported, never thrown. */
async function lookup(
  ctx: ToolContext,
  body: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  try {
    return { value: await body() };
  } catch (error) {
    const payload = mapErrorToPayload(error, ctx);
    return { error: { errorCode: payload.errorCode, message: payload.message } };
  }
}

// ---------------------------------------------------------------------------------------------
// shipment create
// ---------------------------------------------------------------------------------------------

const line = (max: number) => z.string().min(1).max(max);

const senderSchema = z.strictObject({
  name: z.string().max(44).optional(),
  company: line(44).describe("Required by Canada Post even for individuals."),
  contactPhone: line(25),
  addressDetails: z.strictObject({
    addressLine1: line(44),
    addressLine2: z.string().max(44).optional(),
    city: line(40),
    provState: z.string().length(2),
    postalZipCode: z.string().regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/, "upper case, no space"),
    countryCode: z.literal("CA").default("CA"),
  }),
});

const destinationSchema = z.strictObject({
  name: z.string().max(44).optional(),
  company: z.string().max(44).optional(),
  additionalAddressInfo: z.string().max(44).optional(),
  clientVoiceNumber: z.string().max(25).optional(),
  addressDetails: z.strictObject({
    addressLine1: z.string().max(44).optional(),
    addressLine2: z.string().max(44).optional(),
    city: z.string().max(40).optional(),
    provState: z.string().max(20).optional(),
    countryCode: z.string().length(2).describe("ISO 3166-1 alpha-2."),
    postalZipCode: z.string().max(14).optional(),
  }),
});

const customsSchema = z.strictObject({
  currency: z.string().length(3),
  reasonForExport: z.string().length(3).describe("For example SOG (sale of goods)."),
  usdeclarationid: z.string().max(40).optional(),
  skuList: z
    .array(
      z.strictObject({
        customsNumberOfUnits: z.number().int().positive(),
        customsDescription: line(45),
        hsTariffCode: z.string().max(12).optional(),
        unitWeight: z.number().positive(),
        customsValuePerUnit: z.number().positive(),
        countryOfOrigin: z.string().length(2).optional(),
      }),
    )
    .min(1)
    .max(100),
});

const deliverySpecSchema = z.strictObject({
  serviceCode: line(32).describe("For example DOM.EP, DOM.RP, DOM.XP, USA.EP."),
  sender: senderSchema,
  destination: destinationSchema,
  options: z
    .array(
      z.strictObject({
        optionCode: line(10),
        optionAmount: z.number().optional(),
        optionQualifier1: z.boolean().optional(),
        optionQualifier2: z.string().max(40).optional(),
      }),
    )
    .max(20)
    .optional(),
  parcelCharacteristics,
  notification: z
    .strictObject({
      email: emailAddress,
      onShipment: z.boolean(),
      onException: z.boolean(),
      onDelivery: z.boolean(),
    })
    .optional(),
  printPreferences: z
    .strictObject({
      outputFormat: z.enum(["8.5x11", "4x6"]).optional(),
      encoding: z.enum(["PDF", "ZPL"]).optional(),
    })
    .optional(),
  preferences: z
    .strictObject({
      showPackingInstructions: z.boolean().default(false),
      showPostageRate: z.boolean().optional(),
      showInsuredValue: z.boolean().optional(),
    })
    .default({ showPackingInstructions: false }),
  references: z
    .strictObject({
      costCentre: z.string().max(30).optional(),
      customerRef1: z.string().max(35).optional(),
      customerRef2: z.string().max(35).optional(),
    })
    .optional(),
  customs: customsSchema.optional(),
  settlementInfo: z.strictObject({
    paidByCustomer: z
      .string()
      .regex(/^\d{1,10}$/)
      .optional(),
    contractId: z
      .string()
      .regex(/^\d{1,10}$/)
      .optional(),
    intendedMethodOfPayment: z.enum(["CreditCard", "Account", "SupplierAccount"]),
    promoCode: z.string().max(20).optional(),
  }),
});

const createShipmentInput = z.strictObject({
  deliverySpec: deliverySpecSchema,
  customerRequestId: line(35)
    .optional()
    .describe("Your own unique id; generated when omitted. It is how an unclear create is found."),
  requestedShippingPoint: z
    .string()
    .regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/)
    .optional(),
  expectedMailingDate: isoDate.optional(),
  groupId: line(32)
    .optional()
    .describe("Add the shipment to a group for a later manifest. Omit to transmit it now."),
});

/** Derives a rating request from a delivery spec, for the preview's quote. */
function quoteRequestFor(
  spec: RestDeliverySpec,
  mailingDate: string | undefined,
): RestPriceRequest {
  const dest = spec.destination.addressDetails;
  const country = dest.countryCode.toUpperCase();
  const destination: RestPriceRequest["destination"] =
    country === "CA"
      ? { domestic: { postalCode: (dest.postalZipCode ?? "").replace(/\s+/g, "").toUpperCase() } }
      : country === "US"
        ? { unitedStates: { zipCode: dest.postalZipCode ?? "" } }
        : {
            international: {
              countryCode: country,
              ...(dest.postalZipCode === undefined ? {} : { postalCode: dest.postalZipCode }),
            },
          };
  return {
    quoteType: "commercial",
    originPostalCode: spec.sender.addressDetails.postalZipCode,
    destination,
    parcelCharacteristics: spec.parcelCharacteristics,
    services: [spec.serviceCode],
    ...(spec.options === undefined
      ? {}
      : {
          options: spec.options.map((o) => ({
            optionCode: o.optionCode,
            ...(o.optionAmount === undefined ? {} : { optionAmount: o.optionAmount }),
          })),
        }),
    ...(mailingDate === undefined ? {} : { expectedMailingDate: mailingDate }),
  };
}

const previewCreateShipment = defineTool({
  name: "canadapost_preview_create_shipment",
  title: "Preview creating a shipment",
  description:
    "Step 1 of 2. Validates a shipment, shows the exact request and a quote for it, and returns a " +
    "confirmToken. Nothing is created. In a Production app applying it BUYS REAL POSTAGE.",
  annotations: {
    title: "Preview creating a shipment",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: createShipmentInput,
  handler: async (input, ctx) => {
    const id = input.customerRequestId ?? newRequestId("MCP", ctx.now());
    const base = {
      customerRequestId: id,
      providePricingInfo: true as const,
      deliverySpec: input.deliverySpec as RestDeliverySpec,
      ...(input.requestedShippingPoint === undefined
        ? {}
        : { requestedShippingPoint: input.requestedShippingPoint }),
      ...(input.expectedMailingDate === undefined
        ? {}
        : { expectedMailingDate: input.expectedMailingDate }),
    };
    const request: RestCreateShipmentRequest =
      input.groupId === undefined
        ? { ...base, transmitShipment: true }
        : { ...base, groupId: input.groupId };
    const quote = await lookup(ctx, () =>
      ctx.client.rating.getPrices(quoteRequestFor(base.deliverySpec, input.expectedMailingDate)),
    );
    return storePreview(ctx, "shipment.create", request, {
      quote: "value" in quote ? quote.value : undefined,
      quoteError: "error" in quote ? quote.error : undefined,
      warnings:
        input.groupId === undefined
          ? []
          : ["The shipment is grouped, not transmitted: it needs a manifest before pickup."],
    });
  },
});

// ---------------------------------------------------------------------------------------------
// void, refund
// ---------------------------------------------------------------------------------------------

const shipmentStatus = async (
  ctx: ToolContext,
  shipmentId: string,
): Promise<Record<string, unknown>> =>
  lookup(ctx, async () => {
    const info = await ctx.client.shipments.get(shipmentId);
    return { shipmentStatus: info.shipmentStatus, trackingPin: info.trackingPin };
  });

const previewVoid = defineTool({
  name: "canadapost_preview_void_shipment",
  title: "Preview voiding a shipment",
  description:
    "Step 1 of 2. Shows the shipment that would be voided (only a shipment that has not been " +
    "transmitted can be) and returns a confirmToken. Nothing is voided yet.",
  annotations: {
    title: "Preview voiding a shipment",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.strictObject({ shipmentId: resourceId }),
  handler: async (input, ctx) => {
    const current = await shipmentStatus(ctx, input.shipmentId);
    return storePreview(ctx, "shipment.void", { shipmentId: input.shipmentId }, { current });
  },
});

const previewRefund = defineTool({
  name: "canadapost_preview_refund_shipment",
  title: "Preview a refund request",
  description:
    "Step 1 of 2. Shows the shipment a refund would be requested for and returns a confirmToken. " +
    "Applying opens a Canada Post service ticket; the confirmation goes to the e-mail given.",
  annotations: {
    title: "Preview a refund request",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.strictObject({ shipmentId: resourceId, email: emailAddress }),
  handler: async (input, ctx) => {
    const current = await shipmentStatus(ctx, input.shipmentId);
    return storePreview(
      ctx,
      "shipment.refund",
      { shipmentId: input.shipmentId, email: input.email },
      { current },
    );
  },
});

// ---------------------------------------------------------------------------------------------
// manifest transmit
// ---------------------------------------------------------------------------------------------

const manifestAddress = z.strictObject({
  manifestCompany: line(44),
  manifestName: line(44).optional(),
  phoneNumber: line(25),
  addressDetails: z.strictObject({
    addressLine1: line(44),
    addressLine2: z.string().max(44).optional(),
    city: line(40),
    provState: line(20),
    countryCode: z.string().length(2).optional(),
    postalZipCode: z.string().min(5).max(10),
  }),
});

const previewTransmit = defineTool({
  name: "canadapost_preview_transmit_manifest",
  title: "Preview transmitting a manifest",
  description:
    "Step 1 of 2. Shows the manifest request and whether the groups exist, and returns a " +
    "confirmToken. Applying transmits the shipments of those groups, which BILLS them in a " +
    "Production app.",
  annotations: {
    title: "Preview transmitting a manifest",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.strictObject({
    groupIds: z.array(line(32)).min(1).max(50),
    detailedManifests: z.boolean(),
    methodOfPayment: line(15).describe("For example CreditCard or Account."),
    manifestAddress,
    requestedShippingPoint: z
      .string()
      .regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/)
      .optional(),
    customerReference: z.string().max(12).optional(),
    excludedShipments: z.array(resourceId).min(1).max(1000).optional(),
    customerRequestId: line(35).optional(),
  }),
  handler: async (input, ctx) => {
    const request: RestTransmitRequest = {
      ...input,
      customerRequestId: input.customerRequestId ?? newRequestId("MCPM", ctx.now()),
    };
    const groups = await lookup(ctx, async () =>
      (await ctx.client.shipments.getGroups()).map((g) => g.groupId),
    );
    const known = "value" in groups ? (groups.value as string[]) : undefined;
    const unknown = known === undefined ? [] : input.groupIds.filter((g) => !known.includes(g));
    return storePreview(ctx, "manifest.transmit", request, {
      groupCheck:
        known === undefined ? groups : { knownGroups: known.length, unknownGroupIds: unknown },
      warnings: unknown.length > 0 ? [`Unknown group id(s): ${unknown.join(", ")}`] : [],
    });
  },
});

// ---------------------------------------------------------------------------------------------
// pickup
// ---------------------------------------------------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

const createPickupInput = z.strictObject({
  pickupLocation: z.union([
    z.strictObject({ businessAddressFlag: z.literal(true) }),
    z.strictObject({
      businessAddressFlag: z.literal(false),
      alternateAddress: z.strictObject({
        company: line(35),
        addressLine1: line(35),
        city: line(35),
        province: z.string().length(2),
        postalCode: z.string().regex(/^[A-Z]\d[A-Z]\d[A-Z]\d$/, "upper case, no space"),
      }),
    }),
  ]),
  contactInfo: z.strictObject({
    contactName: line(35),
    email: emailAddress,
    contactPhone: z.string().regex(/^\d{3}-\d{3}-\d{4}$/, "999-999-9999"),
    telephoneExt: z
      .string()
      .regex(/^\d{1,6}$/)
      .optional(),
    receiveEmailUpdatesFlag: z.boolean().optional(),
    lang: z.enum(["e", "f"]),
  }),
  locationDetails: z.strictObject({
    fiveTonFlag: z.boolean().optional(),
    loadingDockFlag: z.boolean().optional(),
    pickupInstructions: line(40),
  }),
  itemCharacteristics: z
    .strictObject({
      priorityFlag: z.boolean().optional(),
      returnsFlag: z.boolean().optional(),
      heavyItemFlag: z.boolean().optional(),
    })
    .optional(),
  pickupVolume: line(40),
  pickupTimes: z.strictObject({
    onDemandPickupTime: z.strictObject({ date: isoDate, preferredTime: hhmm, closingTime: hhmm }),
  }),
  paymentInfo: z
    .strictObject({
      methodOfPayment: z.string().max(15).optional(),
      contractId: z
        .string()
        .regex(/^\d{1,10}$/)
        .optional(),
    })
    .optional(),
});

const previewCreatePickup = defineTool({
  name: "canadapost_preview_create_pickup",
  title: "Preview booking a pickup",
  description:
    "Step 1 of 2. Shows the pickup request and its price and returns a confirmToken. Nothing is " +
    "booked yet. In a Production app applying it can BILL the account.",
  annotations: {
    title: "Preview booking a pickup",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: createPickupInput,
  handler: async (input, ctx) => {
    const request: RestCreatePickupRequest = { pickupType: "OnDemand", ...input };
    const alternate =
      input.pickupLocation.businessAddressFlag === false
        ? input.pickupLocation.alternateAddress.postalCode
        : undefined;
    const price = await lookup(ctx, () =>
      ctx.client.pickup.getPrice({
        date: input.pickupTimes.onDemandPickupTime.date,
        ...(input.paymentInfo?.contractId === undefined
          ? {}
          : { contractId: input.paymentInfo.contractId }),
        ...(input.itemCharacteristics?.priorityFlag === undefined
          ? {}
          : { priorityFlag: input.itemCharacteristics.priorityFlag }),
        ...(alternate === undefined ? {} : { alternateAddressPostalCode: alternate }),
      }),
    );
    return storePreview(ctx, "pickup.create", request, {
      quote: "value" in price ? price.value : undefined,
      quoteError: "error" in price ? price.error : undefined,
    });
  },
});

const previewCancelPickup = defineTool({
  name: "canadapost_preview_cancel_pickup",
  title: "Preview cancelling a pickup",
  description:
    "Step 1 of 2. Shows the pickup request that would be cancelled and returns a confirmToken.",
  annotations: {
    title: "Preview cancelling a pickup",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.strictObject({ requestId: resourceId }),
  handler: async (input, ctx) => {
    const current = await lookup(ctx, () => ctx.client.pickup.getDetails(input.requestId));
    return storePreview(ctx, "pickup.cancel", { requestId: input.requestId }, { current });
  },
});

// ---------------------------------------------------------------------------------------------
// authorized return
// ---------------------------------------------------------------------------------------------

const createReturnInput = z.strictObject({
  serviceCode: line(32),
  returner: returnParty,
  receiver: returnParty.extend({
    email: emailAddress.optional(),
    receiverVoiceNumber: z.string().max(25).optional(),
  }),
  customerBarcode: line(16).optional(),
  boxFree: z.boolean().optional(),
  parcelCharacteristics: z
    .strictObject({
      weight: z.number().positive().max(999.999).optional(),
      dimensions: z
        .strictObject({
          length: z.number().positive().max(999.9),
          width: z.number().positive().max(999.9),
          height: z.number().positive().max(999.9),
        })
        .optional(),
    })
    .optional(),
  printPreferences: z
    .strictObject({
      outputFormat: z.enum(["8.5x11", "4x6"]).optional(),
      encoding: z.enum(["PDF", "ZPL"]).optional(),
      showPackingInstructions: z.boolean().optional(),
    })
    .optional(),
  settlementInfo: z
    .strictObject({
      paidByCustomer: z
        .string()
        .regex(/^\d{1,10}$/)
        .optional(),
      contractId: z
        .string()
        .regex(/^\d{1,10}$/)
        .optional(),
    })
    .optional(),
  references: z
    .strictObject({
      customerRef1: z.string().max(35).optional(),
      customerRef2: z.string().max(35).optional(),
    })
    .optional(),
});

const previewCreateReturn = defineTool({
  name: "canadapost_preview_create_return",
  title: "Preview an authorized return label",
  description:
    "Step 1 of 2. Validates an authorized return and returns a confirmToken. Nothing is created. " +
    "In a Production app applying it can BILL a return label.",
  annotations: {
    title: "Preview an authorized return label",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: createReturnInput,
  handler: (input, ctx) =>
    Promise.resolve(storePreview(ctx, "return.create", input as RestAuthorizedReturnRequest, {})),
});

// ---------------------------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------------------------

const CONSUME_ERRORS = {
  not_found: "No preview matches that confirmToken (never existed, or the server restarted).",
  expired: "This preview has expired. Create a new preview and apply it within its lifetime.",
  already_used: "This preview was already applied. Previews are single-use; create a new one.",
} as const;

function notice(ctx: ToolContext, kind: OperationKind): string {
  if (ctx.config.app === "test") {
    return "Test app: a canned stub answered. Nothing real was created, charged or changed.";
  }
  if (charges(kind)) {
    return "REAL POSTAGE / FEES WERE CHARGED to the Canada Post account by this operation.";
  }
  return "This changed the real Canada Post account (no postage was charged by this operation).";
}

async function execute(
  client: CanadaPostRestClient,
  record: PreviewRecord,
): Promise<Record<string, unknown>> {
  switch (record.kind) {
    case "shipment.create": {
      const request = record.request as RestCreateShipmentRequest;
      const r = await client.shipments.create(request);
      return {
        shipmentId: r.shipmentId,
        shipmentStatus: r.shipmentStatus,
        trackingPin: r.trackingPin,
        customerRequestId: r.customerRequestId ?? request.customerRequestId,
        price: r.shipmentPrice,
        links: linkViews(r.links),
        labelHint: "Use canadapost_shipment_label with the shipmentId to save the label to a file.",
      };
    }
    case "shipment.void": {
      const { shipmentId } = record.request as { shipmentId: string };
      await client.shipments.void(shipmentId);
      return { shipmentId, voided: true };
    }
    case "shipment.refund": {
      const { shipmentId, email } = record.request as { shipmentId: string; email: string };
      const ticket = await client.shipments.requestRefund(shipmentId, { email });
      return { shipmentId, serviceTicket: ticket };
    }
    case "manifest.transmit": {
      const links = await client.shipments.transmit(record.request as RestTransmitRequest);
      return { manifests: linkViews(links) };
    }
    case "pickup.create": {
      const r = await client.pickup.create(record.request as RestCreatePickupRequest);
      return { pickup: r };
    }
    case "pickup.cancel": {
      const { requestId } = record.request as { requestId: string };
      await client.pickup.cancel(requestId);
      return { requestId, cancelled: true };
    }
    case "return.create": {
      const r = await client.returns.createAuthorized(
        record.request as RestAuthorizedReturnRequest,
      );
      return {
        trackingPin: r.trackingPin,
        customerBarcode: r.customerBarcode,
        links: linkViews(r.links),
      };
    }
  }
}

function consumedNote(payload: ToolErrorPayload): ToolErrorPayload {
  return {
    ...payload,
    message: `${payload.message} The preview was consumed and cannot be reused; create a new preview to retry.`,
  };
}

const applyTool = defineTool({
  name: "canadapost_apply",
  title: "Apply a previewed operation",
  description:
    "Step 2 of 2. Executes exactly the operation stored under a confirmToken from a " +
    "canadapost_preview_* tool, after the user has agreed to that preview. Single use; nothing " +
    "can be changed here. The answer says whether real postage was charged.",
  annotations: {
    title: "Apply a previewed operation",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: z.strictObject({
    confirmToken: z.string().min(20).max(100).describe("The confirmToken of a preview."),
  }),
  handler: async (input, ctx): Promise<ToolResult> => {
    const consumed = ctx.previewStore.consume(input.confirmToken, ctx.now());
    if (consumed.status !== "ok") {
      return errorResult(
        businessError(`preview_${consumed.status}`, CONSUME_ERRORS[consumed.status]),
      );
    }
    const record = consumed.record;
    if (!macMatches(macContext(ctx), record)) {
      return errorResult(
        businessError(
          "preview_tampered",
          "The stored preview does not match its integrity MAC, so nothing was sent. The preview was consumed.",
        ),
      );
    }
    try {
      const result = await execute(ctx.client, record);
      ctx.logger("info", "applied", { operation: record.kind, app: ctx.config.app });
      return okResult({
        applied: true,
        operation: record.kind,
        app: ctx.config.app,
        charged: ctx.config.app === "production" && charges(record.kind),
        notice: notice(ctx, record.kind),
        ...result,
      });
    } catch (error) {
      const payload = mapErrorToPayload(error, ctx);
      const request = record.request as { customerRequestId?: string };
      return errorResult(
        consumedNote({
          ...payload,
          operation: record.kind,
          ...(request.customerRequestId === undefined
            ? {}
            : { customerRequestId: request.customerRequestId }),
        }),
      );
    }
  },
});

/** Every write tool: the previews and the single apply tool. Registered only when writes are on. */
export const WRITE_TOOLS: readonly ToolDefinition[] = [
  previewCreateShipment,
  previewVoid,
  previewRefund,
  previewTransmit,
  previewCreatePickup,
  previewCancelPickup,
  previewCreateReturn,
  applyTool,
] as unknown as readonly ToolDefinition[];
