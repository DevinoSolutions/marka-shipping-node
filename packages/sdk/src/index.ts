/**
 * Community TypeScript SDK for the Canada Post Developer Program REST APIs.
 * Not affiliated with or endorsed by Canada Post.
 *
 * @packageDocumentation
 */
export { createCanadaPostClient } from "./client.js";
export type { CanadaPostClient, FollowedLink } from "./client.js";

export { BASE_URLS, MEDIA_TYPES } from "./config.js";
export type {
  CanadaPostClientOptions,
  CanadaPostDebugEvent,
  CanadaPostEnvironment,
} from "./config.js";

export {
  CanadaPostApiError,
  CanadaPostConfigurationError,
  CanadaPostError,
  CanadaPostIndeterminateError,
  CanadaPostNetworkError,
  CanadaPostParseError,
  CanadaPostTimeoutError,
  CanadaPostValidationError,
} from "./errors.js";
export type { CanadaPostMessage, CanadaPostRequestInfo } from "./errors.js";

export { findLink, requireLink } from "./links.js";
export type { XmlNode } from "./xml/parse.js";
export type { CanadaPostLink } from "./links.js";

export { redactHeaders } from "./http.js";
export { saveArtifact } from "./api/artifacts.js";
export type { Artifact, GetArtifactOptions, SavedArtifact } from "./api/artifacts.js";

export type { LinkOrId } from "./api/context.js";
export type {
  AddressInput,
  AddressOutput,
  AdjustmentOutput,
  CreditCardReceiptOutput,
  CustomsInput,
  CustomsItemInput,
  DeliverySpecOutput,
  DestinationInput,
  DimensionsInput,
  NotificationInput,
  OptionOutput,
  PartyOutput,
  PreferencesInput,
  PricedOptionOutput,
  ReferencesInput,
  RefundTicketOutput,
  SenderInput,
  ServiceStandardOutput,
  ShipmentOptionInput,
} from "./api/shipping-common.js";

export type {
  DimensionRange,
  DiscoverServicesInput,
  DiscoverServicesResult,
  GetRatesInput,
  GetRatesResult,
  OptionDetails,
  PriceQuote,
  QuoteAdjustment,
  QuoteOption,
  QuoteTaxes,
  RatingApi,
  RatingDestination,
  ServiceDetails,
  ServiceOption,
  ServiceSummary,
} from "./api/rating.js";

export type {
  NcShipmentDetails,
  NcShipmentInfo,
  NcShipmentInput,
  NcShipmentList,
  NcShipmentListInput,
  NcShipmentReceipt,
  NcShipmentsApi,
} from "./api/nc-shipments.js";

export type {
  MethodOfPayment,
  ShipmentDetails,
  ShipmentGroup,
  ShipmentInfo,
  ShipmentInput,
  ShipmentList,
  ShipmentListInput,
  ShipmentPrice,
  ShipmentReceipt,
  ShipmentsApi,
  TransmitInput,
  TransmitResult,
} from "./api/shipments.js";

export type {
  Manifest,
  ManifestDetails,
  ManifestList,
  ManifestListInput,
  ManifestsApi,
} from "./api/manifests.js";

export type { ArtifactsApi } from "./api/artifacts.js";

export type {
  PinSummary,
  TrackingApi,
  TrackingDetail,
  TrackingEvent,
  TrackingQuery,
  TrackingSummary,
} from "./api/tracking.js";

export { OPERATIONS } from "./operations.js";
export type { OperationSpec } from "./operations.js";

export { SDK_VERSION } from "./version.js";
