// Enforces the repository rules for the two live suites against the Canada Post APIs.
//
// 1. packages/canada-post/test/live/ — XML sandbox, READ-ONLY and SANDBOX-ONLY. It must never
//    create, void, transmit or refund anything, never target production, and its read-only
//    gate must be present.
// 2. packages/canada-post/test/live-test-app/ and packages/canada-post-mcp/test/live-test-app/
//    — the REST/OAuth Test app (static stubs, no postage; the second is the MCP server smoke). It MAY create and void shipments, but only if every test file proves a Test
//    app with `await ...assertTestApp()` in beforeAll before its first test, and nothing in
//    the directory can name the production app credentials, the "production" app type, the
//    legacy XML client or raw network access. It may read no environment variable beyond the
//    opt-in flag and the three Test-app credentials.
//
// The forbidden lists are DERIVED, not hand-maintained: they come from
// packages/canada-post/src/operations.ts (every `access: "write"` entry), so adding a
// mutating operation to the SDK extends this guard automatically. The guard fails on a
// vacuous pass (no files found). The scanning logic lives in live-guard.ts and is unit tested
// by live-guard.test.ts.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkTestAppFileList,
  deriveRules,
  scanReadOnlyFile,
  scanTestAppFile,
  scanWorkflow,
  type GuardOperation,
} from "./live-guard.js";

const root = resolve(import.meta.dirname, "..");
const liveDir = join(root, "packages", "canada-post", "test", "live");
// Every directory of REST Test-app suites: the SDK's and the MCP server's smoke suite.
const testAppDirs = [
  join(root, "packages", "canada-post", "test", "live-test-app"),
  join(root, "packages", "canada-post-mcp", "test", "live-test-app"),
];
const workflowDir = join(root, ".github", "workflows");
const operationsFile = join(root, "packages", "canada-post", "src", "operations.ts");

let failures = 0;
const fail = (msg: string): void => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

const operationsModule = (await import(pathToFileURL(operationsFile).href)) as {
  OPERATIONS?: Record<string, GuardOperation>;
};
const operations = Object.values(operationsModule.OPERATIONS ?? {});
if (operations.length === 0) {
  fail(`no operations loaded from ${relative(root, operationsFile)} — guard cannot derive rules`);
}
const rules = deriveRules(operations);
if (rules.writeIds.length === 0) {
  fail("operation table declares no write operations — the derived guard would be empty");
}
if (rules.restWriteShapes.size === 0) {
  fail("operation table declares no REST write operations — the test-app rules would be empty");
}

function listTs(dir: string, label: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".ts"));
  } catch {
    fail(`${label} directory missing at ${dir} — guard cannot verify anything`);
    return [];
  }
}

const rel = (path: string): string => relative(root, path).replaceAll("\\", "/");

// --- 1. read-only sandbox suite ---------------------------------------------------------
const liveFiles = listTs(liveDir, "live test");
if (liveFiles.length === 0 && failures === 0) {
  fail("no live test files found — guard would pass vacuously; fix the path or the suite");
}
for (const file of liveFiles) {
  const path = join(liveDir, file);
  for (const finding of scanReadOnlyFile(rel(path), readFileSync(path, "utf8"), rules)) {
    fail(finding);
  }
}

// --- 2. REST Test-app suite -------------------------------------------------------------
let testAppFileCount = 0;
for (const testAppDir of testAppDirs) {
  const testAppFiles = listTs(testAppDir, "live test-app");
  testAppFileCount += testAppFiles.length;
  for (const finding of checkTestAppFileList(testAppFiles)) fail(`${rel(testAppDir)}: ${finding}`);
  for (const file of testAppFiles) {
    const path = join(testAppDir, file);
    for (const finding of scanTestAppFile(rel(path), readFileSync(path, "utf8"), rules)) {
      fail(finding);
    }
  }
}

// --- 3. workflows: no route to the production app credentials --------------------------
let workflows: string[] = [];
try {
  workflows = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
} catch {
  fail(`workflow directory missing at ${workflowDir}`);
}
for (const file of workflows) {
  const path = join(workflowDir, file);
  for (const finding of scanWorkflow(rel(path), readFileSync(path, "utf8"))) fail(finding);
}

if (failures > 0) {
  console.error(`\n${String(failures)} live-suite guard check(s) failed`);
  process.exit(1);
}
console.log(
  `Live suite guards passed (${String(liveFiles.length)} read-only file(s), ` +
    `${String(testAppFileCount)} test-app file(s), ${String(workflows.length)} workflow(s) scanned; ` +
    `${String(rules.writeIds.length)} write operation(s) blocked in test/live/, ` +
    `${String(rules.restWriteShapes.size)} REST write(s) allowed only in test/live-test-app/)`,
);
