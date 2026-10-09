# Zed LSP

> [!CAUTION]
> **No released Zed LSP setup yet**
> The `bifrost-lsp` v0.1.1 server is released, but the Zed extension remains
> unpublished. Bifrost built after release 0.12.0 does not serve LSP:
> `bifrost --lsp` exits with an error. See [LSP Server](./lsp.md).

Bifrost has no published Zed extension. This repository contains an
unpublished development scaffold for one in [`editors/zed`](../editors/zed/). It starts the language server with:

```bash
bifrost-lsp --root <worktree-root>
```

For local development, put `bifrost-lsp` on `PATH` so the extension adapter
starts it with the worktree root. A configured `binary.path` is a direct Zed
host override: it bypasses the extension adapter, so the host does not add
`--root <worktree-root>`. If you use a direct override, provide the fallback
root yourself through that setting's `binary.arguments`.
It is not a supported integration.

To use Bifrost tools from Zed's agent, configure MCP instead. MCP does not need
the language server. See [Zed MCP](https://bifrost.brokk.ai/zed-mcp/).
