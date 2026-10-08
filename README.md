# Bifrost LSP

This repository owns the existing `brokk.bifrost-vscode` extension and is the
standalone Bifrost language server. It contains the independent Rust
`bifrost-lsp` 0.1.1 server, its request handlers and integration tests, alongside
the extension and its release workflows. The extension remains published as
`brokk/bifrost-vscode` on Open VSX.

The first extension release from this repository is `0.12.0`, following the
currently published `0.11.4`. Extension versions, standalone server versions,
and compatible Bifrost engine versions are intentionally independent. Release
qualification injects the server version and SHA-256 hashes into the VSIX.
Extension releases use self-describing
`vscode-v<extension>__server-v<server>__min-v<minimum>` tags whose values must
exactly match the committed manifest.

See [RELEASING.md](RELEASING.md) for qualification and external setup.

Open semantic packs and policies come from
[BrokkAi/bifrost-packs](https://github.com/BrokkAi/bifrost-packs). The server
reports the exact linked engine through `pack-engine-profile` and the LSP
initialize result, validates explicitly selected semantic bundles before
accepting a session, and bootstraps their semantic model in its workspace.
Policy listing and `bifrost/runPolicy` resolve policy IDs through the selected
policy catalog. The server pins the published `brokk-bifrost` 0.13.0 crate family. Each standalone
server release carries its linked engine; the extension manages that pairing by
installing a checksum-verified server in editor global storage. Updating the
extension selects its qualified server version, with compatible cached servers
available offline. See [RELEASING.md](RELEASING.md#server-build-and-release).
