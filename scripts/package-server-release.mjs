#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const SERVER_TARGETS = Object.freeze({
  "aarch64-pc-windows-msvc": { suffix: ".zip", executable: "bifrost-lsp.exe" },
  "aarch64-unknown-linux-gnu": { suffix: ".tar.gz", executable: "bifrost-lsp" },
  "universal-apple-darwin": { suffix: ".tar.gz", executable: "bifrost-lsp" },
  "x86_64-pc-windows-msvc": { suffix: ".zip", executable: "bifrost-lsp.exe" },
  "x86_64-unknown-linux-gnu": { suffix: ".tar.gz", executable: "bifrost-lsp" },
});

export function archiveNameFor(version, target) {
  const spec = SERVER_TARGETS[target];
  if (!spec) throw new Error(`Unsupported server target: ${target}`);
  return `bifrost-lsp-v${version}-${target}${spec.suffix}`;
}

export function checksumNameFor(version, target) {
  return `${archiveNameFor(version, target)}.sha256`;
}

export function packageServerRelease({ version, target, binary, distDir, licensePath }) {
  const spec = SERVER_TARGETS[target];
  if (!spec) throw new Error(`Unsupported server target: ${target}`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid server version: ${version}`);
  }

  const binaryPath = path.resolve(binary);
  const licenseFile = path.resolve(licensePath ?? "LICENSE");
  const outputDir = path.resolve(distDir);
  const archiveName = archiveNameFor(version, target);
  const archivePath = path.join(outputDir, archiveName);
  const rootName = archiveName.slice(0, -spec.suffix.length);
  const stageRoot = path.join(outputDir, rootName);
  const stagedBinary = path.join(stageRoot, spec.executable);

  if (!fs.statSync(binaryPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Server binary is missing: ${binaryPath}`);
  }
  if (!fs.statSync(licenseFile, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Repository license is missing: ${licenseFile}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.rmSync(archivePath, { force: true });
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.copyFileSync(binaryPath, stagedBinary);
  fs.copyFileSync(licenseFile, path.join(stageRoot, "LICENSE"));
  if (process.platform !== "win32") fs.chmodSync(stagedBinary, 0o755);

  try {
    if (spec.suffix === ".zip") {
      runCommand(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Compress-Archive -LiteralPath $env:BIFROST_ARCHIVE_SOURCE -DestinationPath $env:BIFROST_ARCHIVE_DESTINATION -Force",
        ],
        {
          BIFROST_ARCHIVE_SOURCE: stageRoot,
          BIFROST_ARCHIVE_DESTINATION: archivePath,
        },
      );
    } else {
      runCommand("tar", ["-czf", archivePath, "-C", outputDir, rootName]);
    }
    const hash = sha256File(archivePath);
    fs.writeFileSync(
      `${archivePath}.sha256`,
      `${hash}  ${path.basename(archivePath)}\n`,
    );
    return { archivePath, checksumPath: `${archivePath}.sha256`, hash };
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function runCommand(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit status ${result.status}`);
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
  if (!options[name]) throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  return options[name];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  packageServerRelease({
    version: required(options, "version"),
    target: required(options, "target"),
    binary: required(options, "binary"),
    distDir: required(options, "dist"),
    licensePath: options.license,
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
