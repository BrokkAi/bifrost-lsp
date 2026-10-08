import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import type * as OpenPacksModule from "../src/open_packs";

const loadModule = createRequire(__filename);
const openPacks = loadModule("../src/open_packs") as typeof OpenPacksModule;

// These synthetic profiles and release artifacts exercise the real vendored helper.
// They are fixtures only and do not claim that a released LSP server activates packs.
const repository = "https://github.com/BrokkAi/bifrost-packs";
const rulesPackId = "bifrost.public.rules";
const semanticPackId = "bifrost.public.packs";
const schemaAxes = [
  "policy_document",
  "rql",
  "builtin_catalog",
  "policy_bundle",
  "semantic_model_read",
  "semantic_model_write",
  "semantic_spec",
  "release_index",
  "runtime"
] as const;

const syntheticProfile = {
  engine_version: "0.13.0",
  build_identity: "synthetic-engine-build",
  model_set_sha256: "b".repeat(64),
  capability_contract_version: 1,
  schemas: {
    policy_document: [1],
    rql: [1],
    builtin_catalog: [1],
    policy_bundle: [1],
    semantic_model_read: [5],
    semantic_model_write: [5],
    semantic_spec: [1],
    release_index: [1],
    runtime: [1]
  },
  capabilities: []
};

interface NativeOpenPacksApi {
  readEnginePackProfile(
    binaryPath: string,
    options: {
      env: NodeJS.ProcessEnv;
      execFileImpl: (
        binaryPath: string,
        args: string[],
        options: Record<string, unknown>
      ) => Promise<{ stdout: string; stderr?: string }>;
    }
  ): Promise<unknown>;
  prepareOpenPacks: OpenPacksModule.OpenPacksHelperApi["prepareOpenPacks"];
}

interface FixtureContent {
  kind: string;
  identity: string;
  path: string;
  sha256: string;
  languages: string[];
  dependencies: unknown[];
  schemas: Record<string, number[]>;
  required_capabilities: string[];
}

interface FixtureManifest {
  manifest_schema_version: number;
  pack: { id: string; repository: string; visibility: "public" };
  release_version: string;
  source: { repository: string; commit: string; dirty: boolean };
  compatibility: {
    engine: { min_inclusive: string; max_exclusive: string };
    schemas: Record<string, number[]>;
    capabilities: { required: string[]; provided: string[]; contract_version: number };
  };
  contents: FixtureContent[];
  artifacts: Array<{
    name: string;
    sha256: string;
    size_bytes: number;
    format: string;
    role: string;
  }>;
  qualification: { status: "qualified" | "pending"; evidence: string[] };
  release_dependencies: Array<{ pack_id: string; release_version: string; repository: string }>;
}

interface FixtureRelease {
  tag: string;
  manifest: FixtureManifest;
  archive: Buffer;
  artifactName: string;
}

function hash(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function schemaSet(): Record<string, number[]> {
  return Object.fromEntries(schemaAxes.map((axis) => [axis, []]));
}

function tarArchive(files: Record<string, string>): Buffer {
  const records: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const bytes = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, bytes.length);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    records.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  records.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(records));
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function makeRelease(
  packId: string,
  options: {
    qualification?: "qualified" | "pending";
    minEngine?: string;
    maxEngine?: string;
  } = {}
): FixtureRelease {
  const isRules = packId === rulesPackId;
  const files: Record<string, string> = isRules
    ? {
        "rules/demo/manifest.json": '{"id":"synthetic-demo"}\n',
        "rules/demo/policies/example.rqlp": "policy synthetic_demo {}\n"
      }
    : { "bifrost-semantic-packs/index.json": '{"schema_version":1,"packs":[]}\n' };
  const contents = Object.entries(files).map(([filePath, contentsBytes]) => ({
    kind: isRules
      ? filePath.endsWith("manifest.json")
        ? "policy-pack"
        : "policy"
      : "semantic-model",
    identity: `${packId}/${filePath}`,
    path: filePath,
    sha256: hash(contentsBytes),
    languages: [],
    dependencies: [],
    schemas: schemaSet(),
    required_capabilities: []
  }));
  const archive = tarArchive(files);
  const artifactName = isRules ? "rules.tar.gz" : "semantic.tar.gz";
  const version = "1.0.0";
  const commit = (isRules ? "c" : "d").repeat(40);
  const manifest: FixtureManifest = {
    manifest_schema_version: 1,
    pack: { id: packId, repository, visibility: "public" },
    release_version: version,
    source: { repository, commit, dirty: false },
    compatibility: {
      engine: {
        min_inclusive: options.minEngine ?? "0.12.0",
        max_exclusive: options.maxEngine ?? "0.14.0"
      },
      schemas: schemaSet(),
      capabilities: { required: [], provided: [], contract_version: 1 }
    },
    contents,
    artifacts: [
      {
        name: artifactName,
        sha256: hash(archive),
        size_bytes: archive.byteLength,
        format: "tar.gz",
        role: isRules ? "policy" : "native"
      }
    ],
    qualification: {
      status: options.qualification ?? "qualified",
      evidence: options.qualification === "pending" ? [] : ["synthetic fixture qualification"]
    },
    release_dependencies: isRules
      ? [
          {
            pack_id: semanticPackId,
            release_version: version,
            repository
          }
        ]
      : []
  };

  return {
    tag: `${isRules ? "rules" : "packs"}/v${version}`,
    manifest,
    archive,
    artifactName
  };
}

function buildFetch(releases: FixtureRelease[]) {
  const assets = new Map<string, Buffer>();
  const commits = new Map<string, string>();
  const calls: string[] = [];
  const apiReleases = releases.map((release) => {
    const manifestUrl = `https://github.com/BrokkAi/bifrost-packs/releases/download/${release.tag.replaceAll("/", "%2F")}/pack-release.json`;
    const artifactUrl = `https://github.com/BrokkAi/bifrost-packs/releases/download/${release.tag.replaceAll("/", "%2F")}/${release.artifactName}`;
    assets.set(manifestUrl, Buffer.from(JSON.stringify(release.manifest)));
    assets.set(artifactUrl, release.archive);
    commits.set(release.tag, release.manifest.source.commit);
    return {
      tag_name: release.tag,
      draft: false,
      prerelease: false,
      assets: [
        { name: "pack-release.json", browser_download_url: manifestUrl },
        { name: release.artifactName, browser_download_url: artifactUrl }
      ]
    };
  });
  const fetchImpl: typeof fetch = (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === "/repos/BrokkAi/bifrost-packs/releases") {
      return Promise.resolve(
        new Response(JSON.stringify(apiReleases), {
          headers: { "content-type": "application/json" }
        })
      );
    }
    const refPrefix = "/repos/BrokkAi/bifrost-packs/git/ref/tags/";
    if (parsed.pathname.startsWith(refPrefix)) {
      const commit = commits.get(parsed.pathname.slice(refPrefix.length));
      return Promise.resolve(
        commit
          ? new Response(JSON.stringify({ object: { type: "commit", sha: commit } }))
          : new Response("missing", { status: 404 })
      );
    }
    const asset = assets.get(url);
    return Promise.resolve(asset ? new Response(asset) : new Response("missing", { status: 404 }));
  };
  return { fetchImpl, calls };
}

async function nativeHelper(): Promise<OpenPacksModule.OpenPacksHelperApi> {
  const helperPath = path.resolve(__dirname, "../src/open-packs.mjs");
  const native = (await import(pathToFileURL(helperPath).href)) as unknown as NativeOpenPacksApi;
  return {
    readEnginePackProfile(binaryPath, options) {
      return native.readEnginePackProfile(binaryPath, {
        ...options,
        execFileImpl: (invokedBinary, args) => {
          assert.equal(invokedBinary, binaryPath);
          assert.deepEqual(args, ["pack-engine-profile"]);
          return Promise.resolve({ stdout: JSON.stringify(syntheticProfile) });
        }
      });
    },
    prepareOpenPacks: native.prepareOpenPacks
  };
}

function serverOptions(
  cacheDir: string,
  overrides: Partial<OpenPacksModule.PrepareOpenPacksForServerOptions> = {}
): OpenPacksModule.PrepareOpenPacksForServerOptions {
  return {
    command: "/synthetic/bin/bifrost",
    cwd: "/synthetic/workspace",
    env: { PATH: "/synthetic/bin" },
    cacheDir,
    offline: false,
    refresh: false,
    loadHelper: nativeHelper,
    ...overrides
  };
}

async function temporaryDirectory(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bifrost-lsp-open-packs-"));
}

function hasErrorCode(code: string) {
  return (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code;
}

void test("synthetic compatible release pair prepares verified server roots and offline reuse", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const cacheDir = path.join(parent, "cache");
  const releases = [makeRelease(rulesPackId), makeRelease(semanticPackId)];
  const online = buildFetch(releases);
  const prepared = await openPacks.prepareOpenPacksForServer(
    serverOptions(cacheDir, { fetchImpl: online.fetchImpl })
  );

  assert.equal(prepared.status, "ready");
  assert.equal(prepared.engineVersion, syntheticProfile.engine_version);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared.engineProfile)), syntheticProfile);
  assert.equal(
    openPacks.profileMatchesNegotiatedEngine(prepared.engineVersion ?? "", "0.13.0"),
    true
  );
  assert.deepEqual(Object.keys(prepared.env).sort(), [
    "BIFROST_OPEN_POLICY_PACK_ROOT",
    "BIFROST_OPEN_SEMANTIC_PACK_BUNDLE",
    "BIFROST_SEMANTIC_PACK_CACHE_ROOT"
  ]);
  assert.equal(
    prepared.env.BIFROST_OPEN_POLICY_PACK_ROOT,
    path.join(
      cacheDir,
      "selections",
      (prepared.receipt as { selection_id: string }).selection_id,
      "source",
      "rules"
    )
  );
  assert.equal(
    await fs.readFile(
      path.join(prepared.env.BIFROST_OPEN_POLICY_PACK_ROOT, "demo", "manifest.json"),
      "utf8"
    ),
    '{"id":"synthetic-demo"}\n'
  );
  assert.equal(
    await fs.readFile(
      path.join(prepared.env.BIFROST_OPEN_SEMANTIC_PACK_BUNDLE, "index.json"),
      "utf8"
    ),
    '{"schema_version":1,"packs":[]}\n'
  );
  assert.equal(
    prepared.env.BIFROST_SEMANTIC_PACK_CACHE_ROOT,
    path.join(cacheDir, "semantic-pack-catalog-v1")
  );
  const receipt = prepared.receipt as {
    engine_profile: unknown;
    status: string;
    discovery_status: string;
    cache_reused: boolean;
    releases: Array<{ pack_id: string; release_version: string }>;
  };
  assert.equal(receipt.status, "qualified");
  assert.equal(receipt.discovery_status, "online");
  assert.equal(receipt.cache_reused, false);
  assert.deepEqual(JSON.parse(JSON.stringify(receipt.engine_profile)), syntheticProfile);
  assert.deepEqual(
    receipt.releases.map(({ pack_id, release_version }) => [pack_id, release_version]),
    [
      [rulesPackId, "1.0.0"],
      [semanticPackId, "1.0.0"]
    ]
  );

  let offlineFetches = 0;
  const reused = await openPacks.prepareOpenPacksForServer(
    serverOptions(cacheDir, {
      offline: true,
      fetchImpl: () => {
        offlineFetches += 1;
        return Promise.reject(new Error("offline mode attempted network access"));
      }
    })
  );
  assert.equal(reused.status, "ready");
  assert.equal(
    reused.env.BIFROST_OPEN_POLICY_PACK_ROOT,
    prepared.env.BIFROST_OPEN_POLICY_PACK_ROOT
  );
  assert.equal((reused.receipt as { discovery_status: string }).discovery_status, "offline-cache");
  assert.equal((reused.receipt as { cache_reused: boolean }).cache_reused, true);
  assert.equal(offlineFetches, 0);
  assert.ok(online.calls.length > 0);
});

void test("synthetic incompatible and pending release sets become typed unavailable results", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));

  const incompatibleCache = path.join(parent, "incompatible");
  const incompatible = buildFetch([
    makeRelease(rulesPackId, { minEngine: "0.14.0", maxEngine: "0.15.0" }),
    makeRelease(semanticPackId, { minEngine: "0.14.0", maxEngine: "0.15.0" })
  ]);
  const incompatibleResult = await openPacks.prepareOpenPacksForServer(
    serverOptions(incompatibleCache, { fetchImpl: incompatible.fetchImpl })
  );
  assert.equal(incompatibleResult.status, "unavailable");
  assert.match(incompatibleResult.diagnostic ?? "", /no-compatible-release/);
  assert.deepEqual(incompatibleResult.env, {});

  const pendingCache = path.join(parent, "pending");
  const pending = buildFetch([
    makeRelease(rulesPackId, { qualification: "pending" }),
    makeRelease(semanticPackId, { qualification: "pending" })
  ]);
  const pendingResult = await openPacks.prepareOpenPacksForServer(
    serverOptions(pendingCache, { fetchImpl: pending.fetchImpl })
  );
  assert.equal(pendingResult.status, "unavailable");
  assert.match(pendingResult.diagnostic ?? "", /pending/);
  assert.equal(pendingResult.engineVersion, syntheticProfile.engine_version);
  assert.deepEqual(pendingResult.env, {});
});

void test("synthetic cached artifact and extracted-content corruption stay fatal", async (t) => {
  const parent = await temporaryDirectory();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const releases = [makeRelease(rulesPackId), makeRelease(semanticPackId)];

  const artifactCache = path.join(parent, "artifact-cache");
  const artifactSeed = await openPacks.prepareOpenPacksForServer(
    serverOptions(artifactCache, { fetchImpl: buildFetch(releases).fetchImpl })
  );
  const artifactPath = (artifactSeed.receipt as { artifacts: Array<{ cache_path: string }> })
    .artifacts[0].cache_path;
  await fs.writeFile(artifactPath, "synthetic corruption");
  await assert.rejects(
    openPacks.prepareOpenPacksForServer(serverOptions(artifactCache, { offline: true })),
    hasErrorCode("integrity-error")
  );

  const extractedCache = path.join(parent, "extracted-cache");
  const extractedSeed = await openPacks.prepareOpenPacksForServer(
    serverOptions(extractedCache, { fetchImpl: buildFetch(releases).fetchImpl })
  );
  await fs.writeFile(
    path.join(extractedSeed.env.BIFROST_OPEN_SEMANTIC_PACK_BUNDLE, "index.json"),
    "synthetic modification"
  );
  await assert.rejects(
    openPacks.prepareOpenPacksForServer(serverOptions(extractedCache, { offline: true })),
    hasErrorCode("integrity-error")
  );
});
