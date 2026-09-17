import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
const SUPPORTED_TARGETS = [
  "aarch64-pc-windows-msvc",
  "aarch64-unknown-linux-gnu",
  "universal-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/prepare-vscode-extension-manifest.mjs");

test("keeps extension, server, and engine compatibility versions independent", async () => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "bifrost-vscode-manifest-test-"),
  );
  const dist = path.join(temp, "dist"),
    manifest = path.join(temp, "package.json");
  await fs.mkdir(dist);
  await fs.writeFile(
    manifest,
    `${JSON.stringify({ version: "0.11.4", bifrost: { engineCompatibility: ">=0.11 <1" } })}\n`,
  );
  for (const target of SUPPORTED_TARGETS) {
    const suffix = target.includes("windows") ? ".zip" : ".tar.gz",
      archive = `bifrost-lsp-v0.3.2-${target}${suffix}`;
    await fs.writeFile(
      path.join(dist, `${archive}.sha256`),
      `${"a".repeat(64)}  ${archive}\n`,
    );
  }
  await execFileAsync(process.execPath, [
    script,
    "--extension-version",
    "0.12.0",
    "--server-version",
    "0.3.2",
    "--minimum-server-version",
    "0.3.0",
    "--dist",
    dist,
    "--manifest",
    manifest,
  ]);
  const result = JSON.parse(await fs.readFile(manifest, "utf8"));
  assert.equal(result.version, "0.12.0");
  assert.equal(result.bifrost.serverVersion, "0.3.2");
  assert.equal(result.bifrost.minimumServerVersion, "0.3.0");
  assert.equal(result.bifrost.engineCompatibility, ">=0.11 <1");
  assert.deepEqual(
    Object.keys(result.bifrost.archiveSha256).sort(),
    [...SUPPORTED_TARGETS].sort(),
  );
});

test("fails closed when a server checksum sidecar is missing", async () => {
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "bifrost-vscode-manifest-test-"),
  );
  const dist = path.join(temp, "dist"),
    manifest = path.join(temp, "package.json");
  await fs.mkdir(dist);
  await fs.writeFile(manifest, "{}\n");
  await assert.rejects(
    execFileAsync(process.execPath, [
      script,
      "--extension-version",
      "0.12.0",
      "--server-version",
      "0.3.2",
      "--dist",
      dist,
      "--manifest",
      manifest,
    ]),
  );
});
