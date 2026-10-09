# Bifrost for Zed

Local Zed extension scaffold for the `bifrost-lsp` language server in this
repository. It is unpublished and is not a supported integration. See
[Zed LSP](../../docs/zed.md) for status.

## Development

For local testing, put a `bifrost-lsp` binary on `PATH` so the extension
adapter supplies the worktree root.

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

Zed treats `lsp.bifrost-rust.binary.path` as a direct language-server binary
override and starts it without the extension adapter's
`--root <worktree-root>` argument. Use the `PATH`-based setup above for the
first smoke test. If you use a direct override, configure its arguments
explicitly when the server needs a fallback root:

```json
{
  "lsp": {
    "bifrost-rust": {
      "binary": {
        "path": "/path/to/bifrost-lsp",
        "arguments": ["--root", "/path/to/worktree"]
      }
    }
  }
}
```

The extension starts the language server with:

```bash
bifrost-lsp --root <worktree-root>
```

When the extension adapter is used, any `lsp.bifrost.binary.arguments` values
are appended after `--root` and can be used for local debugging flags.
