#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const SUPPORTED_TARGETS = [
  "aarch64-pc-windows-msvc",
  "aarch64-unknown-linux-gnu",
  "universal-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];
const options = parseArgs(process.argv.slice(2));
const releaseTag = required(options.releaseTag, "release-tag");
const manifestPath = path.resolve(required(options.manifest, "manifest"));
const distDir = path.resolve(required(options.dist, "dist"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const { extensionVersion, serverVersion, minimumServerVersion } =
  parseReleaseTag(releaseTag);
assertCommittedMetadata(manifest, {
  extensionVersion,
  serverVersion,
  minimumServerVersion,
});
if (options.githubOutput) {
  fs.appendFileSync(
    options.githubOutput,
    `extension_version=${extensionVersion}\nserver_version=${serverVersion}\nminimum_server_version=${minimumServerVersion}\nvsix_name=bifrost-vscode-v${extensionVersion}.vsix\n`,
  );
}
if (options.metadataOnly === "true") process.exit(0);
manifest.bifrost = {
  ...manifest.bifrost,
  serverVersion,
  minimumServerVersion,
  archiveSha256: readAndVerifyArchives(distDir, serverVersion),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

function readAndVerifyArchives(distDir, version) {
  const hashes = {};
  for (const target of SUPPORTED_TARGETS) {
    const suffix = target.includes("windows") ? ".zip" : ".tar.gz";
    const archiveName = `bifrost-lsp-v${version}-${target}${suffix}`;
    const archivePath = path.join(distDir, archiveName);
    const sidecarPath = `${archivePath}.sha256`;
    const text = fs.readFileSync(sidecarPath, "utf8").trim();
    const [hash, name] = text.split(/\s+/u);
    if (
      !/^[a-f0-9]{64}$/u.test(hash) ||
      (name && path.basename(name.replace(/^\*/u, "")) !== archiveName)
    )
      throw new Error(`Invalid SHA-256 sidecar for ${archiveName}`);
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(archivePath))
      .digest("hex");
    if (hash !== actual) throw new Error(`SHA-256 mismatch for ${archiveName}`);
    hashes[target] = hash;
  }
  return hashes;
}

function parseReleaseTag(tag) {
  const semver =
    "(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?";
  const match = tag.match(
    new RegExp(
      `^vscode-v(${semver})__server-v(${semver})__min-v(${semver})$`,
      "u",
    ),
  );
  if (!match) throw new Error(`Invalid extension release tag: ${tag}`);
  return {
    extensionVersion: match[1],
    serverVersion: match[7],
    minimumServerVersion: match[13],
  };
}

function assertCommittedMetadata(
  manifest,
  { extensionVersion, serverVersion, minimumServerVersion },
) {
  const expected = [
    ["version", manifest.version, extensionVersion],
    ["bifrost.serverVersion", manifest.bifrost?.serverVersion, serverVersion],
    [
      "bifrost.minimumServerVersion",
      manifest.bifrost?.minimumServerVersion,
      minimumServerVersion,
    ],
  ];
  for (const [name, committed, tagged] of expected) {
    if (committed !== tagged)
      throw new Error(
        `${name} is ${committed}; release tag supplies ${tagged}`,
      );
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined)
      throw new Error("Arguments must be --key value pairs");
    parsed[
      key
        .slice(2)
        .replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())
    ] = value;
  }
  return parsed;
}

function required(value, name) {
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}
