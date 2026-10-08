import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import type * as OpenPacksModule from "../src/open_packs";

const loadModule = createRequire(__filename);
const openPacks = loadModule("../src/open_packs") as typeof OpenPacksModule;

const profile = {
  engine_version: "0.13.0",
  build_identity: "a".repeat(64),
  model_set_sha256: "b".repeat(64),
  capability_contract_version: 1,
  schemas: ["test-schema"],
  capabilities: ["test-capability"]
};

function openPackError(code: string): Error & { code: string } {
  return Object.assign(new Error(`failure: ${code}`), { code });
}

function options(
  overrides: Partial<OpenPacksModule.PrepareOpenPacksForServerOptions> = {}
): OpenPacksModule.PrepareOpenPacksForServerOptions {
  return {
    command: "/fake/bifrost",
    cwd: "/workspace",
    env: { PATH: "/bin" },
    cacheDir: "/extension-storage/open-packs",
    offline: false,
    refresh: false,
    ...overrides
  };
}

function helper(
  prepareOpenPacks: OpenPacksModule.OpenPacksHelperApi["prepareOpenPacks"],
  readEnginePackProfile: OpenPacksModule.OpenPacksHelperApi["readEnginePackProfile"] = () =>
    Promise.resolve(profile)
): OpenPacksModule.OpenPacksHelperApi {
  return { prepareOpenPacks, readEnginePackProfile };
}

void test("probes the selected server and forwards the exact profile, cache options, env, and receipt", async () => {
  let preparedOptions: OpenPacksModule.OpenPacksHelperOptions | undefined;
  const receipt = { engine_version: "0.13.0", selection: ["public-pack"] };
  const result = await openPacks.prepareOpenPacksForServer(
    options({
      offline: true,
      loadHelper: () =>
        Promise.resolve(
          helper(
            (prepared) => {
              preparedOptions = prepared;
              return Promise.resolve({
                env: {
                  BIFROST_OPEN_SEMANTIC_PACK_BUNDLE: "/cache/bundle",
                  BIFROST_OPEN_POLICY_PACK_ROOT: "/cache/policies",
                  BIFROST_SEMANTIC_PACK_CACHE_ROOT: "/cache/catalog"
                },
                receipt
              });
            },
            (binaryPath, probeOptions) => {
              assert.equal(binaryPath, "/fake/bifrost");
              assert.deepEqual(probeOptions, { env: { PATH: "/bin" } });
              return Promise.resolve(profile);
            }
          )
        )
    })
  );

  assert.equal(result.status, "ready");
  assert.equal(result.engineVersion, "0.13.0");
  assert.deepEqual(result.engineProfile, profile);
  assert.deepEqual(result.receipt, receipt);
  assert.equal(preparedOptions?.cacheDir, "/extension-storage/open-packs");
  assert.equal(preparedOptions?.engineProfile, result.engineProfile);
  assert.equal(preparedOptions?.offline, true);
  assert.equal(preparedOptions?.refresh, false);
  assert.deepEqual(Object.keys(result.env).sort(), [
    "BIFROST_OPEN_POLICY_PACK_ROOT",
    "BIFROST_OPEN_SEMANTIC_PACK_BUNDLE",
    "BIFROST_SEMANTIC_PACK_CACHE_ROOT"
  ]);
});

void test("resolves a selected relative executable against its launch working directory", async () => {
  let probedBinary = "";
  await openPacks.prepareOpenPacksForServer(
    options({
      command: "target/debug/bifrost",
      loadHelper: () =>
        Promise.resolve(
          helper(
            () => Promise.resolve({ env: {}, receipt: {} }),
            (binaryPath) => {
              probedBinary = binaryPath;
              return Promise.reject(openPackError("unsupported"));
            }
          )
        )
    })
  );
  assert.equal(probedBinary, "/workspace/target/debug/bifrost");
});

void test("keeps a server running only when the profile command is explicitly unsupported", async () => {
  let prepareCalled = false;
  const result = await openPacks.prepareOpenPacksForServer(
    options({
      loadHelper: () =>
        Promise.resolve(
          helper(
            () => {
              prepareCalled = true;
              return Promise.reject(new Error("must not be called"));
            },
            () => Promise.reject(openPackError("unsupported"))
          )
        )
    })
  );

  assert.equal(result.status, "unavailable");
  assert.match(result.diagnostic ?? "", /pack-engine-profile/);
  assert.deepEqual(result.env, {});
  assert.equal(prepareCalled, false);
});

void test("treats malformed profiles and profile execution errors as fatal", async () => {
  for (const code of ["invalid-engine-profile", "profile-execution"]) {
    await assert.rejects(
      openPacks.prepareOpenPacksForServer(
        options({
          loadHelper: () =>
            Promise.resolve(
              helper(
                () => Promise.resolve({ env: {}, receipt: {} }),
                () => Promise.reject(openPackError(code))
              )
            )
        })
      ),
      (error: unknown) =>
        error instanceof Error && "code" in error && (error as { code: unknown }).code === code
    );
  }

  await assert.rejects(
    openPacks.prepareOpenPacksForServer(
      options({
        loadHelper: () =>
          Promise.resolve(
            helper(
              () => Promise.resolve({ env: {}, receipt: {} }),
              () => Promise.resolve({ engine_version: 13 })
            )
          )
      })
    ),
    /malformed engine profile/
  );
});

void test("treats pending, unavailable, and no-compatible-release content as non-fatal", async () => {
  for (const code of ["pending", "unavailable", "no-compatible-release"]) {
    const result = await openPacks.prepareOpenPacksForServer(
      options({
        loadHelper: () => Promise.resolve(helper(() => Promise.reject(openPackError(code))))
      })
    );

    assert.equal(result.status, "unavailable");
    assert.equal(result.engineVersion, "0.13.0");
    assert.match(result.diagnostic ?? "", new RegExp(code));
    assert.deepEqual(result.env, {});
  }
});

void test("does not downgrade manifest, schema, or integrity failures", async () => {
  for (const code of ["invalid-manifest", "unsupported-manifest-schema", "integrity-error"]) {
    await assert.rejects(
      openPacks.prepareOpenPacksForServer(
        options({
          loadHelper: () => Promise.resolve(helper(() => Promise.reject(openPackError(code))))
        })
      ),
      (error: unknown) =>
        error instanceof Error && "code" in error && (error as { code: unknown }).code === code
    );
  }
});

void test("matches profile engine version against negotiated LSP identity", () => {
  assert.equal(openPacks.profileMatchesNegotiatedEngine("0.13.0", "0.13.0"), true);
  assert.equal(openPacks.profileMatchesNegotiatedEngine("0.13.0", "0.12.0"), false);
});
