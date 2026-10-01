import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

interface VsceApi {
  listFiles(options: { cwd: string }): Promise<string[]>;
}

const loadPackage = createRequire(__filename);
const vsce = loadPackage("@vscode/vsce") as VsceApi;

void test("VSIX package input includes the external helper and adjacent release schema", async () => {
  const packageRoot = path.resolve(__dirname, "../..");
  const files = await vsce.listFiles({ cwd: packageRoot });

  assert.ok(files.includes("out/open-packs.mjs"));
  assert.ok(files.includes("out/pack-release.schema.json"));
  assert.equal(files.includes("scripts/copy-open-packs.mjs"), false);
});

void test("CommonJS extension bundle keeps the helper as native external ESM", () => {
  const packageRoot = path.resolve(__dirname, "../..");
  const bundle = readFileSync(path.join(packageRoot, "out/extension.js"), "utf8");

  assert.match(bundle, /\bimport\s*\(/);
});

void test("packaged helper loads its adjacent schema through import.meta.url", () => {
  const packageRoot = path.resolve(__dirname, "../..");
  const helperUrl = pathToFileURL(path.join(packageRoot, "out/open-packs.mjs")).href;
  const profile = {
    engine_version: "0.13.0",
    build_identity: "test-build",
    model_set_sha256: "a".repeat(64),
    capability_contract_version: 1,
    schemas: {
      policy_document: [1],
      rql: [1],
      builtin_catalog: [1],
      policy_bundle: [1],
      semantic_model_read: [1],
      semantic_model_write: [1],
      semantic_spec: [1],
      release_index: [1],
      runtime: [1]
    },
    capabilities: ["test-capability"]
  };
  const source = [
    `const helper = await import(${JSON.stringify(helperUrl)});`,
    `const profile = ${JSON.stringify(profile)};`,
    `const actual = await helper.readEnginePackProfile("fake-bifrost", {`,
    `  env: {},`,
    `  execFileImpl: async () => ({ stdout: JSON.stringify(profile), stderr: "" })`,
    `});`,
    `if (JSON.stringify(actual) !== JSON.stringify(profile)) process.exitCode = 1;`
  ].join("\n");

  execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: packageRoot,
    stdio: "pipe"
  });
});
