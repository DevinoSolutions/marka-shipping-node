// A small, STRICT validator for the OpenAPI 3.0 documents in docs/research/openapi/.
//
// It exists so the contract tests (mocked) and the live test-app suite can check real
// requests and responses against Canada Post's own schemas without a runtime dependency.
// Strictness is the point: a keyword this validator does not understand throws instead of
// silently passing, so a spec update can never turn the contract tests into a no-op.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type Schema = Record<string, unknown>;

interface ResponseObject {
  $ref?: string;
  content?: Record<string, { schema?: Schema }>;
}

export interface OperationObject {
  operationId?: string;
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, ResponseObject>;
}

export interface OpenApiDoc {
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, OperationObject>>;
  components: {
    schemas: Record<string, Schema>;
    responses?: Record<string, ResponseObject>;
  };
}

export type SpecName =
  | "shipping-v1"
  | "rating-v1"
  | "tracking-v1"
  | "customerinfo-v1"
  | "returns-v1"
  | "pickup-v1"
  | "postoffice-v1"
  | "serviceinfo-v1";

/** Every committed OpenAPI document. */
export const SPEC_NAMES: readonly SpecName[] = [
  "shipping-v1",
  "rating-v1",
  "tracking-v1",
  "customerinfo-v1",
  "returns-v1",
  "pickup-v1",
  "postoffice-v1",
  "serviceinfo-v1",
];

const specDir = resolve(import.meta.dirname, "..", "..", "..", "..", "docs", "research", "openapi");
const cache = new Map<SpecName, OpenApiDoc>();

/**
 * KNOWN VENDOR BUG (Post Office v1, observed 2026-11-16): the officeId and opening-hours
 * patterns are double-escaped (two backslashes before the d), so as written they only match a
 * literal backslash. The validator repairs them in memory; the committed document stays
 * verbatim, and rest-services.test.ts fails when Canada Post fixes the document so that this
 * repair can be removed.
 */
function fixDoubleEscapedPatterns(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(fixDoubleEscapedPatterns);
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === "pattern" && typeof value === "string") {
        record[key] = value.replaceAll("\\\\", "\\");
      } else {
        fixDoubleEscapedPatterns(value);
      }
    }
  }
}

/** Loads (and caches) one of the committed OpenAPI documents. */
export function loadSpec(name: SpecName): OpenApiDoc {
  let doc = cache.get(name);
  if (doc === undefined) {
    doc = JSON.parse(readFileSync(join(specDir, `${name}.json`), "utf8")) as OpenApiDoc;
    if (name === "postoffice-v1") fixDoubleEscapedPatterns(doc);
    cache.set(name, doc);
  }
  return doc;
}

// Keywords that constrain a value, and keywords that are only documentation.
const CONSTRAINT_KEYWORDS = new Set([
  "$ref",
  "type",
  "nullable",
  "enum",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "format",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
]);
const METADATA_KEYWORDS = new Set([
  "description",
  "example",
  "examples",
  "default",
  "title",
  "deprecated",
  "readOnly",
  "writeOnly",
  "externalDocs",
]);
const KNOWN_FORMATS = new Set(["date", "date-time", "email", "binary", "uri"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRef(doc: OpenApiDoc, ref: string): Schema {
  if (!ref.startsWith("#/")) throw new Error(`unresolvable $ref ${ref}`);
  let target: unknown = doc;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    target = isRecord(target) ? target[key] : undefined;
  }
  if (!isRecord(target)) throw new Error(`unresolvable $ref ${ref}`);
  return target;
}

/** Throws if any schema in the document uses a keyword the validator does not implement. */
export function assertSupportedKeywords(doc: OpenApiDoc): void {
  const problems: string[] = [];
  const visit = (schema: unknown, path: string): void => {
    if (!isRecord(schema)) return;
    for (const [key, value] of Object.entries(schema)) {
      if (!CONSTRAINT_KEYWORDS.has(key) && !METADATA_KEYWORDS.has(key) && !key.startsWith("x-")) {
        problems.push(`${path}: unsupported keyword "${key}"`);
      }
      if (key === "format" && typeof value === "string" && !KNOWN_FORMATS.has(value)) {
        problems.push(`${path}: unsupported format "${value}"`);
      }
      if (key === "exclusiveMinimum" || key === "exclusiveMaximum") {
        if (typeof value !== "boolean") problems.push(`${path}: ${key} must be boolean (3.0)`);
      }
    }
    for (const key of ["properties"] as const) {
      const props = schema[key];
      if (isRecord(props)) for (const [k, v] of Object.entries(props)) visit(v, `${path}.${k}`);
    }
    if (isRecord(schema["items"])) visit(schema["items"], `${path}[]`);
    if (isRecord(schema["additionalProperties"])) {
      visit(schema["additionalProperties"], `${path}.*`);
    }
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      const list = schema[key];
      if (Array.isArray(list)) list.forEach((v, i) => visit(v, `${path}.${key}[${String(i)}]`));
    }
    if (isRecord(schema["not"])) visit(schema["not"], `${path}.not`);
  };
  for (const [name, schema] of Object.entries(doc.components.schemas)) visit(schema, name);
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

function typeOk(type: string, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    default:
      throw new Error(`unsupported type "${type}"`);
  }
}

function formatOk(format: string, value: string): boolean {
  switch (format) {
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const d = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
    }
    case "date-time":
      return (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
        !Number.isNaN(Date.parse(value))
      );
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "binary":
      return true;
    case "uri":
      return URL.canParse(value);
    default:
      throw new Error(`unsupported format "${format}"`);
  }
}

function check(doc: OpenApiDoc, schema: Schema, value: unknown, path: string): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(schema)) {
    if (!CONSTRAINT_KEYWORDS.has(key) && !METADATA_KEYWORDS.has(key) && !key.startsWith("x-")) {
      throw new Error(`unsupported keyword "${key}" at ${path}`);
    }
  }
  const ref = schema["$ref"];
  if (typeof ref === "string") return check(doc, resolveRef(doc, ref), value, path);
  if (value === null && schema["nullable"] === true) return errors;

  const type = schema["type"];
  if (typeof type === "string" && !typeOk(type, value)) {
    errors.push(`${path}: expected ${type}, got ${describe(value)}`);
    return errors; // further keyword checks would only add noise
  }

  const enumValues = schema["enum"];
  if (Array.isArray(enumValues) && !enumValues.some((e) => e === value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(enumValues)}`);
  }

  if (typeof value === "string") {
    const minLength = schema["minLength"];
    const maxLength = schema["maxLength"];
    const pattern = schema["pattern"];
    const format = schema["format"];
    if (typeof minLength === "number" && value.length < minLength) {
      errors.push(`${path}: shorter than ${String(minLength)} characters`);
    }
    if (typeof maxLength === "number" && value.length > maxLength) {
      errors.push(`${path}: longer than ${String(maxLength)} characters`);
    }
    if (typeof pattern === "string" && !new RegExp(pattern).test(value)) {
      errors.push(`${path}: does not match /${pattern}/`);
    }
    if (typeof format === "string" && !formatOk(format, value)) {
      errors.push(`${path}: not a valid ${format}`);
    }
  }

  if (typeof value === "number") {
    const minimum = schema["minimum"];
    const maximum = schema["maximum"];
    const multipleOf = schema["multipleOf"];
    if (typeof minimum === "number") {
      const exclusive = schema["exclusiveMinimum"] === true;
      if (exclusive ? value <= minimum : value < minimum) {
        errors.push(
          `${path}: ${String(value)} is below ${exclusive ? "or at " : ""}${String(minimum)}`,
        );
      }
    }
    if (typeof maximum === "number") {
      const exclusive = schema["exclusiveMaximum"] === true;
      if (exclusive ? value >= maximum : value > maximum) {
        errors.push(
          `${path}: ${String(value)} is above ${exclusive ? "or at " : ""}${String(maximum)}`,
        );
      }
    }
    if (typeof multipleOf === "number") {
      const q = value / multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-6) {
        errors.push(`${path}: ${String(value)} is not a multiple of ${String(multipleOf)}`);
      }
    }
  }

  if (Array.isArray(value)) {
    const minItems = schema["minItems"];
    const maxItems = schema["maxItems"];
    const items = schema["items"];
    if (typeof minItems === "number" && value.length < minItems) {
      errors.push(`${path}: fewer than ${String(minItems)} items`);
    }
    if (typeof maxItems === "number" && value.length > maxItems) {
      errors.push(`${path}: more than ${String(maxItems)} items`);
    }
    if (isRecord(items)) {
      value.forEach((v, i) => errors.push(...check(doc, items, v, `${path}[${String(i)}]`)));
    }
  }

  if (isRecord(value)) {
    const properties = schema["properties"];
    const required = schema["required"];
    const additional = schema["additionalProperties"];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === "string" && !(name in value)) {
          errors.push(`${path}: missing required property "${name}"`);
        }
      }
    }
    const known = isRecord(properties) ? properties : {};
    for (const [name, v] of Object.entries(value)) {
      const propSchema = known[name];
      if (isRecord(propSchema)) {
        errors.push(...check(doc, propSchema, v, `${path}.${name}`));
      } else if (additional === false) {
        errors.push(`${path}: unexpected property "${name}"`);
      } else if (isRecord(additional)) {
        errors.push(...check(doc, additional, v, `${path}.${name}`));
      }
    }
  }

  const allOf = schema["allOf"];
  if (Array.isArray(allOf)) {
    for (const sub of allOf) if (isRecord(sub)) errors.push(...check(doc, sub, value, path));
  }
  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) {
    const branches = anyOf.filter(isRecord).map((sub) => check(doc, sub, value, path));
    if (!branches.some((b) => b.length === 0)) {
      errors.push(`${path}: matches none of the anyOf branches (${branches.flat().join("; ")})`);
    }
  }
  const oneOf = schema["oneOf"];
  if (Array.isArray(oneOf)) {
    const matches = oneOf
      .filter(isRecord)
      .filter((sub) => check(doc, sub, value, path).length === 0);
    if (matches.length !== 1) {
      errors.push(`${path}: matches ${String(matches.length)} oneOf branches, expected exactly 1`);
    }
  }
  const not = schema["not"];
  if (isRecord(not) && check(doc, not, value, path).length === 0) {
    errors.push(`${path}: matches a schema it must not match`);
  }
  return errors;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Validation errors (empty when valid) of `value` against a schema object. */
export function validateSchema(doc: OpenApiDoc, schema: Schema, value: unknown): string[] {
  return check(doc, schema, value, "$");
}

/** Validation errors of `value` against `#/components/schemas/{name}`. */
export function validateComponent(doc: OpenApiDoc, name: string, value: unknown): string[] {
  return validateSchema(doc, { $ref: `#/components/schemas/${name}` }, value);
}

export interface MatchedOperation {
  path: string;
  method: string;
  operation: OperationObject;
  params: Record<string, string>;
}

/**
 * Finds the documented operation for a request: `url` must be on the spec's server and
 * `method` must be documented for the matching path template. Returns undefined otherwise,
 * which is how the contract tests prove the SDK only calls documented endpoints.
 */
export function findOperation(
  doc: OpenApiDoc,
  method: string,
  url: string,
): MatchedOperation | undefined {
  const server = doc.servers[0]?.url;
  if (server === undefined) throw new Error("spec has no server");
  const parsed = new URL(url);
  const full = `${parsed.origin}${parsed.pathname}`;
  if (!full.startsWith(`${server}/`)) return undefined;
  const rest = full.slice(server.length);
  for (const [template, ops] of Object.entries(doc.paths)) {
    const names: string[] = [];
    const re = new RegExp(
      `^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{([^}]+)\}/g, (_m, n: string) => {
        names.push(n);
        return "([^/]+)";
      })}$`,
    );
    const m = re.exec(rest);
    const operation = ops[method.toLowerCase()];
    if (m !== null && operation !== undefined) {
      const params: Record<string, string> = {};
      names.forEach((n, i) => {
        params[n] = decodeURIComponent(m[i + 1] ?? "");
      });
      return { path: template, method: method.toUpperCase(), operation, params };
    }
  }
  return undefined;
}

/** Schema of the JSON request body of an operation. */
export function requestSchema(op: OperationObject): Schema {
  const schema = op.requestBody?.content?.["application/json"]?.schema;
  if (schema === undefined)
    throw new Error(`${op.operationId ?? "operation"} has no JSON request body`);
  return schema;
}

/** Schema of the JSON response of an operation for a status code. */
export function responseSchema(doc: OpenApiDoc, op: OperationObject, status: number): Schema {
  let response = op.responses?.[String(status)];
  if (response === undefined) {
    throw new Error(`${op.operationId ?? "operation"} documents no ${String(status)} response`);
  }
  if (response.$ref !== undefined) {
    const name = response.$ref.split("/").pop() ?? "";
    response = doc.components.responses?.[name];
  }
  const schema = response?.content?.["application/json"]?.schema;
  if (schema === undefined) {
    throw new Error(`${op.operationId ?? "operation"} ${String(status)} has no JSON schema`);
  }
  return schema;
}

/** Finds an operation by its `operationId`. */
export function operationById(doc: OpenApiDoc, operationId: string): OperationObject {
  for (const ops of Object.values(doc.paths)) {
    for (const op of Object.values(ops)) if (op.operationId === operationId) return op;
  }
  throw new Error(`no operation with operationId "${operationId}"`);
}

/** Validation errors of a response body against the documented schema of an operation. */
export function validateResponse(
  doc: OpenApiDoc,
  operationId: string,
  status: number,
  body: unknown,
): string[] {
  return validateSchema(doc, responseSchema(doc, operationById(doc, operationId), status), body);
}

/** Validation errors of a request body against the documented schema of an operation. */
export function validateRequest(doc: OpenApiDoc, operationId: string, body: unknown): string[] {
  return validateSchema(doc, requestSchema(operationById(doc, operationId)), body);
}

/** Whether an operation documents a status code at all. */
export function documentsStatus(op: OperationObject, status: number): boolean {
  return op.responses?.[String(status)] !== undefined;
}

/** Throws one readable error when a request/response breaks the contract. */
export function expectValid(label: string, errors: string[]): void {
  if (errors.length > 0) {
    throw new Error(`${label} breaks the OpenAPI contract:\n  - ${errors.join("\n  - ")}`);
  }
}
