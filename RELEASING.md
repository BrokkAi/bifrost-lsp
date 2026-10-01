# Extension releases

`editors/vscode/package.json` keeps three independent contracts:

- `version`: Visual Studio Marketplace/Open VSX extension version.
- `bifrost.serverVersion` and `minimumServerVersion`: standalone `bifrost-lsp`
  release range downloaded from this repository.
- `bifrost.engineCompatibility`: documented engine protocol compatibility; it
  does not select a release artifact.

The first extension release here is 0.12.0 because 0.11.4 is already published.
This preserves continuity without making the unsupported stability claim implied
by 1.0.0.

## Release tag

Commit the intended extension, server, and minimum compatible server versions
in `editors/vscode/package.json`, then create and push an annotated tag with the
exact form:

```text
vscode-v<extension>__server-v<server>__min-v<minimum>
```

For example, the current manifest would use
`vscode-v0.12.0__server-v0.1.0__min-v0.1.0`. Each field must be a complete
semantic version. The workflow checks out the tag and rejects it unless all
three values exactly match the committed manifest. Do not create a tag until
the corresponding standalone `v<server>` GitHub release contains every
supported platform asset.

The tag workflow downloads all five `bifrost-lsp-v<server>-<target>` archives
and SHA-256 sidecars, verifies each archive against its sidecar, injects the
verified hashes, runs the extension tests, and packages one exact VSIX. That
artifact is attested and published unchanged to both registries through the
protected `release` environment. The final job downloads both marketplace
copies and requires their SHA-256 values to equal the qualified VSIX.

`workflow_dispatch` is a recovery path for an existing tag. Supply the complete
release tag above; it is subject to the same checkout, manifest, artifact, and
publication checks. The separate post-release smoke workflow remains available
for marketplace-only rechecks.

Before tagging, run `npm ci --ignore-scripts && npm test` in `editors/vscode`.
Never package again in a publish job.

External repository setup required before publishing:

- GitHub `release` environment with required reviewers and the `VSCE_PAT` secret.
- `VSCE_PAT` authorized for Visual Studio Marketplace publisher `brokk`.
- An Open VSX trusted publisher for the existing `brokk.bifrost-vscode`
  extension: provider **GitHub Actions**, organization **BrokkAi**, repository
  **bifrost-lsp**, workflow filename **release.yml**, and environment **release**.
  Register it at <https://open-vsx.org/user-settings/trusted-publishers> as a
  namespace owner with a signed Publisher Agreement. Include the environment
  so only jobs passing its protections can publish.
- Repository Actions settings permitting build-provenance attestations and
  `id-token: write` for the release workflow.
- A tag protection rule or ruleset restricting creation of
  `vscode-v*__server-v*__min-v*` tags to release maintainers.

These credentials, namespace ownership, environment protection, and marketplace
publisher transfer cannot be migrated in source code. No release is published
by the repository's validation workflow.

Open VSX publication requires OIDC through `ovsx --trusted-publishing`; the
publish job has `id-token: write` and does not receive an `OVSX_PAT` secret.
See the [Open VSX trusted publishing documentation](https://github.com/eclipse-openvsx/openvsx/wiki/Trusted-Publishing).
Configure the registration before the next extension release. After a real
release succeeds through OIDC and passes the marketplace checksum smoke check,
remove the unused GitHub `OVSX_PAT` secret and revoke its corresponding Open VSX
token once every workflow using that token has migrated. Other repositories
publishing this same extension must be retired or routed through this workflow:
Open VSX allows only one trusted publisher per extension. Visual Studio
Marketplace still uses its separate `VSCE_PAT`.

The extension fails closed unless the server's LSP `initialize` result contains
`capabilities.experimental.bifrost` with protocol version `1` and an
`engineVersion` inside `bifrost.engineCompatibility`. A standalone server
release must implement this structured handshake before it can be selected by
an enforcing extension release.

## Server build and engine API prerequisite

This repository owns the independent Rust `bifrost-lsp` 0.1.0 server, its
orchestration, handlers, and integration tests. Its server qualification
workflow builds a Linux archive for validation; it does not publish a server
release. The extension release workflow consumes standalone server archives.
Historical source provenance is recorded in [SOURCE.md](SOURCE.md).

The server implements the pack consumer contract: `pack-engine-profile` reports
the exact linked engine profile, and that engine version is repeated in
`capabilities.experimental.bifrost` during LSP initialize. Before a workspace is
accepted, the server validates and bootstraps the explicitly selected semantic
bundle using `BIFROST_OPEN_SEMANTIC_PACK_BUNDLE` and
`BIFROST_SEMANTIC_PACK_CACHE_ROOT`. Invalid selected content fails visibly;
there is no fallback to embedded packs. Policy listing and `bifrost/runPolicy`
load `BIFROST_OPEN_POLICY_PACK_ROOT` through the engine's policy catalog API;
`runPolicy` accepts the catalog's `policyId`. Integration tests cover actual
semantic activation and offline reuse, selected policy execution, corrupt
content, incompatible bundles, and profile/handshake agreement. Live extension
activation still requires compatible qualified public policy and semantic-pack
releases from BrokkAi/bifrost-packs.

The manifest pins the `brokk-bifrost` crate family to exactly 0.12.0, but the
published 0.12.0 crates do not include the engine profile, selected-root, and current analyzer APIs
used by this server. Therefore, the registry-only build is not currently a valid
qualification path. A compatible public engine release must publish those APIs
and the manifest's exact pins must be updated to that release before a default
registry build can qualify. Until then, local development uses a clean engine
checkout at revision `adef484da552bfc0896b057ae7efc2d53a671c9f`. Generate the
ignored Cargo path override with Python 3.11 or newer from the repository root
(the helper refuses a dirty engine checkout unless explicitly allowed):

```sh
python3 scripts/configure-local-engine.py \
  /path/to/bifrost-engine \
  --expected-revision adef484da552bfc0896b057ae7efc2d53a671c9f
```

The script discovers `brokk-bifrost*` package manifests and writes their
absolute paths to `.cargo/local-engine.toml`; it does not modify the engine
checkout. With that local override present, the constrained host validation
commands are:

```sh
JAVA_HOME= BIFROST_PARALLELISM=1 RAYON_NUM_THREADS=1 cargo --config .cargo/local-engine.toml check --all-targets
JAVA_HOME= BIFROST_PARALLELISM=1 RAYON_NUM_THREADS=1 cargo nextest run --config .cargo/local-engine.toml --locked --max-fail 100
JAVA_HOME= BIFROST_PARALLELISM=1 RAYON_NUM_THREADS=1 cargo clippy --config .cargo/local-engine.toml --all-targets --all-features -- -D warnings
```

For `cargo nextest` and `cargo clippy`, put the config after the subcommand so
the nested Cargo invocation receives the local patch configuration.

The local path override is machine-specific, ignored by Git, and must not be
committed or used to claim that the public registry dependency is qualified.
The first local check updates package provenance in `Cargo.lock`; subsequent
local gates can use `--locked`. Keep that validation lock with the exact engine
revision as evidence, and restore the committed registry lock before committing.
Publishing or promoting a server release requires the published engine API
prerequisite and the repository's release gates.
