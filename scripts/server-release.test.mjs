import assert from "node:assert/strict";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { packageServerRelease, SERVER_TARGETS, archiveNameFor } from "./package-server-release.mjs";
import { validateServerEvidence } from "./validate-server-evidence.mjs";
import { validateReleaseArtifacts, validateReleaseMetadata } from "./validate-server-release.mjs";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bifrost-server-release-test-"));
  const manifest = path.join(root, "Cargo.toml");
  const dist = path.join(root, "dist");
  await fs.mkdir(dist);
  await fs.writeFile(
    manifest,
    '[package]\nname = "fixture"\nversion = "0.13.0"\n\n[dependencies]\nbrokk-bifrost = "=0.13.0"\n',
  );
  for (const target of Object.keys(SERVER_TARGETS)) {
    const archive = archiveNameFor("0.13.0", target);
    const contents = Buffer.from(`fixture-${target}`);
    const hash = crypto.createHash("sha256").update(contents).digest("hex");
    await fs.writeFile(path.join(dist, archive), contents);
    await fs.writeFile(path.join(dist, `${archive}.sha256`), `${hash}  ${archive}\n`);
  }
  return { root, manifest, dist };
}

test("requires the release tag to equal the package version", async () => {
  const { root, manifest } = await fixture();
  try {
    assert.equal(validateReleaseMetadata({ cargoManifest: manifest, tag: "v0.13.0" }), "0.13.0");
    assert.throws(
      () => validateReleaseMetadata({ cargoManifest: manifest, tag: "v0.13.1" }),
      /does not match package version/u,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("requires every consumed archive and verifies every sidecar", async () => {
  const { root, manifest, dist } = await fixture();
  try {
    assert.equal(validateReleaseArtifacts({ cargoManifest: manifest, tag: "v0.13.0", distDir: dist }), "0.13.0");
    const archive = archiveNameFor("0.13.0", "x86_64-unknown-linux-gnu");
    await fs.writeFile(path.join(dist, archive), "tampered");
    assert.throws(
      () => validateReleaseArtifacts({ cargoManifest: manifest, tag: "v0.13.0", distDir: dist }),
      /SHA-256 mismatch/u,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects missing and unexpected sidecars", async () => {
  const { root, manifest, dist } = await fixture();
  try {
    const archive = archiveNameFor("0.13.0", "x86_64-unknown-linux-gnu");
    await fs.rm(path.join(dist, `${archive}.sha256`));
    assert.throws(
      () => validateReleaseArtifacts({ cargoManifest: manifest, tag: "v0.13.0", distDir: dist }),
      /Release artifact set is incomplete/u,
    );
    await fs.writeFile(path.join(dist, `${archive}.sha256`), "invalid");
    await fs.writeFile(path.join(dist, "unexpected.sha256"), "invalid");
    assert.throws(
      () => validateReleaseArtifacts({ cargoManifest: manifest, tag: "v0.13.0", distDir: dist }),
      /Release artifact set is incomplete/u,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("round-trips a real archive into the downloader's installed root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bifrost server release test-"));
  const target = process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
  const executable = SERVER_TARGETS[target].executable;
  const binary = path.join(root, "build output with spaces", executable);
  const license = path.join(root, "LICENSE");
  const dist = path.join(root, "dist output with spaces");
  const extracted = path.join(root, "installed output with spaces");
  try {
    await fs.mkdir(path.dirname(binary), { recursive: true });
    await fs.mkdir(extracted, { recursive: true });
    const contents = Buffer.from("server binary round-trip");
    const licenseContents = Buffer.from("Apache License 2.0 test fixture\n");
    await fs.writeFile(binary, contents);
    await fs.writeFile(license, licenseContents);
    const result = packageServerRelease({
      version: "0.13.0",
      target,
      binary,
      distDir: dist,
      licensePath: license,
    });
    if (process.platform === "win32") {
      const script = path.join(root, "extract archive with spaces.ps1");
      await fs.writeFile(
        script,
        "param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n",
      );
      runPowerShell(
        script,
        result.archivePath,
        extracted,
      );
    } else {
      const extraction = spawnSync("tar", ["-xzf", result.archivePath, "-C", extracted], { encoding: "utf8" });
      assert.equal(extraction.status, 0, extraction.stderr);
    }
    const installedRoot = path.join(extracted, archiveNameFor("0.13.0", target).replace(/\.(?:tar\.gz|zip)$/u, ""));
    const installed = path.join(installedRoot, executable);
    assert.deepEqual(await fs.readFile(installed), contents);
    assert.deepEqual(await fs.readFile(path.join(installedRoot, "LICENSE")), licenseContents);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("requires exact engine and server version evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bifrost server evidence test-"));
  const manifest = path.join(root, "Cargo.toml");
  const profile = path.join(root, "profile.json");
  const version = path.join(root, "version.txt");
  const identity = path.join(root, "target.json");
  const sourceCommit = path.join(root, "source.txt");
  const cargoLock = path.join(root, "Cargo.lock");
  try {
    await fs.writeFile(manifest, '[package]\nversion = "0.1.0"\n\n[dependencies]\nbrokk-bifrost = "=0.13.0"\n');
    const profileValue = { engine_version: "0.13.0", build_identity: "unknown", model_set_sha256: "a".repeat(64), schemas: { profile: 1 }, capabilities: [] };
    await fs.writeFile(profile, JSON.stringify(profileValue));
    await fs.writeFile(version, "bifrost-lsp 0.1.0\n");
    await fs.writeFile(identity, JSON.stringify({ rust_target: "x86_64-unknown-linux-gnu", release_target: "x86_64-unknown-linux-gnu", runner: "ubuntu-latest" }));
    await fs.writeFile(sourceCommit, `${"a".repeat(40)}\n`);
    await fs.writeFile(cargoLock, `[[package]]\nname = "brokk-bifrost"\nversion = "0.13.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${"b".repeat(64)}"\n`);
    assert.equal(validateServerEvidence({ cargoManifest: manifest, profilePath: profile, versionPath: version, targetIdentityPath: identity, sourceCommitPath: sourceCommit, cargoLockPath: cargoLock, expectedRustTargets: ["x86_64-unknown-linux-gnu"], expectedReleaseTarget: "x86_64-unknown-linux-gnu" }).engineVersion, "0.13.0");
    await fs.writeFile(profile, JSON.stringify({ ...profileValue, engine_version: "0.12.0" }));
    assert.throws(() => validateServerEvidence({ cargoManifest: manifest, profilePath: profile, versionPath: version, targetIdentityPath: identity, sourceCommitPath: sourceCommit, cargoLockPath: cargoLock, expectedRustTargets: ["x86_64-unknown-linux-gnu"], expectedReleaseTarget: "x86_64-unknown-linux-gnu" }), /Cargo pins brokk-bifrost/u);
    await fs.writeFile(profile, JSON.stringify(profileValue));
    await fs.writeFile(version, "bifrost-lsp 0.2.0\n");
    assert.throws(() => validateServerEvidence({ cargoManifest: manifest, profilePath: profile, versionPath: version, targetIdentityPath: identity, sourceCommitPath: sourceCommit, cargoLockPath: cargoLock, expectedRustTargets: ["x86_64-unknown-linux-gnu"], expectedReleaseTarget: "x86_64-unknown-linux-gnu" }), /expected bifrost-lsp 0.1.0/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("normalizes CRLF Cargo.lock evidence without weakening package checks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bifrost server CRLF evidence test-"));
  const manifest = path.join(root, "Cargo.toml");
  const profile = path.join(root, "profile.json");
  const version = path.join(root, "version.txt");
  const identity = path.join(root, "target.json");
  const sourceCommit = path.join(root, "source.txt");
  const cargoLock = path.join(root, "Cargo.lock");
  const checksum = "b".repeat(64);
  const validLock = [
    "# This file is automatically @generated by Cargo.",
    "version = 4",
    "",
    "[[package]]",
    'name = "brokk-bifrost"',
    'version = "0.13.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${checksum}"`,
    'dependencies = ["brokk-bifrost-analysis", "serde"]',
    "",
    "[[package]]",
    'name = "brokk-bifrost-analysis"',
    'version = "0.13.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${checksum}"`,
    "",
    "[[package]]",
    'name = "serde"',
    'version = "1.0.0"',
    'source = "registry+https://github.com/rust-lang/crates.io-index"',
    `checksum = "${"c".repeat(64)}"`,
    "",
  ].join("\n");
  const profileValue = {
    engine_version: "0.13.0",
    build_identity: "unknown",
    model_set_sha256: "a".repeat(64),
    schemas: { profile: 1 },
    capabilities: [],
  };
  const evidence = () => validateServerEvidence({
    cargoManifest: manifest,
    profilePath: profile,
    versionPath: version,
    targetIdentityPath: identity,
    sourceCommitPath: sourceCommit,
    cargoLockPath: cargoLock,
    expectedRustTargets: ["x86_64-unknown-linux-gnu"],
    expectedReleaseTarget: "x86_64-unknown-linux-gnu",
  });

  try {
    await fs.writeFile(manifest, '[package]\nversion = "0.1.0"\n\n[dependencies]\nbrokk-bifrost = "=0.13.0"\n');
    await fs.writeFile(profile, JSON.stringify(profileValue));
    await fs.writeFile(version, "bifrost-lsp 0.1.0\n");
    await fs.writeFile(identity, JSON.stringify({
      rust_target: "x86_64-unknown-linux-gnu",
      release_target: "x86_64-unknown-linux-gnu",
      runner: "ubuntu-latest",
    }));
    await fs.writeFile(sourceCommit, `${"a".repeat(40)}\n`);

    await fs.writeFile(cargoLock, validLock);
    assert.equal(evidence().engineVersion, "0.13.0");

    const crlfLock = validLock.replace(/\n/gu, "\r\n");
    await fs.writeFile(cargoLock, crlfLock);
    assert.equal(evidence().engineVersion, "0.13.0");

    const nearMisses = [
      [
        "mismatched version",
        crlfLock.replace(
          'name = "brokk-bifrost-analysis"\r\nversion = "0.13.0"',
          'name = "brokk-bifrost-analysis"\r\nversion = "0.12.0"',
        ),
      ],
      [
        "non-registry source",
        crlfLock.replace(
          'source = "registry+https://github.com/rust-lang/crates.io-index"',
          'source = "git+https://github.com/BrokkAi/bifrost"',
        ),
      ],
      [
        "missing checksum",
        crlfLock.replace(`checksum = "${checksum}"\r\n`, ""),
      ],
    ];
    for (const [label, lock] of nearMisses) {
      await fs.writeFile(cargoLock, lock);
      assert.throws(
        evidence,
        /Cargo\.lock Bifrost crate .* is not an exact registry 0\.13\.0 package with checksum/u,
        label,
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

function runPowerShell(script, ...args) {
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
