# VS Code LSP

Install the Bifrost VS Code extension, and look up its launch modes, settings, commands, and views.

> [!CAUTION]
> **The language server moved to bifrost-lsp**
> Bifrost built after release 0.12.0 does not serve LSP: `bifrost --lsp` exits with an
> error. The separate `bifrost-lsp` v0.1.1 server is released. Extension
> version 0.12.1 downloads and manages that server. See
> [LSP Server](./lsp.md) for the full status.

## Install

Install **Bifrost: Multi-Language LSP & MCP Server** (`brokk.bifrost-vscode`)
from the
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Brokk.bifrost-vscode)
or [Open VSX](https://open-vsx.org/extension/brokk/bifrost-vscode). The
extension needs VS Code 1.90 or newer.

The current extension version is 0.12.1. It uses standalone server
version 0.1.1. The rest of this page describes version 0.12.1.

Version 0.12.1 also checks the server's identity after it starts. The server
must report LSP protocol `1` and a Bifrost engine version from `0.13.0` up to,
but not including, `0.14.0`. Otherwise the extension stops the server. See
[LSP Server](./lsp.md) for the check and the release files.

The extension describes its editor features as definitions, references,
symbols, hierarchy, rename, diagnostics, completion, and hover. It starts the
server for files in these VS Code languages: `c`, `cpp`, `csharp`, `go`,
`java`, `javascript`, `javascriptreact`, `kotlin`, `php`, `python`, `rust`,
`scala`, `typescript`, and `typescriptreact`. It also activates for the three
Bifrost languages below.

## Launch Modes

`bifrost.launchMode` chooses the server binary.

| Mode | Binary the extension starts |
| --- | --- |
| `auto` (default) | A configured `bifrost.serverPath` other than the default command names `bifrost` and `bifrost-lsp`; otherwise the managed binary, if available or installed; otherwise the newer local `bifrost-lsp` development build; otherwise `bifrost-lsp` on `PATH`. |
| `bundled` | The managed binary only. If no compatible managed binary is installed, the extension asks to install it and fails if you decline. |
| `path` | The exact value of `bifrost.serverPath`. It does not fall back to a managed binary or local development build; a command name is still resolved on `PATH`. |

A local development build is `target/debug/bifrost-lsp` or
`target/release/bifrost-lsp` at the repository root, two directories above the
extension's own folder. The extension uses the newer of the two. This applies
only when you run the extension from a source checkout.

In version 0.12.1, the manifest default for `bifrost.serverPath` is
`bifrost-lsp`. `auto` mode also treats the legacy `bifrost` value as a default
command name and selects the standalone server. In `path` mode, the extension
uses the configured value verbatim, so set `bifrost.serverPath` to the absolute
path or `PATH` command name of a `bifrost-lsp` binary.

### Managed Binary

In `auto` and `bundled` mode, the extension manages its own server binary:

- It supports macOS (x64 and arm64), Linux (x64 and arm64), and Windows (x64
  and arm64).
- It asks before it downloads. You can choose **Update**, **Not Now** (skip
  this version), or **Don't Ask Again**.
- It downloads the archive and its `.sha256` file from the GitHub release. It
  checks that both match the SHA-256 value built into the extension package.
- It stores the binary in VS Code's global storage for the extension, under
  `binaries/<version>/<platform>-<arch>/`.
- It runs the binary with `--version` before it uses it.
- It reuses a cached binary from the extension's compatible version range
  without asking. After a new install, it deletes cached versions outside that
  range.

## Settings

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `bifrost.launchMode` | `auto`, `bundled`, or `path` | `auto` | How to choose the server binary. See [Launch Modes](#launch-modes). |
| `bifrost.serverPath` | string | `bifrost-lsp` | Path to the server binary, or a command name to find on `PATH`. In `path` mode, use `bifrost-lsp`; `auto` mode also recognizes the legacy `bifrost` value as a compatibility sentinel. |
| `bifrost.debug` | boolean | `false` | Log every LSP request and notification. The extension passes this to the server as `BIFROST_LSP_DEBUG`. |
| `bifrost.slowRequestMs` | number, minimum `0` | `2000` | Log LSP requests and notifications that take at least this many milliseconds. The extension passes this to the server as `BIFROST_LSP_SLOW_MS`. |
| `bifrost.extraArgs` | array of strings | `[]` | Extra command-line arguments, added after `--root <workspace-root>`. Blank entries are dropped. |
| `bifrost.roots` | array of strings | `[]` | Directories to index instead of the whole workspace. Relative paths are resolved against the workspace root. Empty means all workspace folders. |
| `bifrost.exclude` | array of strings | `[]` | Files or directories to leave out of indexing and LSP lookups. Relative paths are resolved against the workspace root. |
| `bifrost.formatterCommands` | array of formatter rules | `[]` | External formatter rules, in order. The extension reads this setting from user settings only. See [Formatter Rules](#formatter-rules). |
| `bifrost.unrecognizedSymbolDiagnostics` | boolean | `false` | Report symbols and members that Bifrost cannot resolve. Experimental; it can report false positives. |
| `bifrost.requireSuppressionReason` | boolean | `false` | Require a reason when you suppress a policy finding. Set it in workspace settings to make it a project rule. |

Changes to `bifrost.launchMode`, `bifrost.serverPath`, `bifrost.debug`,
`bifrost.slowRequestMs`, and `bifrost.extraArgs` need a server restart. The
extension asks whether to restart now.

Changes to `bifrost.roots`, `bifrost.exclude`, `bifrost.formatterCommands`,
and `bifrost.unrecognizedSymbolDiagnostics` do not cause a restart prompt. The
extension gives the current values to the server whenever the server asks for
the `bifrost` configuration section. If a change does not take effect, run
**Bifrost: Restart Language Server**.

For a large repository, limit indexing before you start the server:

```json
{
  "bifrost.roots": ["src", "tests"],
  "bifrost.exclude": ["target", "vendor/generated"]
}
```

### Formatter Rules

Each entry in `bifrost.formatterCommands` is an object with these fields. Only
`command` is required. Rules run without a shell. The formatter receives the
document text on stdin and must write the formatted document to stdout.

| Field | Type | Meaning |
| --- | --- | --- |
| `include` | array of strings | Workspace-relative glob patterns that this rule applies to. |
| `exclude` | array of strings | Workspace-relative glob patterns that this rule must not apply to. |
| `language` | string | Optional Bifrost language filter, such as `rust`, `go`, `typescript`, `java`, `csharp`, `php`, or `ruby`. |
| `command` | string | Executable name or path. It runs directly and is not parsed by a shell. |
| `args` | array of strings | Command arguments. Supports the placeholders `{file}`, `{relativeFile}`, `{workspaceRoot}`, and `{language}`. |
| `cwd` | string | Working directory for the formatter. A relative path is resolved against the workspace root. Supports the same placeholders. |

The extension ignores formatter rules in workspace or folder settings, because
a workspace could otherwise run any program. It writes a message to **Output >
Bifrost** when it ignores them.

## Commands

| Command | Command ID | What it does |
| --- | --- | --- |
| Bifrost: Start Language Server | `bifrost.startServer` | Start the server. |
| Bifrost: Stop Language Server | `bifrost.stopServer` | Stop the server. |
| Bifrost: Restart Language Server | `bifrost.restartServer` | Stop and start the server. |
| Bifrost: Show Output | `bifrost.showOutput` | Open **Output > Bifrost**, which shows the launch command, downloads, and server stderr. |
| Bifrost: Open MCP Setup | `bifrost.openMcpSetup` | Choose an MCP setup action. See [MCP Setup](#mcp-setup). |
| Bifrost: Copy MCP Config | `bifrost.copyMcpConfig` | Copy a generic `mcp.json` entry to the clipboard. |
| Bifrost: Run RQL Query | `bifrost.runRqlQuery` | Run the current `.rql` editor text. Available from the Play button in the editor title. |
| Bifrost: Run RQL Policy | `bifrost.runRqlPolicy` | Run the current `.rqlp` editor text. Available from the Play button and from the Command Palette in a `.rqlp` editor. |
| Bifrost: Clear Policy Results | `bifrost.clearRqlPolicyResults` | Clear **Bifrost Policy Results**. Available from that view's title bar. |
| Bifrost: Suppress finding... | `bifrost.suppressRqlPolicyFinding` | Write a suppression for a policy finding. Available from the context menu of a finding in **Bifrost Policy Results**. |
| Bifrost: Show Rune IR | `bifrost.showRuneIr` | Open the [Rune IR](https://bifrost.brokk.ai/rune-ir/) of the current source file, or of the selection, in a new untitled editor in **Bifrost Rune IR** mode. Available from the editor context menu and Command Palette. |
| Bifrost: Open RQL Query Result | `bifrost.openRqlQueryResult` | Open the source of a query result. Used by the results view. |
| Bifrost: Open RQL Policy Finding | `bifrost.openRqlPolicyFinding` | Open the source of a policy finding. Used by the results view. |
| Bifrost: Open RQL Policy Display Step | `bifrost.openRqlPolicyDisplayStep` | Open the source of one step of a finding's display path. Used by the results view. |

The last three commands are hidden from the Command Palette. The status bar
item shows the server state. Click it to start or restart the server.

## Views and Languages

The extension adds two views to the Explorer:

| View | Contents |
| --- | --- |
| **Bifrost Query Results** | Results of the last RQL query run, grouped by file. |
| **Bifrost Policy Results** | Completion state, findings, and suppression audit of RQL policy runs. |

It also adds three languages:

| Language | File extension | Purpose |
| --- | --- | --- |
| **Bifrost RQL** | `.rql` | [Rune Query Language](https://bifrost.brokk.ai/rune-query-language/) queries. |
| **Bifrost RQL Policy** | `.rqlp` | [Static-analysis policies](https://bifrost.brokk.ai/static-analysis-policies/) and policy endpoints. |
| **Bifrost Rune IR** | `.rune` | [Rune IR](https://bifrost.brokk.ai/rune-ir/) previews. |

Each language has syntax highlighting and its own file icon. The icon shows
when your icon theme has no more specific icon. If another extension claims
`.rql`, choose **Bifrost RQL** with VS Code's language-mode picker.

See [RQL in VS Code](./rql-vscode.md) for running queries and policies, and for
the features that need a running server.

## Workspace .gitignore

In version 0.12.1, the extension checks the workspace `.gitignore` for a line
that ignores all of `.bifrost`. If it finds one, it offers to replace that line
with `.bifrost/cache/`, so that project files under `.bifrost/` can be
committed. You can choose **Replace**, **Ask Again Later**, or **Don't Ask
Again**.

## MCP Setup

**Bifrost: Open MCP Setup** offers four actions:

- Copy a generic `mcp.json` entry.
- Copy a Codex CLI command: `codex mcp add bifrost -- <command>`.
- Copy a Claude Code command: `claude mcp add --scope user bifrost -- <command>`.
- Open the Bifrost MCP documentation.

The copied entry starts a separate MCP process for the current workspace:

```json
{
  "mcpServers": {
    "bifrost": {
      "command": "/path/to/bifrost",
      "args": ["--root", "/path/to/workspace", "--mcp", "searchtools"]
    }
  }
}
```

The commands run only when you choose them. The extension does not change
other programs' configuration files.

The extension fills in `command` from `bifrost.mcpServerPath`, which defaults
to `bifrost` on `PATH` and names a separately installed Bifrost CLI. The
managed `bifrost-lsp` binary supports LSP only. See
[Install](https://bifrost.brokk.ai/install/) for ways to install the CLI, and
[MCP](https://bifrost.brokk.ai/mcp/) for the toolsets.

The editor's language server and an agent's MCP server are separate
processes. Do not point an MCP host at the extension's language server.
Installing the extension does not give an agent the `query_code` tool. See
[MCP query and RQL availability](https://bifrost.brokk.ai/mcp/#query-and-rql-availability).
