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

## Server build and release

The standalone server version is `0.1.0`, independent of the extension version
`0.12.0` and the linked Bifrost engine `0.13.0`. All Bifrost dependencies are
exact public crates.io pins. Default builds must use the committed registry
lockfile without `.cargo/local-engine.toml` or a sibling engine checkout.

The engine is linked into `bifrost-lsp`; installing a standalone server installs
that release's engine too. There is no runtime switch to an arbitrary engine.
The extension selects its preferred server from committed release metadata,
checks the archive against both its release sidecar and the hash pinned into
the VSIX, and installs it in versioned editor global storage. A compatible
cached server starts offline; a preferred server can be prepared in the
background when update policy allows it. Explicit `bifrost.serverPath` and
`path` launch mode remain available for development and external installs.
The engine compatibility range for this extension is `>=0.13.0 <0.14.0`;
initialization must report protocol `1` and the actual linked engine version.

Local qualification:

```sh
cargo fmt --check
JAVA_HOME= CARGO_BUILD_JOBS=2 cargo check --locked --all-targets
JAVA_HOME= CARGO_BUILD_JOBS=2 cargo nextest run --locked --test-threads 2
JAVA_HOME= CARGO_BUILD_JOBS=2 cargo clippy --locked --all-targets --all-features -- -D warnings
```

CI performs registry-only Rust checks and extension validation. The server
qualification workflow provides a Linux archive without publishing. The server
release workflow can also run its complete matrix with `qualify_only` enabled
and an exact source commit, without creating a release. The server
release workflow builds the five targets consumed by the extension: universal
macOS, Linux x86_64/aarch64, and Windows x86_64/aarch64. It requires the server
tag to match `Cargo.toml`, qualifies binaries and engine profiles, and gates
publication on the complete archive/checksum set. Publication uses the protected
`release` environment. Do not bypass its approval controls.

Release in this order:

1. Merge the validated server/extension changes after exact-head CI passes.
2. Create an annotated `v0.1.0` server tag at the qualified commit and run the
   server release workflow. Verify all five assets and checksum sidecars exist.
3. Create the extension tag
   `vscode-v0.12.0__server-v0.1.0__min-v0.1.0`. Its workflow injects hashes from
   the server release into the qualified VSIX before publication.
4. Verify both marketplace copies against the qualified VSIX, then install in
   a clean editor profile and smoke the managed download, LSP initialize,
   navigation, offline restart, and update behavior.

The server implements the pack consumer contract: `pack-engine-profile` reports
the linked engine profile, and the same version appears in the initialize
result. Before accepting a workspace it validates and bootstraps the selected
semantic bundle using `BIFROST_OPEN_SEMANTIC_PACK_BUNDLE` and
`BIFROST_SEMANTIC_PACK_CACHE_ROOT`. Invalid selected content fails visibly.
Policy listing and `bifrost/runPolicy` load `BIFROST_OPEN_POLICY_PACK_ROOT`
through the engine catalog. Integration tests cover semantic activation and
offline reuse, selected policy execution, corrupt content, incompatible
bundles, and profile/handshake agreement. Live pack activation additionally
requires a compatible qualified public release from BrokkAi/bifrost-packs;
unavailable packs remain visible as unavailable.

The standalone server implements LSP. MCP setup requires a separate `bifrost`
CLI installation; it must never generate MCP commands for `bifrost-lsp`.

Historical local engine development and imported public source provenance are
recorded in [SOURCE.md](SOURCE.md). The ignored local override helper remains
available for development, but it is not a release qualification path.
