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

Run `npm ci --ignore-scripts && npm test` in `editors/vscode`. Qualification
must provide all five `bifrost-lsp-v<server>-<target>` archives and SHA-256
sidecars, run `scripts/prepare-vscode-extension-manifest.mjs`, package one VSIX,
and publish that exact file to both registries. Never package again in a publish
job.

External repository setup required before publishing:

- GitHub `release` environment with required reviewers.
- `VSCE_PAT` authorized for Visual Studio Marketplace publisher `brokk`.
- `OVSX_PAT` authorized for Open VSX namespace `brokk`.
- Actions permissions: read contents for qualification; write contents and
  attestations/id-token for release provenance and artifact attestation.
- Branch/tag protection permitting the release workflow only after qualification.

These credentials, namespace ownership, environment protection, and marketplace
publisher transfer cannot be migrated in source code. No release is published
by the repository's validation workflow.

The extension fails closed unless the server's LSP `initialize` result contains
`capabilities.experimental.bifrost` with protocol version `1` and an
`engineVersion` inside `bifrost.engineCompatibility`. A standalone server
release must implement this structured handshake before it can be selected by
an enforcing extension release.
