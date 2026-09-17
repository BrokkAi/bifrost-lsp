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

- GitHub `release` environment with required reviewers and both secrets.
- `VSCE_PAT` authorized for Visual Studio Marketplace publisher `brokk`.
- `OVSX_PAT` authorized for Open VSX namespace `brokk`.
- Repository Actions settings permitting build-provenance attestations and
  `id-token: write` for the release workflow.
- A tag protection rule or ruleset restricting creation of
  `vscode-v*__server-v*__min-v*` tags to release maintainers.

These credentials, namespace ownership, environment protection, and marketplace
publisher transfer cannot be migrated in source code. No release is published
by the repository's validation workflow.
