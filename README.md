# Bifrost LSP

This repository owns the standalone Bifrost language server and the existing
`brokk.bifrost-vscode` extension. The extension remains published as
`brokk/bifrost-vscode` on Open VSX.

The first extension release from this repository is `0.12.0`, following the
currently published `0.11.4`. Extension versions, standalone server versions,
and compatible Bifrost engine versions are intentionally independent. Release
qualification injects the server version and SHA-256 hashes into the VSIX.
Extension releases use self-describing
`vscode-v<extension>__server-v<server>__min-v<minimum>` tags whose values must
exactly match the committed manifest.

See [RELEASING.md](RELEASING.md) for qualification and external setup.
