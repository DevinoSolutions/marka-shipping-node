// Pure scanning logic of `npm run check:live-readonly` (the CLI is check-live-readonly.ts).
// Kept free of I/O so scripts/live-guard.test.ts can prove the guard catches what it claims
// to catch: a guard nobody tests is a guard that silently stops working.
import ts from "typescript";

/** One operation of packages/canada-post/src/operations.ts, as far as the guard cares. */
export interface GuardOperation {
  id: string;
  access: "read" | "write";
}

// Write surfaces the SDK does not implement yet (pickup requests, authorized returns, ...).
// Listed so that the day they land, a live test that calls them is rejected immediately.
const FUTURE_WRITE_IDS = ["pickup.create", "returns.create", "returns.createAuthorized"];

// Mutating verbs, blocked even unqualified (`await create(...)` via a local alias).
const MUTATING_VERBS = [
  "create",
  "void",
  "transmit",
  "requestRefund",
  "refund",
  "cancel",
  "update",
  "submit",
] as const;

/** The only environment variables the live test-app suite may read. */
const TEST_APP_ENV_KEYS = [
  "CANADAPOST_TEST_APP_LIVE",
  "CANADAPOST_CLIENT_ID",
  "CANADAPOST_CLIENT_SECRET",
  "CANADAPOST_CUSTOMER_NUMBER",
] as const;

interface Rule {
  re: RegExp;
  why: string;
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `namespace.method` of an operation id: the last two segments (`rest.shipments.void` -> `shipments.void`). */
function callShape(id: string): [string, string] | undefined {
  const parts = id.split(".");
  const method = parts.at(-1);
  const namespace = parts.at(-2);
  return method === undefined || namespace === undefined ? undefined : [namespace, method];
}

/** Everything derived from the operations table. */
interface GuardRules {
  /** Ids of every write (SDK table plus future surfaces). */
  writeIds: string[];
  /** `namespace.method` shapes of the REST client's writes: the only writes test-app may call. */
  restWriteShapes: Set<string>;
  /** Forbidden in the read-only `test/live/` directory. */
  readOnly: Rule[];
  /** Forbidden in `test/live-test-app/`. */
  testApp: Rule[];
}

function writeRules(ids: readonly string[], allowedShapes: ReadonlySet<string>): Rule[] {
  const rules: Rule[] = [];
  for (const id of ids) {
    const shape = callShape(id);
    if (shape === undefined) continue;
    const [namespace, method] = shape;
    if (!allowedShapes.has(`${namespace}.${method}`)) {
      rules.push({
        re: new RegExp(`\\b${escape(namespace)}\\s*\\.\\s*${escape(method)}\\s*\\(`),
        why: `${id} (write)`,
      });
    }
    // The SDK reports REST operations as `shipments.create` in debug events and errors, so the
    // allowed shapes may be quoted (in assertions) where the legacy rule would reject them.
    if (!allowedShapes.has(`${namespace}.${method}`)) {
      rules.push({
        re: new RegExp(`["'\`]${escape(id)}["'\`]`),
        why: `${id} operation id (write)`,
      });
    }
  }
  return rules;
}

const unqualifiedVerbRules: Rule[] = MUTATING_VERBS.map((verb) => ({
  re: new RegExp(`(?<![A-Za-z0-9_.])${verb}\\s*\\(`, "i"),
  why: `unqualified mutating call ${verb}(...)`,
}));

/** Builds the rule sets from the operations table. */
export function deriveRules(operations: readonly GuardOperation[]): GuardRules {
  const writes = operations.filter((op) => op.access === "write").map((op) => op.id);
  const writeIds = [...writes, ...FUTURE_WRITE_IDS];
  const restWriteShapes = new Set<string>();
  for (const id of writes) {
    if (!id.startsWith("rest.")) continue;
    const shape = callShape(id);
    if (shape !== undefined) restWriteShapes.add(shape.join("."));
  }

  const common: Rule[] = [
    ...unqualifiedVerbRules,
    // Every live call goes through the SDK: no raw write-shaped traffic.
    {
      re: /["'`](POST|PUT|DELETE|PATCH)["'`]/i,
      why: "raw write-verb request (all live traffic must go through the SDK)",
    },
    {
      re: /\/rs\/[^"'`\s]*(?:ncshipment|shipment|manifest|artifact)/i,
      why: "raw shipping endpoint path",
    },
    { re: /\bfetch\s*\(/, why: "raw fetch() (every live call must go through the SDK)" },
    {
      re: /CANADAPOST_PROD|PROD_CLIENT|\bPROD\b/,
      why: "reference to the PRODUCTION app credentials",
    },
  ];

  return {
    writeIds,
    restWriteShapes,
    readOnly: [
      ...writeRules(writeIds, new Set()),
      ...common,
      {
        re: /transmitShipment|createPublicKey|createQrCode/,
        why: "shipment-creation flag in a live file",
      },
    ],
    testApp: [
      ...writeRules(writeIds, restWriteShapes),
      ...common,
      {
        re: /production/i,
        why: "mentions production (the test-app suite must be unable to name it)",
      },
      {
        re: /soa-gw|BASE_URLS|createCanadaPostClient\b|\benvironment\s*:|["'`]development["'`]/,
        why: "references the legacy XML client or its environments",
      },
      {
        re: /\bnode:https?\b|\bhttps?\.request\b|XMLHttpRequest|\bundici\b|\bnew WebSocket\b/,
        why: "raw network access",
      },
    ],
  };
}

/**
 * Replaces every comment with blanks (newlines kept, so line numbers survive). Uses the
 * TypeScript parser, so `//` inside a string such as a URL is never mistaken for a comment
 * (which would hide whatever follows it on the line from the scan).
 */
export function stripComments(text: string): string {
  const source = ts.createSourceFile("scan.ts", text, ts.ScriptTarget.Latest, true);
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(source);
    if (children.length === 0) {
      // Leading comments start after the previous token's line; trailing ones (`x; // c`) are
      // reported separately by the parser, so both are needed.
      const found = [
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.pos) ?? []),
      ];
      for (const range of found) ranges.push([range.pos, range.end]);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(source);
  let out = "";
  let cursor = 0;
  for (const [from, to] of ranges.sort((a, b) => a[0] - b[0])) {
    out += text.slice(cursor, from) + text.slice(from, to).replace(/[^\n]/g, " ");
    cursor = to;
  }
  return out + text.slice(cursor);
}

function scanLines(name: string, code: string, rules: readonly Rule[]): string[] {
  const findings: string[] = [];
  code.split(/\r?\n/).forEach((line, i) => {
    for (const { re, why } of rules) {
      if (re.test(line)) findings.push(`${name}:${String(i + 1)} ${why}`);
    }
  });
  return findings;
}

/** Checks one file of the read-only, sandbox-only `test/live/` directory. */
export function scanReadOnlyFile(name: string, text: string, rules: GuardRules): string[] {
  const code = stripComments(text);
  const findings = scanLines(name, code, rules.readOnly).map(
    (f) => `${f} — the live suite is read-only`,
  );
  const isTestFile = name.endsWith(".live.test.ts");
  const isEnvFile = name.endsWith("env.ts");
  code.split(/\r?\n/).forEach((line, i) => {
    // The production environment is never allowed as a value outside the env refusal check.
    if (!isEnvFile && /["'`]production["'`]/.test(line)) {
      findings.push(
        `${name}:${String(i + 1)} mentions the production environment — the live suite is sandbox-only`,
      );
    }
  });
  if (isTestFile && !code.includes("describe.skipIf(!liveEnabled)")) {
    findings.push(`${name} missing the describe.skipIf(!liveEnabled) gate`);
  }
  if (isEnvFile) {
    if (!/environment:\s*"development"/.test(code)) {
      findings.push(`${name} must hard-code environment: "development" when building the client`);
    }
    if (!/Refusing to run the live suite/.test(text)) {
      findings.push(`${name} lost its refusal to run against a non-development environment`);
    }
    if (/environment:(?!\s*"development")/.test(code)) {
      findings.push(`${name} sets the client environment to something other than "development"`);
    }
  }
  return findings;
}

/** Every `process.env` use must name one of the allowed keys directly. */
function scanEnvAccess(name: string, code: string): string[] {
  const findings: string[] = [];
  const allowed = TEST_APP_ENV_KEYS.join("|");
  const direct = new RegExp(`^\\.(?:${allowed})\\b`);
  code.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(
      /process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env|loadEnvFile/g,
    )) {
      const rest = line.slice((m.index ?? 0) + m[0].length);
      if (m[0].startsWith("process") && direct.test(rest)) continue;
      findings.push(
        `${name}:${String(i + 1)} reads the environment other than ${TEST_APP_ENV_KEYS.join(", ")}`,
      );
    }
  });
  return findings;
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => {
    walk(child, visit);
  });
}

const lineOf = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** Clients are built in setup.ts only, and every `app` property is the literal "test". */
function scanClients(name: string, source: ts.SourceFile, isSetup: boolean): string[] {
  const findings: string[] = [];
  let builds = 0;
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "createCanadaPostRestClient"
    ) {
      builds += 1;
      if (!isSetup) {
        findings.push(`${name}:${String(lineOf(source, node))} builds a client; only setup.ts may`);
      }
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "app") {
      findings.push(
        `${name}:${String(lineOf(source, node))} sets app from a variable; only the literal "test" is allowed`,
      );
    }
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "app") {
      const init = node.initializer;
      if (!ts.isStringLiteral(init) || init.text !== "test") {
        findings.push(
          `${name}:${String(lineOf(source, node))} sets app to ${init.getText(source)}; only "test" is allowed`,
        );
      }
    }
  });
  if (isSetup) {
    if (builds === 0) findings.push(`${name} no longer builds the client`);
    if (!/\bapp\s*:\s*"test"/.test(source.text))
      findings.push(`${name} must hard-code app: "test"`);
    if (!/throw new Error\(/.test(source.text)) {
      findings.push(`${name} must throw when the suite is requested without credentials`);
    }
  }
  return findings;
}

const isGatedDescribe = (call: ts.CallExpression, source: ts.SourceFile): boolean =>
  ts.isCallExpression(call.expression) &&
  call.expression.expression.getText(source) === "describe.skipIf" &&
  call.expression.arguments.length === 1 &&
  call.expression.arguments[0]?.getText(source) === "!liveEnabled";

/** The gated describe's callback: a beforeAll awaiting assertTestApp() must precede every test. */
function scanGatedDescribe(
  name: string,
  source: ts.SourceFile,
  describeCall: ts.CallExpression,
): string[] {
  const callback = describeCall.arguments.find(
    (a): a is ts.ArrowFunction | ts.FunctionExpression =>
      ts.isArrowFunction(a) || ts.isFunctionExpression(a),
  );
  const where = `${name}:${String(lineOf(source, describeCall))}`;
  if (callback === undefined || !ts.isBlock(callback.body)) {
    return [`${where} describe has no callback body`];
  }
  const findings: string[] = [];
  let provenAt = -1;
  const testStarts: number[] = [];
  for (const statement of callback.body.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
      continue;
    }
    const call = statement.expression;
    const callee = call.expression.getText(source);
    if (callee === "beforeAll") {
      let proves = false;
      walk(call, (n) => {
        if (
          ts.isAwaitExpression(n) &&
          ts.isCallExpression(n.expression) &&
          /(?:^|\.)assertTestApp$/.test(n.expression.expression.getText(source))
        ) {
          proves = true;
        }
      });
      if (proves && provenAt < 0) provenAt = statement.getEnd();
    } else if (/^(?:it|test)(?:\.\w+)?$/.test(callee)) {
      testStarts.push(statement.getStart(source));
    }
  }
  if (provenAt < 0) findings.push(`${where} no beforeAll awaits assertTestApp()`);
  else if (testStarts.some((start) => start < provenAt)) {
    findings.push(`${where} a test is declared before the beforeAll that awaits assertTestApp()`);
  }
  if (testStarts.length === 0) findings.push(`${where} describe block has no tests`);
  return findings;
}

/**
 * Every top-level statement is an import, a declaration, or a describe.skipIf(!liveEnabled)
 * block; each block awaits assertTestApp() in a beforeAll that precedes its first test.
 */
function scanTestFileStructure(name: string, source: ts.SourceFile): string[] {
  const findings: string[] = [];
  let gated = 0;
  for (const statement of source.statements) {
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const call = statement.expression;
      if (isGatedDescribe(call, source)) {
        gated += 1;
        findings.push(...scanGatedDescribe(name, source, call));
      } else {
        findings.push(
          `${name}:${String(lineOf(source, statement))} top-level call outside describe.skipIf(!liveEnabled)`,
        );
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      walk(statement, (n) => {
        if (ts.isAwaitExpression(n)) {
          findings.push(
            `${name}:${String(lineOf(source, n))} top-level await runs before assertTestApp()`,
          );
        }
      });
      continue;
    }
    const allowed =
      ts.isImportDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEmptyStatement(statement);
    if (!allowed) {
      findings.push(`${name}:${String(lineOf(source, statement))} unexpected top-level statement`);
    }
  }
  if (gated === 0) findings.push(`${name} missing the describe.skipIf(!liveEnabled) gate`);
  if (!/from\s+["']\.\/setup\.js["']/.test(source.text)) {
    findings.push(`${name} must take its client from ./setup.js`);
  }
  return findings;
}

/**
 * Checks one file of `test/live-test-app/`, where shipments may be created and voided
 * because every test file proves a Test app first.
 */
export function scanTestAppFile(name: string, text: string, rules: GuardRules): string[] {
  const code = stripComments(text);
  const findings = scanLines(name, code, rules.testApp);
  findings.push(...scanEnvAccess(name, code));
  const base = name.split("/").pop() ?? name;
  const isSetup = base === "setup.ts";
  if (/from\s+["'`]node:fs(?:\/promises)?["'`]/.test(code) && !isSetup) {
    findings.push(`${name} reads files; only setup.ts may (it picks three keys out of .env)`);
  }
  const source = ts.createSourceFile(base, code, ts.ScriptTarget.Latest, true);
  findings.push(...scanClients(name, source, isSetup));
  if (base.endsWith(".live.test.ts")) findings.push(...scanTestFileStructure(name, source));
  return findings;
}

/** Vacuity and structure checks of the file list of `test/live-test-app/`. */
export function checkTestAppFileList(names: readonly string[]): string[] {
  const findings: string[] = [];
  if (!names.includes("setup.ts")) findings.push("test/live-test-app/setup.ts is missing");
  if (!names.some((n) => n.endsWith(".live.test.ts"))) {
    findings.push("no live test-app test files found — the guard would pass vacuously");
  }
  return findings;
}

/** Checks the GitHub workflows for any route to the production app credentials. */
export function scanWorkflow(name: string, text: string): string[] {
  const code = text
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*$/, ""))
    .join("\n");
  const findings: string[] = [];
  if (/CANADAPOST_PROD|PROD_CLIENT/.test(code)) {
    findings.push(`${name} references the production app credentials`);
  }
  return findings;
}
