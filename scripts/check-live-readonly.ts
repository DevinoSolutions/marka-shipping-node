// Enforces the repository rule that the live test suite is READ-ONLY and SANDBOX-ONLY.
//
// The live tests in packages/sdk/test/live/ use real Canada Post sandbox credentials; they must
// never create, void, transmit or refund anything, and they must never target production.
// This guard fails CI when a live file gains a mutating SDK call, a raw write-shaped request,
// a production environment, an ungated describe block, or when the guard itself would pass
// vacuously (no files found).
//
// The forbidden list is DERIVED, not hand-maintained: it loads packages/sdk/src/operations.ts
// and turns every `access: "write"` entry into a forbidden token. Adding a mutating operation
// to the SDK therefore extends this guard automatically (and test/operations.test.ts fails if a
// public method is missing from that table).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { OperationSpec } from "../packages/sdk/src/operations.js";

const root = resolve(import.meta.dirname, "..");
const liveDir = join(root, "packages", "sdk", "test", "live");
const operationsFile = join(root, "packages", "sdk", "src", "operations.ts");

let failures = 0;
const fail = (msg: string): void => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

// Write surfaces the SDK does not implement yet (pickup requests, authorized returns, ...).
// Listed so that the day they land, a live test that calls them is rejected immediately.
const FUTURE_WRITE_IDS = ["pickup.create", "returns.create", "returns.createAuthorized"] as const;

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

const operationsModule = (await import(pathToFileURL(operationsFile).href)) as {
  OPERATIONS?: Record<string, OperationSpec>;
};
const operations = Object.values(operationsModule.OPERATIONS ?? {});
if (operations.length === 0) {
  fail(`no operations loaded from ${relative(root, operationsFile)} — guard cannot derive rules`);
}

const writeIds = [
  ...operations.filter((op) => op.access === "write").map((op) => op.id),
  ...FUTURE_WRITE_IDS,
];
if (writeIds.length === 0) {
  fail("operation table declares no write operations — the derived guard would be empty");
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const forbidden: Array<{ re: RegExp; why: string }> = [];
for (const id of writeIds) {
  const [module, method] = id.split(".");
  if (module === undefined || method === undefined) continue;
  forbidden.push({
    re: new RegExp(`\\b${escape(module)}\\s*\\.\\s*${escape(method)}\\s*\\(`),
    why: `${id} (write)`,
  });
  forbidden.push({
    re: new RegExp(`["'\`]${escape(id)}["'\`]`),
    why: `${id} operation id (write)`,
  });
}
for (const verb of MUTATING_VERBS) {
  forbidden.push({
    re: new RegExp(`(?<![A-Za-z0-9_.])${verb}\\s*\\(`, "i"),
    why: `unqualified mutating call ${verb}(...)`,
  });
}
// Raw write-shaped traffic: every live call goes through the SDK.
forbidden.push({
  re: /["'`](POST|PUT|DELETE|PATCH)["'`]/i,
  why: "raw write-verb request (all live traffic must be reads)",
});
forbidden.push({
  re: /\/rs\/[^"'`\s]*(?:ncshipment|shipment|manifest|artifact)/i,
  why: "raw shipping endpoint path",
});
forbidden.push({
  re: /transmitShipment|createPublicKey|createQrCode/,
  why: "shipment-creation flag in a live file",
});

let files: string[] = [];
try {
  files = readdirSync(liveDir).filter((f) => f.endsWith(".ts"));
} catch {
  fail(`live test directory missing at ${liveDir} — guard cannot verify anything`);
}
if (files.length === 0 && failures === 0) {
  fail("no live test files found — guard would pass vacuously; fix the path or the suite");
}

for (const file of files) {
  const path = join(liveDir, file);
  const rel = relative(root, path).replaceAll("\\", "/");
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const isTestFile = file.endsWith(".live.test.ts");
  const isEnvFile = file === "env.ts";
  lines.forEach((line, i) => {
    // Comments are documentation, not calls; skip them so the suite can explain itself.
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    for (const { re, why } of forbidden) {
      if (re.test(code)) fail(`${rel}:${i + 1} ${why} — the live suite is read-only`);
    }
    // Every live call goes through the SDK; no raw network access.
    if (/\bfetch\s*\(/.test(code)) {
      fail(
        `${rel}:${i + 1} raw fetch() in the live suite — every live call must go through the SDK`,
      );
    }
    // The production environment is never allowed as a value outside the env refusal check.
    if (!isEnvFile && /["'`]production["'`]/.test(code)) {
      fail(`${rel}:${i + 1} mentions the production environment — the live suite is sandbox-only`);
    }
  });
  if (isTestFile && !lines.some((l) => l.includes("describe.skipIf(!liveEnabled)"))) {
    fail(`${rel} missing the describe.skipIf(!liveEnabled) gate`);
  }
  if (isEnvFile) {
    if (!/environment:\s*"development"/.test(text)) {
      fail(`${rel} must hard-code environment: "development" when building the client`);
    }
    if (!/Refusing to run the live suite/.test(text)) {
      fail(`${rel} lost its refusal to run against a non-development environment`);
    }
    if (/environment:(?!\s*"development")/.test(text.replace(/\/\/.*$/gm, ""))) {
      fail(`${rel} sets the client environment to something other than "development"`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} read-only guard check(s) failed`);
  process.exit(1);
}
console.log(
  `Live suite read-only guard passed (${files.length} file(s) scanned, ` +
    `${writeIds.length} write operation(s) blocked)`,
);
