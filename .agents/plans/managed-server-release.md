# Qualify managed standalone LSP on Bifrost 0.13.0

User requested a version of the LSP that manages Bifrost versions on 2026-10-08.
Current AGENTS instructions authorize branch updates, push and ready PR delivery;
merges remain user-controlled. Keep the existing feature branch and all three
prepared server/pack commits, rebased onto current main.

The LSP links an exact engine version. Manage server/engine pairings as verified
standalone binaries. Keep server 0.1.0, extension 0.12.0, engine 0.13.0 independent.
Require actual profile and initialize identity and public registry-only builds.

Primary owns Cargo metadata, Rust adaptation/tests, docs and manifest. Luna
lifecycle worker owns provisioning/lifecycle/extension and focused tests. Luna
release worker owns server workflows and artifact helper scripts. Preserve
concurrent edits; use two local Cargo workers after contention inspection.

Progress:
- [x] Inspect branch, clean state, remotes, source provenance and prepared work.
- [x] Fetch/rebase existing branch onto origin/main, preserving prepared commits.
- [x] Resolve public 0.13.0 crate graph; pass registry-only check and strict Clippy.
- [x] Pass 323 ordinary tests across full suite and schema-8 fixture rerun.
- [x] Pass 21 existing scheduled regressions and 132 frontend tests.
- [x] Respect update preferences and use separate CLI for MCP setup.
- [x] Add gated five-platform release archives, exact evidence and registry CI.
- [x] Verify editor accepts the real server and rejects an incompatible engine.
- [ ] Push ready PR and monitor exact-head CI/review.

Discovery: schema 8 deliberately forbids compatibility.bifrost; valid fixtures
use schema support, retaining incompatible-schema and corrupt-content checks.
Registry engine build_identity is unknown; preserve Cargo.lock registry checksums
as exact engine artifact provenance, not a fabricated engine commit identity.

Protected release environment remains an explicit gate. Do not claim marketplace
publication or installable managed downloads before actual server assets and VSIX.
