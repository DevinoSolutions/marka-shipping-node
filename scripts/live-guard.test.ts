// Self-tests of the live-suite guard (scripts/live-guard.ts). The guard protects the real
// accounts, so it must be proven to reject what it claims to reject and to accept the
// patterns the suites legitimately use.
import { describe, expect, it } from "vitest";
import {
  checkTestAppFileList,
  deriveRules,
  scanReadOnlyFile,
  scanTestAppFile,
  scanWorkflow,
  stripComments,
  type GuardOperation,
} from "./live-guard.js";

const OPS: GuardOperation[] = [
  { id: "rating.getRates", access: "read" },
  { id: "shipments.create", access: "write" },
  { id: "shipments.void", access: "write" },
  { id: "shipments.transmit", access: "write" },
  { id: "shipments.requestRefund", access: "write" },
  { id: "ncShipments.create", access: "write" },
  { id: "ncShipments.requestRefund", access: "write" },
  { id: "rest.rating.getPrices", access: "read" },
  { id: "rest.shipments.get", access: "read" },
  { id: "rest.shipments.create", access: "write" },
  { id: "rest.shipments.void", access: "write" },
];
const rules = deriveRules(OPS);

const GOOD_TEST = `
import { beforeAll, describe, expect, it } from "vitest";
import { liveEnabled, testAppClient } from "./setup.js";

describe.skipIf(!liveEnabled)("suite", () => {
  beforeAll(async () => {
    await testAppClient().assertTestApp();
  });

  it("creates", async () => {
    const created = await testAppClient().shipments.create({} as never);
    await testAppClient().shipments.void(created.links[0]!);
    expect(created).toBeDefined();
  });
});
`;

const GOOD_SETUP = `
import { existsSync, readFileSync } from "node:fs";
import { createCanadaPostRestClient } from "../../src/index.js";

const id = process.env.CANADAPOST_CLIENT_ID ?? "";
const requested = process.env.CANADAPOST_TEST_APP_LIVE === "true";
if (requested && id === "") throw new Error("credentials missing");
export const liveEnabled = requested;
export function testAppClient() {
  return createCanadaPostRestClient({ clientId: id, clientSecret: "x", customerNumber: "1", app: "test" });
}
`;

const testApp = (text: string, name = "d/live-test-app/x.live.test.ts"): string[] =>
  scanTestAppFile(name, text, rules);
const readOnly = (text: string, name = "d/live/x.live.test.ts"): string[] =>
  scanReadOnlyFile(name, text, rules);
const mentions = (findings: string[], needle: string | RegExp): boolean =>
  findings.some((f) => (typeof needle === "string" ? f.includes(needle) : needle.test(f)));

describe("rule derivation", () => {
  it("collects every write, the future surfaces, and the REST write shapes", () => {
    expect(rules.writeIds).toEqual(
      expect.arrayContaining([
        "shipments.create",
        "rest.shipments.void",
        "pickup.create",
        "returns.createAuthorized",
      ]),
    );
    expect([...rules.restWriteShapes].sort()).toEqual(["shipments.create", "shipments.void"]);
  });
});

describe("stripComments", () => {
  it("blanks comments but keeps line numbers, and ignores // inside strings", () => {
    const text = 'const u = "https://x.test"; // c1\n/* c2\n c3 */ const v = 1;\n';
    const out = stripComments(text);
    expect(out.split("\n")).toHaveLength(text.split("\n").length);
    expect(out).toContain('"https://x.test"');
    expect(out).not.toContain("c1");
    expect(out).not.toContain("c3");
    expect(out).toContain("const v = 1;");
  });
});

describe("read-only suite (test/live/)", () => {
  const gate = 'describe.skipIf(!liveEnabled)("x", () => { it("reads", () => {}); });\n';

  it("accepts reads", () => {
    expect(readOnly(`${gate}await client.rating.getRates({});`)).toEqual([]);
  });

  it.each([
    "client.shipments.create({})",
    "client.shipments.void(id)",
    "client.shipments.transmit({})",
    "client.ncShipments.create({})",
    "client.shipments.requestRefund(id)",
    "client.rest.shipments.create({})",
    "client.pickup.create({})",
    'run("shipments.create")',
    "await create(x)",
    "void(x)",
    'fetch("https://x")',
    'request("POST")',
    'x = "/rs/1/1/shipment"',
    "{ transmitShipment: true }",
    'const e = "production"',
    "process.env.CANADAPOST_PROD_CLIENT_SECRET",
    "const PROD_CLIENT_ID = 1",
  ])("rejects %s", (code) => {
    expect(readOnly(`${gate}${code};\n`).length).toBeGreaterThan(0);
  });

  it("is not fooled by a // inside a string hiding a write after it", () => {
    expect(
      readOnly(`${gate}const u = "https://x.test"; client.shipments.create({});\n`),
    ).not.toEqual([]);
  });

  it("ignores forbidden words in comments", () => {
    expect(
      readOnly(`${gate}// client.shipments.create({}) is forbidden\n/* production */\n`),
    ).toEqual([]);
  });

  it("requires the gate in test files", () => {
    expect(mentions(readOnly("it('x', () => {});\n"), "skipIf")).toBe(true);
  });

  it("keeps the env.ts refusal and hard-coded development environment", () => {
    const env = `
      // Refusing to run the live suite
      throw new Error("Refusing to run the live suite");
      createCanadaPostClient({ environment: "development" });
    `;
    expect(readOnly(env, "d/live/env.ts")).toEqual([]);
    expect(readOnly(env.replace('"development"', "env"), "d/live/env.ts").length).toBeGreaterThan(
      0,
    );
    expect(mentions(readOnly("export const x = 1;", "d/live/env.ts"), "environment")).toBe(true);
  });
});

describe("test-app suite (test/live-test-app/)", () => {
  it("accepts the legitimate pattern: create and void after assertTestApp in beforeAll", () => {
    expect(testApp(GOOD_TEST)).toEqual([]);
  });

  it("accepts the setup module", () => {
    expect(testApp(GOOD_SETUP, "d/live-test-app/setup.ts")).toEqual([]);
  });

  it("allows the REST writes but still blocks every other write", () => {
    const body = (call: string): string =>
      GOOD_TEST.replace("expect(created).toBeDefined();", `${call};`);
    expect(testApp(body("client.shipments.create({})"))).toEqual([]);
    expect(testApp(body("client.shipments.void(x)"))).toEqual([]);
    for (const call of [
      "client.ncShipments.create({})",
      "client.ncShipments.requestRefund(x)",
      "client.shipments.transmit({})",
      "client.shipments.requestRefund(x)",
      "client.pickup.create({})",
      "await create(x)",
    ]) {
      expect(testApp(body(call)), call).not.toEqual([]);
    }
  });

  it("lets assertions quote the SDK's operation names for REST writes", () => {
    expect(
      testApp(
        GOOD_TEST.replace(
          "expect(created)",
          'expect(e.operation).toBe("shipments.void"); expect(created)',
        ),
      ),
    ).toEqual([]);
  });

  describe("the Test-app proof", () => {
    it("fails without a beforeAll", () => {
      const text = GOOD_TEST.replace(/beforeAll\(async[\s\S]*?\}\);\n\n/, "");
      expect(mentions(testApp(text), "no beforeAll awaits assertTestApp")).toBe(true);
    });

    it("fails when beforeAll does not call assertTestApp", () => {
      const text = GOOD_TEST.replace(
        "await testAppClient().assertTestApp();",
        "await testAppClient();",
      );
      expect(mentions(testApp(text), "no beforeAll awaits assertTestApp")).toBe(true);
    });

    it("fails when assertTestApp is not awaited", () => {
      const text = GOOD_TEST.replace(
        "await testAppClient().assertTestApp();",
        "void testAppClient().assertTestApp();",
      );
      expect(testApp(text)).not.toEqual([]);
    });

    it("fails when assertTestApp is only mentioned in a comment", () => {
      const text = GOOD_TEST.replace(
        "await testAppClient().assertTestApp();",
        "// await testAppClient().assertTestApp();",
      );
      expect(mentions(testApp(text), "no beforeAll awaits assertTestApp")).toBe(true);
    });

    it("fails when assertTestApp is called in a test instead of beforeAll", () => {
      const text = GOOD_TEST.replace("await testAppClient().assertTestApp();", "").replace(
        'it("creates", async () => {',
        'it("creates", async () => {\n    await testAppClient().assertTestApp();',
      );
      expect(mentions(testApp(text), "no beforeAll awaits assertTestApp")).toBe(true);
    });

    it("fails when a test is declared before the beforeAll", () => {
      const text = GOOD_TEST.replace(
        "  beforeAll(",
        '  it("early", async () => {});\n  beforeAll(',
      );
      expect(mentions(testApp(text), "before the beforeAll")).toBe(true);
    });

    it("fails on an ungated describe or a second ungated block", () => {
      expect(
        mentions(
          testApp(GOOD_TEST.replace("describe.skipIf(!liveEnabled)", "describe")),
          "outside describe.skipIf",
        ),
      ).toBe(true);
      expect(
        mentions(
          testApp(
            `${GOOD_TEST}\ndescribe("extra", () => { it("w", async () => { await c.shipments.create({}); }); });\n`,
          ),
          "outside describe.skipIf",
        ),
      ).toBe(true);
    });

    it("fails on a top-level call or await that would run before the proof", () => {
      expect(testApp(`${GOOD_TEST}\nawait c.shipments.create({});\n`)).not.toEqual([]);
      expect(
        testApp(`${GOOD_TEST}\nconst made = await testAppClient().shipments.create({});\n`),
      ).not.toEqual([]);
      expect(testApp(`${GOOD_TEST}\ntestAppClient().shipments.create({});\n`)).not.toEqual([]);
    });

    it("fails on a describe without tests and on a missing setup import", () => {
      expect(
        mentions(testApp(GOOD_TEST.replace(/  it\("creates"[\s\S]*?\n  \}\);\n/, "")), "no tests"),
      ).toBe(true);
      expect(
        mentions(testApp(GOOD_TEST.replace("./setup.js", "./elsewhere.js")), "./setup.js"),
      ).toBe(true);
    });
  });

  describe("the production app is unreachable", () => {
    it.each([
      'const app = "production";',
      "const k = process.env.CANADAPOST_PROD_CLIENT_ID;",
      "const PROD_CLIENT_SECRET = 1;",
      "const x = PRODUCTION_URL;",
      'const u = "https://soa-gw.canadapost.ca";',
      'import { BASE_URLS } from "../../src/index.js";',
      'import { createCanadaPostClient } from "../../src/index.js";',
      'const c = { environment: "development" };',
      'fetch("https://x")',
      'import { request } from "node:https";',
      'const m = "POST";',
    ])("rejects %s", (code) => {
      expect(testApp(GOOD_TEST + code + "\n"), code).not.toEqual([]);
    });

    it("rejects the production word wherever it is in code, but not in comments", () => {
      expect(testApp(`${GOOD_TEST}\nconst a = "Production";\n`)).not.toEqual([]);
      expect(testApp(`${GOOD_TEST}\n// never production\n/* PROD */\n`)).toEqual([]);
    });

    it("rejects a client built outside setup.ts or with another app type", () => {
      const build = 'createCanadaPostRestClient({ app: "test" });\n';
      expect(mentions(testApp(`${GOOD_TEST}\nconst c = ${build}`), "builds a client")).toBe(true);
      for (const app of ['"production"', "someVariable", '"Test"']) {
        const setup = GOOD_SETUP.replace('app: "test"', `app: ${app}`);
        expect(testApp(setup, "d/live-test-app/setup.ts"), app).not.toEqual([]);
      }
      expect(
        testApp(GOOD_SETUP.replace('app: "test"', "app"), "d/live-test-app/setup.ts"),
      ).not.toEqual([]);
      expect(
        testApp(GOOD_SETUP.replace(', app: "test"', ""), "d/live-test-app/setup.ts"),
      ).not.toEqual([]);
    });

    it("does not mistake prose that contains 'app:' for the app option", () => {
      expect(testApp(GOOD_TEST.replace('"suite"', '"Canada Post Test app: auth"'))).toEqual([]);
    });

    it("requires setup.ts to throw when the suite is requested without credentials", () => {
      expect(
        testApp(GOOD_SETUP.replace(/throw new Error\([^)]*\);/, ""), "d/live-test-app/setup.ts"),
      ).not.toEqual([]);
    });
  });

  describe("environment access", () => {
    it("allows exactly the opt-in flag and the three Test-app credentials", () => {
      for (const key of [
        "CANADAPOST_TEST_APP_LIVE",
        "CANADAPOST_CLIENT_ID",
        "CANADAPOST_CLIENT_SECRET",
        "CANADAPOST_CUSTOMER_NUMBER",
      ]) {
        expect(testApp(`${GOOD_TEST}\nconst a = process.env.${key};\n`), key).toEqual([]);
      }
    });

    it.each([
      "const a = process.env.HOME;",
      "const a = process.env.CANADAPOST_USERNAME;",
      "const a = process.env.CANADAPOST_CLIENT_ID_OTHER;",
      'const a = process.env["CANADAPOST_PROD_CLIENT_ID"];',
      "const a = { ...process.env };",
      "const a = Object.keys(process.env);",
      "process.loadEnvFile('.env');",
      "const a = import.meta.env;",
    ])("rejects %s", (code) => {
      expect(testApp(`${GOOD_TEST}\n${code}\n`), code).not.toEqual([]);
    });

    it("only setup.ts may read files", () => {
      const text = `${GOOD_TEST}\nimport { readFileSync } from "node:fs";\n`;
      expect(mentions(testApp(text), "only setup.ts may")).toBe(true);
      expect(mentions(testApp(GOOD_SETUP, "d/live-test-app/setup.ts"), "only setup.ts may")).toBe(
        false,
      );
    });
  });
});

describe("test-app file list (vacuity)", () => {
  it("fails with no test files or no setup", () => {
    expect(checkTestAppFileList([])).toHaveLength(2);
    expect(checkTestAppFileList(["setup.ts"])).toHaveLength(1);
    expect(checkTestAppFileList(["a.live.test.ts"])).toHaveLength(1);
    expect(checkTestAppFileList(["setup.ts", "a.live.test.ts"])).toEqual([]);
  });
});

describe("workflows", () => {
  it("rejects any reference to the production app credentials, even indirectly", () => {
    expect(
      scanWorkflow("w.yml", "env:\n  A: ${{ secrets.CANADAPOST_PROD_CLIENT_ID }}\n"),
    ).not.toEqual([]);
    expect(
      scanWorkflow("w.yml", "env:\n  A: ${{ secrets.CANADAPOST_PROD_CLIENT_SECRET }}\n"),
    ).not.toEqual([]);
    expect(scanWorkflow("w.yml", "env:\n  A: ${{ secrets.PROD_CLIENT_SECRET }}\n")).not.toEqual([]);
  });

  it("accepts the Test-app secrets and comments", () => {
    expect(
      scanWorkflow(
        "w.yml",
        "# never CANADAPOST_PROD_CLIENT_ID here\nenv:\n  A: ${{ secrets.CANADAPOST_CLIENT_ID }}\n",
      ),
    ).toEqual([]);
  });
});
