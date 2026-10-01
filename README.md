# Bifrost LSP

This repository owns the existing `brokk.bifrost-vscode` extension and is the
intended home of the standalone Bifrost language server. This checkout currently
contains the extension and its release workflows; it does not yet contain Rust
server source or a server build workflow. The extension remains published as
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
[BrokkAi/bifrost-packs](https://github.com/BrokkAi/bifrost-packs). The extension
probes the selected server's `pack-engine-profile` command, selects a compatible
qualified release set, and verifies cached content before passing its roots to
the server. Cache preparation alone does not establish that a server loads the
selected content. The missing server producer must implement and verify the
[pack consumer contract](RELEASING.md#server-pack-consumer-prerequisite) before
the standalone server can be qualified.
