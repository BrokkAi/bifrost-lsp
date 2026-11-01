# Cursor LSP

Cursor can use the Bifrost editor extension for definitions, references, hover,
rename, symbols and diagnostics. It runs the separate `bifrost-lsp` server.
For supported extension and server versions, see [LSP Server](./lsp.md).

The [Bifrost Cursor agent plugin](https://bifrost.brokk.ai/cursor/) uses a
separate MCP process. Install either integration for its own surface, or both.

## Install and Upgrade

Install the [Bifrost extension from Open VSX](https://open-vsx.org/extension/brokk/bifrost-vscode),
or open Cursor's **Extensions** view and search for `brokk.bifrost-vscode`.
Confirm that the publisher is **brokk**, choose **Install**, and open a supported
source workspace. With the default `auto` launch mode, accept the prompt to
install the managed server binary.

Open **Output > Bifrost** and keep the lines that show the download and the
installed version and path. The managed installer:

1. downloads the `bifrost-lsp` platform archive and its `.sha256` file from
   the BrokkAi/bifrost-lsp GitHub release;
2. checks that the `.sha256` file and the archive both match the hash built
   into the extension package; and
3. runs the binary with `--version` before it starts the language server.

A visible Bifrost status item does not by itself show that these checks
passed or that the server serves the active workspace.

To upgrade, choose **Update** for Bifrost in Cursor's Extensions view. Fully
quit and reopen Cursor. Then check the installed extension version and the
managed server version in **Output > Bifrost**. If the extension asks to
install a new managed binary, choose **Update**.

See [VS Code LSP](./vscode.md) for all extension settings, commands, and launch
modes.

## Validate the Editor Extension

Use a normal workspace rather than a Cursor agent worktree for this smoke. Add
a temporary, uniquely named declaration and usage in a supported language. For
example, in Rust:

```rust
pub fn cursor_bifrost_lsp_probe_4f6f2b7() {}

pub fn call_cursor_bifrost_lsp_probe_4f6f2b7() {
    cursor_bifrost_lsp_probe_4f6f2b7();
}
```

From the usage, verify **Go to Definition**, **Find All References**, and
hover. Run **Rename Symbol**, confirm that both declaration and usage change,
then undo the rename. To exercise diagnostics, temporarily enable
`bifrost.unrecognizedSymbolDiagnostics`, replace the call with a unique missing
symbol, and confirm that Bifrost reports it before restoring the valid call and
disabling the experimental setting.

Pass only if every result belongs to the active checkout and **Output >
Bifrost** shows the language-server launch for that workspace. Remove the
temporary probe after you record the Cursor version, extension version,
managed server version, platform, output, and operation results.

## Troubleshoot the Editor Extension

- Run **Bifrost: Show Output** and check the full launch command, download,
  checksum, version, and handler errors.
- Run **Bifrost: Restart Language Server** after changing roots, exclusions, or
  launch settings.
- Set `bifrost.launchMode` to `bundled` to require the managed binary, or use
  `path` with `bifrost.serverPath` to diagnose a specific local binary.
- Set `bifrost.debug` to `true` for LSP request tracing and lower
  `bifrost.slowRequestMs` when investigating latency.
- If the output shows `the LSP server has moved out of this repository`, the
  extension started a Bifrost CLI newer than 0.12.0. Use `auto` or `bundled`
  mode, or point `bifrost.serverPath` at a standalone `bifrost-lsp` binary.
- Do not use healthy MCP status as evidence that the editor extension works;
  it is a different process and protocol.

