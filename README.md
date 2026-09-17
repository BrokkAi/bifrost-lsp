# Bifrost LSP

This repository owns the standalone Bifrost language server and the existing
`brokk.bifrost-vscode` extension. The extension remains published as
`brokk/bifrost-vscode` on Open VSX.

The first extension release from this repository is `0.12.0`, following the
currently published `0.11.4`. Extension versions, standalone server versions,
and compatible Bifrost engine versions are intentionally independent. Release
qualification injects the server version and SHA-256 hashes into the VSIX.

See [RELEASING.md](RELEASING.md) for qualification and external setup.
