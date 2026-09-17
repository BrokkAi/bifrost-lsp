#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const SUPPORTED_TARGETS = [
  "aarch64-pc-windows-msvc",
  "aarch64-unknown-linux-gnu",
  "universal-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];
const options = parseArgs(process.argv.slice(2));
const extensionVersion = required(
  options.extensionVersion,
  "extension-version",
);
const serverVersion = required(options.serverVersion, "server-version");
const minimumServerVersion = options.minimumServerVersion ?? serverVersion;
const manifestPath = path.resolve(required(options.manifest, "manifest"));
const distDir = path.resolve(required(options.dist, "dist"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = extensionVersion;
manifest.bifrost = {
  ...manifest.bifrost,
  serverVersion,
  minimumServerVersion,
  archiveSha256: readArchiveHashes(distDir, serverVersion),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

function readArchiveHashes(distDir, version) {
  const hashes = {};
  for (const target of SUPPORTED_TARGETS) {
    const suffix = target.includes("windows") ? ".zip" : ".tar.gz";
    const archiveName = `bifrost-lsp-v${version}-${target}${suffix}`;
    const text = fs
      .readFileSync(path.join(distDir, `${archiveName}.sha256`), "utf8")
      .trim();
    const [hash, name] = text.split(/\s+/u);
    if (
      !/^[a-f0-9]{64}$/u.test(hash) ||
      (name && path.basename(name.replace(/^\*/u, "")) !== archiveName)
    )
      throw new Error(`Invalid SHA-256 sidecar for ${archiveName}`);
    hashes[target] = hash;
  }
  return hashes;
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
