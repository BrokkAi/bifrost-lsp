# Restore the standalone Bifrost LSP host

## Purpose

This repository will own the Rust LSP dispatcher, editor overlay orchestration,
handlers, and public crate-local tests. Bifrost remains an external engine.
The server must expose its exact linked engine profile and activate compatible
verified open semantic and policy content selected by the extension.

## Progress

- [x] Inspect clean current branch and retain dave/ovsx-trusted-publishing.
- [x] Locate deletion 4541130f99 and restore 40 public source/test paths from
  its parent 112050770787f78b932ebae1bb3483e4c5999e4b. Verify each import against
  the reviewed public inventory; record provenance in SOURCE.md.
- [x] Add standalone Cargo package/binary with independent 0.1.0 server version.
- [x] Delegate tests/** and a bounded handler review without overlapping edits.
- [x] Wire exact engine profile, initialize identity, selected root validation,
  explicit semantic bootstrap, catalog listing, and policy execution by ID.
- [x] Adapt current-engine API and behavior mismatches.
- [x] Verify real process profile, handshake, native semantic activation and
  selected policy execution, offline reuse, incompatible and corrupt content.
- [x] Add reproducible engine override and Rust CI/build instructions.
- [x] Run Rust formatting, tests, strict Clippy, extension and packaging gates.
- [x] Commit owned changes; preserve publication boundaries.

## Context and implementation

The deleted crate was an internal protocol host depending on analysis, flow,
policy, RQL, and runtime packages. Restore those dependencies as public registry
coordinates, plus the Bifrost facade for exact profile and reviewed pack
bootstrap. Pin the engine package versions; do not infer capabilities. Local
validation uses an ignored .cargo/local-engine.toml patch against the handoff
engine worktree at adef484da552bfc0896b057ae7efc2d53a671c9f. Never commit its
private path or repository coordinate. The server binary accepts --root and
legacy --lsp/--server lsp launch arguments, exits for pack-engine-profile and
--version, and keeps utility stdout separate from framed LSP output.

Explicit bundles are validated before opening the session and installed through
the shared engine catalog bootstrap during workspace activation. The background
activation must include that same route on subsequent generations so it cannot
overwrite selected model proof. Keep .bifrost/packs.json review controls and typed
incompleteness. Policy root discovery uses the engine catalog once before first
request; bifrost/listPolicies returns its public manifest, and bifrost/runPolicy
selects exactly one of editor source or policyId while preserving workspace root
validation and canonical policy reports.

## Validation

Use cargo --config .cargo/local-engine.toml for current-engine validation,
JAVA_HOME empty, BIFROST_PARALLELISM=1, RAYON_NUM_THREADS=1. Run fmt, check
--all-targets, focused real-server regressions, restored LSP suites via nextest
--max-fail 100, doctests, and strict clippy --all-targets. Run npm test in
editors/vscode and verify packaged helper/schema bytes. A local fixture is
behavior evidence, not live pack release qualification. Check published engine
availability and keep missing APIs or incompatible public releases explicit.

## Discoveries

The current standalone remote contains only extension source. Current engine
master removed its host. The historical crate was public with public tests,
but private root corpora remain excluded. Initial compilation found added RQL
result variants and updated semantic evidence/row-projection fields; no handler
compile errors. Engine bootstrap is shared through analysis despite the facade
registering it via MCP; the LSP can invoke the same catalog path directly.

## Decisions

User explicitly authorized restoration here on 2026-10-01. Keep server version
0.1.0 from the extension contract, engine version 0.12.0 from the exact package,
and extension version 0.12.0 independent. Use linked-engine profile APIs; do not
construct a synthetic production profile. Preserve existing editor-source policy
execution and add catalog selection without duplicating policy catalog loading.

## Outcomes

Local restoration validation passed: 323 ordinary Rust tests, 21 scheduled
regressions, strict Clippy, formatting, all-targets check, and zero doctests.
Extension 125 tests and release metadata 4 tests passed; packaged helper/schema
bytes and licenses matched. Native fixtures prove selected model hover after
offline restart, policy findings and selector rejection, incompatible schemas,
corrupt inputs, and semantic hash rejection. Public inventory review verified
all historical imported source/test paths.

Registry-only cargo check --locked --all-targets fails against published 0.12.0
with missing profile, selected-root, and current analyzer APIs. The exact local
validation lock is retained separately; Git keeps registry package provenance.
A new compatible published engine release and pin update remain required.
Manual Linux qualification is unexecuted and other server archive targets are
still release work. MCP code-smell checking is unreliable because Python
declaration coverage is absent; empty Go selections are not proof. Six
informational parsing/serialization prompts were reviewed without suppressions.

No branch change, push, PR, release,
publication, or deployment is authorized by this preparation handoff.
