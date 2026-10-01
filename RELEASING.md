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

## Server pack consumer prerequisite

This checkout has no Rust server source, Cargo manifest, or server build
workflow. The extension release workflow consumes existing standalone archives;
it does not produce them. Bifrost-dev removed `crates/bifrost-lsp` in commit
`4541130f99f9e428ff9b4db344f7cf1273a96768`. Its current `--lsp` and `--server lsp`
commands report that the server moved out. Historical server code is a migration
reference and requires adaptation and validation against the selected engine.

Before qualifying a standalone server, locate or restore its producer and verify
the following behavior with that executable:

- `pack-engine-profile` prints the exact linked engine's JSON profile and exits
  successfully without starting stdio LSP or opening a workspace. Use the
  engine's profile API rather than reconstructing its version, build identity,
  model digest, supported schemas, or capabilities in the server.
- The profile's engine version agrees with
  `capabilities.experimental.bifrost.engineVersion` in the LSP initialize result.
- Before creating a workspace, the engine registers the native bundle selected
  by `BIFROST_OPEN_SEMANTIC_PACK_BUNDLE` using
  `BIFROST_SEMANTIC_PACK_CACHE_ROOT` for its catalog. Invalid or incompatible
  explicitly selected content fails visibly rather than falling back to embedded
  packs. The Bifrost facade's semantic-pack bootstrap is currently connected to
  MCP workspace creation; a standalone LSP must connect its own workspace path.
- Policy discovery and execution load the selected
  `BIFROST_OPEN_POLICY_PACK_ROOT` through the engine's policy catalog API.
- Integration tests demonstrate a meaningful semantic model and policy finding
  from a compatible verified selection, offline reuse, rejection of incompatible
  releases and corrupt content, and agreement between profile and handshake.

The extension vendors the shared cache helper and release schema. Tests using
synthetic qualified releases verify acquisition and cache integrity only; they
do not qualify native semantic model decoding, policy execution, or actual LSP
activation. Live activation additionally requires compatible qualified public
rules and semantic-pack releases from BrokkAi/bifrost-packs.
