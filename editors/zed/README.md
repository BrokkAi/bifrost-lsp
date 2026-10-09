# Bifrost for Zed

Local Zed extension scaffold for the `bifrost-lsp` language server in this
repository. It is unpublished and is not a supported integration. See
[Zed LSP](../../docs/zed.md) for status.

## Development

Put a `bifrost-lsp` binary on `PATH`, or set `lsp.bifrost-rust.binary.path` to
its absolute path for a single language.

Open Zed, run `zed: install dev extension`, and select `editors/zed`.

For the first smoke test, configure the language to use only the Bifrost
adapter:

```json
{
  "languages": {
    "Rust": {
      "language_servers": ["bifrost-rust", "!rust-analyzer"]
    }
  }
}
```

Avoid `lsp.bifrost-rust.binary.path` for local testing. Zed treats that as a
direct language-server binary override and starts it without the extension's
`--root <worktree-root>` argument.

The extension starts the language server with:

```bash
bifrost-lsp --root <worktree-root>
```

Any `lsp.bifrost.binary.arguments` values are appended after `--root` and can
be used for local debugging flags.
