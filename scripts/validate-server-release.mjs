#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_TARGETS, archiveNameFor, checksumNameFor } from "./package-server-release.mjs";

export function readPackageVersion(manifestPath) {
  const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/u);
  let inPackage = false;
  for (const line of lines) {
    if (line.startsWith("[")) inPackage = line === "[package]";
    if (inPackage) {
      const match = /^version\s*=\s*"([^"]+)"/u.exec(line);
      if (match) return match[1];
    }
  }
  throw new Error(`Could not read [package] version from ${manifestPath}`);
}

export function readExactEngineVersion(manifestPath) {
  const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/u);
  let inDependencies = false;
  for (const line of lines) {
    if (line.startsWith("[")) inDependencies = line === "[dependencies]";
    if (inDependencies) {
      const direct = /^brokk-bifrost\s*=\s*"=([^"]+)"/u.exec(line);
      const table = /^brokk-bifrost\s*=\s*\{[^}]*version\s*=\s*"=([^"]+)"/u.exec(line);
      const match = direct ?? table;
      if (match) return match[1];
    }
  }
  throw new Error(`Could not read an exact brokk-bifrost dependency pin from ${manifestPath}`);
}

export function validateReleaseMetadata({ cargoManifest, tag }) {
  const version = readPackageVersion(cargoManifest);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid [package] version: ${version}`);
  }
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match package version ${version}`);
  }
  return version;
}

export function validateReleaseArtifacts({ cargoManifest, tag, distDir }) {
  const version = validateReleaseMetadata({ cargoManifest, tag });
  const outputDir = path.resolve(distDir);
  const expected = new Set();
  for (const target of Object.keys(SERVER_TARGETS)) {
    expected.add(archiveNameFor(version, target));
    expected.add(checksumNameFor(version, target));
  }
  const actual = new Set(fs.readdirSync(outputDir));
  const missing = [...expected].filter((name) => !actual.has(name));
  const unexpected = [...actual].filter((name) => !expected.has(name));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Release artifact set is incomplete; missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`,
    );
  }

  for (const target of Object.keys(SERVER_TARGETS)) {
    const archiveName = archiveNameFor(version, target);
    const archivePath = path.join(outputDir, archiveName);
    const checksumPath = path.join(outputDir, checksumNameFor(version, target));
    if (!fs.statSync(archivePath).isFile() || !fs.statSync(checksumPath).isFile()) {
      throw new Error(`Release artifacts must be regular files for ${archiveName}`);
    }
    const [hash, name] = fs.readFileSync(checksumPath, "utf8").trim().split(/\s+/u);
    if (!/^[a-f0-9]{64}$/u.test(hash) || name?.replace(/^\*/u, "") !== archiveName) {
      throw new Error(`Invalid SHA-256 sidecar for ${archiveName}`);
    }
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
    if (hash !== actualHash) throw new Error(`SHA-256 mismatch for ${archiveName}`);
  }
  return version;
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be --key value pairs");
    }
    parsed[key.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
  }
  return parsed;
}

function required(options, name) {
  if (!options[name]) throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  return options[name];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const cargoManifest = path.resolve(required(options, "cargoManifest"));
  const tag = options.tag;
  const version = tag
    ? validateReleaseMetadata({ cargoManifest, tag })
    : readPackageVersion(cargoManifest);
  if (options.metadataOnly !== "true") {
    validateReleaseArtifacts({ cargoManifest, tag: required(options, "tag"), distDir: required(options, "dist") });
  }
  if (options.githubOutput) {
    fs.appendFileSync(options.githubOutput, `version=${version}\n${tag ? `release_tag=${tag}\n` : ""}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
