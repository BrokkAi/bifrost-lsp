#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readExactEngineVersion, readPackageVersion } from "./validate-server-release.mjs";

export function validateServerEvidence({
  cargoManifest,
  profilePath,
  versionPath,
  targetIdentityPath,
  sourceCommitPath,
  cargoLockPath,
  expectedRustTargets,
  expectedReleaseTarget,
}) {
  const packageVersion = readPackageVersion(cargoManifest);
  const engineVersion = readExactEngineVersion(cargoManifest);
  const profile = readJson(profilePath, "engine profile");
  if (profile.engine_version !== engineVersion) {
    throw new Error(
      `Engine profile reports ${profile.engine_version}; Cargo pins brokk-bifrost ${engineVersion}`,
    );
  }
  if (typeof profile.build_identity !== "string" || !profile.build_identity) {
    throw new Error("Engine profile is missing build_identity");
  }
  if (!/^[a-f0-9]{64}$/u.test(profile.model_set_sha256 ?? "")) {
    throw new Error("Engine profile has an invalid model_set_sha256");
  }
  if (!profile.schemas || typeof profile.schemas !== "object" || Array.isArray(profile.schemas)) {
    throw new Error("Engine profile is missing schemas");
  }
  if (!Array.isArray(profile.capabilities)) {
    throw new Error("Engine profile is missing capabilities");
  }

  const versionOutput = fs.readFileSync(versionPath, "utf8").trim();
  const expectedVersionOutput = `bifrost-lsp ${packageVersion}`;
  if (versionOutput !== expectedVersionOutput) {
    throw new Error(
      `Server --version returned ${versionOutput}; expected ${expectedVersionOutput}`,
    );
  }

  const identity = readJson(targetIdentityPath, "target identity");
  const actualRustTargets = Array.isArray(identity.rust_targets)
    ? identity.rust_targets
    : [identity.rust_target];
  if (JSON.stringify([...actualRustTargets].sort()) !== JSON.stringify([...expectedRustTargets].sort())) {
    throw new Error(
      `Target identity reports ${actualRustTargets.join(",")}; expected ${expectedRustTargets.join(",")}`,
    );
  }
  if (identity.release_target !== expectedReleaseTarget) {
    throw new Error(
      `Target identity reports release target ${identity.release_target}; expected ${expectedReleaseTarget}`,
    );
  }
  if (typeof identity.runner !== "string" || !identity.runner) {
    throw new Error("Target identity is missing runner");
  }

  const sourceCommit = fs.readFileSync(sourceCommitPath, "utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error(`Invalid source commit evidence: ${sourceCommit}`);
  }
  if (!fs.statSync(cargoLockPath).isFile()) {
    throw new Error("Cargo.lock evidence is missing or invalid");
  }
  const lock = fs.readFileSync(cargoLockPath, "utf8").replace(/\r\n/gu, "\n");
  if (!lock.includes("[[package]]")) {
    throw new Error("Cargo.lock evidence is missing or invalid");
  }
  const enginePackages = [...lock.matchAll(/\[\[package\]\]\nname = "(brokk-bifrost(?:-[^"]+)?)"\n([\s\S]*?)(?=\n\[\[package\]\]|$)/gu)]
    .filter(([, name]) => name !== "brokk-bifrost-lsp");
  if (!enginePackages.length) {
    throw new Error("Cargo.lock evidence contains no registry Bifrost crates");
  }
  for (const [, name, body] of enginePackages) {
    const version = /^version = "([^"]+)"/mu.exec(body)?.[1];
    const source = /^source = "([^"]+)"/mu.exec(body)?.[1];
    const checksum = /^checksum = "([a-f0-9]{64})"/mu.exec(body)?.[1];
    if (version !== engineVersion || !source?.startsWith("registry+") || !checksum) {
      throw new Error(`Cargo.lock Bifrost crate ${name} is not an exact registry ${engineVersion} package with checksum`);
    }
  }
  return { packageVersion, engineVersion, sourceCommit, identity };
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  if (!options[name]) {
    throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  return options[name];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  validateServerEvidence({
    cargoManifest: path.resolve(required(options, "cargoManifest")),
    profilePath: path.resolve(required(options, "profile")),
    versionPath: path.resolve(required(options, "versionOutput")),
    targetIdentityPath: path.resolve(required(options, "targetIdentity")),
    sourceCommitPath: path.resolve(required(options, "sourceCommit")),
    cargoLockPath: path.resolve(required(options, "cargoLock")),
    expectedRustTargets: required(options, "rustTargets").split(","),
    expectedReleaseTarget: required(options, "releaseTarget"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
