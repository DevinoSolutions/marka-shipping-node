import { describe, expect, it } from "vitest";
import {
  assertSupportedKeywords,
  findOperation,
  loadSpec,
  SPEC_NAMES,
  validateComponent,
  validateSchema,
  type OpenApiDoc,
  type Schema,
} from "./support/openapi.js";

const empty: OpenApiDoc = {
  servers: [{ url: "https://x.test/v1" }],
  paths: {},
  components: { schemas: {} },
};
const ok = (schema: Schema, value: unknown, doc: OpenApiDoc = empty): string[] =>
  validateSchema(doc, schema, value);

describe("OpenAPI validator (the contract tests are only as good as this)", () => {
  it("checks types, including integer vs number and null", () => {
    expect(ok({ type: "string" }, "a")).toEqual([]);
    expect(ok({ type: "string" }, 1)).toHaveLength(1);
    expect(ok({ type: "integer" }, 1.5)).toHaveLength(1);
    expect(ok({ type: "number" }, 1.5)).toEqual([]);
    expect(ok({ type: "boolean" }, "true")).toHaveLength(1);
    expect(ok({ type: "string" }, null)).toHaveLength(1);
    expect(ok({ type: "string", nullable: true }, null)).toEqual([]);
    expect(ok({ type: "array" }, {})).toHaveLength(1);
    expect(ok({ type: "object" }, [])).toHaveLength(1);
  });

  it("checks required, unknown properties and nested paths", () => {
    const schema: Schema = {
      type: "object",
      required: ["a"],
      additionalProperties: false,
      properties: {
        a: { type: "string" },
        b: { type: "object", properties: { c: { type: "integer" } } },
      },
    };
    expect(ok(schema, { a: "x" })).toEqual([]);
    expect(ok(schema, {})).toEqual(['$: missing required property "a"']);
    expect(ok(schema, { a: "x", z: 1 })).toEqual(['$: unexpected property "z"']);
    expect(ok(schema, { a: "x", b: { c: "no" } })).toEqual(["$.b.c: expected integer, got string"]);
    expect(ok({ type: "object", properties: {} }, { anything: 1 })).toEqual([]);
  });

  it("checks string constraints and formats", () => {
    expect(ok({ type: "string", minLength: 2 }, "a")).toHaveLength(1);
    expect(ok({ type: "string", maxLength: 2 }, "abc")).toHaveLength(1);
    expect(ok({ type: "string", pattern: "^[A-Z]\\d$" }, "A1")).toEqual([]);
    expect(ok({ type: "string", pattern: "^[A-Z]\\d$" }, "a1")).toHaveLength(1);
    expect(ok({ type: "string", format: "date" }, "2026-11-15")).toEqual([]);
    expect(ok({ type: "string", format: "date" }, "2026-02-31")).toHaveLength(1);
    expect(ok({ type: "string", format: "date" }, "20261115")).toHaveLength(1);
    expect(ok({ type: "string", format: "date-time" }, "2026-11-15T10:00:00Z")).toEqual([]);
    expect(ok({ type: "string", format: "date-time" }, "yesterday")).toHaveLength(1);
    expect(ok({ type: "string", format: "email" }, "a@b.co")).toEqual([]);
    expect(ok({ type: "string", format: "email" }, "nope")).toHaveLength(1);
    expect(ok({ type: "string", enum: ["a", "b"] }, "c")).toHaveLength(1);
  });

  it("checks numeric bounds, OpenAPI 3.0 exclusive bounds and multipleOf", () => {
    expect(ok({ type: "number", minimum: 0, exclusiveMinimum: true }, 0)).toHaveLength(1);
    expect(ok({ type: "number", minimum: 0, exclusiveMinimum: true }, 0.001)).toEqual([]);
    expect(ok({ type: "number", minimum: 0 }, 0)).toEqual([]);
    expect(ok({ type: "number", maximum: 5 }, 5.1)).toHaveLength(1);
    expect(ok({ type: "number", multipleOf: 0.001 }, 17.3)).toEqual([]);
    expect(ok({ type: "number", multipleOf: 0.001 }, 0.4005)).toHaveLength(1);
    expect(ok({ type: "number", multipleOf: 0.01 }, 13.48)).toEqual([]);
  });

  it("checks arrays", () => {
    const schema: Schema = { type: "array", minItems: 1, maxItems: 2, items: { type: "integer" } };
    expect(ok(schema, [])).toHaveLength(1);
    expect(ok(schema, [1, 2, 3])).toHaveLength(1);
    expect(ok(schema, [1, "x"])).toEqual(["$[1]: expected integer, got string"]);
    expect(ok(schema, [1])).toEqual([]);
  });

  it("handles allOf, anyOf, oneOf, not and $ref", () => {
    const doc: OpenApiDoc = {
      ...empty,
      components: { schemas: { Id: { type: "string", maxLength: 3 } } },
    };
    expect(
      ok({ allOf: [{ $ref: "#/components/schemas/Id" }, { minLength: 2 }] }, "ab", doc),
    ).toEqual([]);
    expect(
      ok({ allOf: [{ $ref: "#/components/schemas/Id" }, { minLength: 2 }] }, "a", doc),
    ).toHaveLength(1);
    expect(ok({ anyOf: [{ type: "string" }, { type: "integer" }] }, true)).toHaveLength(1);
    expect(ok({ anyOf: [{ type: "string" }, { type: "integer" }] }, 1)).toEqual([]);
    expect(ok({ oneOf: [{ type: "number" }, { type: "integer" }] }, 1)).toHaveLength(1);
    expect(ok({ not: { required: ["a"] } }, { a: 1 })).toHaveLength(1);
    expect(ok({ not: { required: ["a"] } }, { b: 1 })).toEqual([]);
    expect(validateComponent(doc, "Id", "abcd")).toHaveLength(1);
    expect(() => ok({ $ref: "#/components/schemas/Nope" }, 1, doc)).toThrow(/unresolvable/);
  });

  it("refuses to pass silently on a keyword it does not implement", () => {
    expect(() => ok({ type: "string", uniqueItems: true } as Schema, "a")).toThrow(
      /unsupported keyword/,
    );
    expect(() => ok({ type: "string", format: "uuid" }, "a")).toThrow(/unsupported format/);
    expect(() => ok({ type: "weird" }, "a")).toThrow(/unsupported type/);
    const bad: OpenApiDoc = { ...empty, components: { schemas: { X: { patternProperties: {} } } } };
    expect(() => assertSupportedKeywords(bad)).toThrow(/patternProperties/);
  });
});

describe.each(SPEC_NAMES)("%s document", (name) => {
  const doc = loadSpec(name);

  it("only uses keywords the validator implements", () => {
    expect(() => assertSupportedKeywords(doc)).not.toThrow();
  });

  it("has operations the matcher can find by method and URL", () => {
    const server = doc.servers[0]?.url ?? "";
    expect(server).toMatch(
      /^https:\/\/api\.canadapost-postescanada\.ca\/prod\/devportal-portaildesdeveloppeurs\//,
    );
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const method of Object.keys(ops)) {
        const url = `${server}${path.replace(/\{[^}]+\}/g, "x1")}`;
        const match = findOperation(doc, method, url);
        expect(match?.path, `${method} ${path}`).toBe(path);
      }
    }
    expect(findOperation(doc, "GET", "https://evil.test/anything")).toBeUndefined();
    expect(findOperation(doc, "PATCH", `${server}/nothing/here`)).toBeUndefined();
  });

  it("accepts its own request body examples (validator and spec agree)", () => {
    let checked = 0;
    let withBody = 0;
    for (const ops of Object.values(doc.paths)) {
      for (const op of Object.values(ops)) {
        const content = op.requestBody?.content?.["application/json"] as
          | { schema?: Schema; examples?: Record<string, { value?: unknown }>; example?: unknown }
          | undefined;
        if (content?.schema === undefined) continue;
        withBody += 1;
        const examples = [
          ...Object.values(content.examples ?? {}).map((e) => e.value),
          ...(content.example === undefined ? [] : [content.example]),
        ];
        for (const example of examples) {
          expect(validateSchema(doc, content.schema, example), `${op.operationId ?? "?"}`).toEqual(
            [],
          );
          checked += 1;
        }
      }
    }
    // Read-only documents (customer information, post offices, service information) have no
    // request bodies; every other document must have at least one example to check.
    if (withBody > 0) expect(checked).toBeGreaterThan(0);
  });
});
