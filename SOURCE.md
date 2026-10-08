# Rust host provenance

The initial Rust host source and crate-local tests were restored from
BrokkAi/bifrost-dev revision `112050770787f78b932ebae1bb3483e4c5999e4b`, before removal in
`4541130f99f9e428ff9b4db344f7cf1273a96768`. Every imported path was marked
`public` in that revision's reviewed `.open-core/public-paths.d/crates%2Fbifrost-lsp.tsv`
and covered by its public LSP source/test patterns. No repository-root private
fixtures, premium content, or private harnesses were imported. The standalone
repository owns subsequent adaptations, orchestration, and tests.

Local adaptation was validated against clean engine revision
`adef484da552bfc0896b057ae7efc2d53a671c9f` with an ignored Cargo path override.
The published 0.12.0 dependencies lack the profile, selected-root, and current analyzer APIs, so
this evidence does not qualify a registry-only build or a released server.

Validation on macOS/aarch64 with Rust 1.97.1:

- `cargo check --all-targets` and strict Clippy passed.
- 323 regular Rust tests and all 21 restored scheduled tests passed.
- Process tests verified profile/initialize identity, selected policy execution,
  selector errors, native semantic declaration hover after offline restart,
  incompatible bundle schema, corrupt bytes, and recorded policy hash rejection.
- The doctest target completed with zero doctests.
- Extension format/type/lint/build and 125 tests passed; release metadata tests
  passed 4 tests. Packaged helper/schema bytes and license files were verified.

The Bifrost MCP `bifrost.code-smells` check was unreliable: Python absent-member
analysis had no active declaration surface, and Go relational selections were
empty. Six informational parsing/serialization prompts included existing editor
fixtures/vendor content and per-package path encoding in the new helper.
No suppression or clean policy qualification was recorded.

The manual Linux workflow remains unexecuted. It requires an immutable reviewed
public engine revision, captures both source revisions and its resolved lock,
and uploads a qualification archive. Other-platform server archives and live
public pack release qualification remain release work.

## Bifrost 0.13.0 registry migration

The standalone host now pins the public crates.io `brokk-bifrost` 0.13.0
family, with registry sources and checksums retained in `Cargo.lock`.
No engine implementation was copied from a sibling repository. Adaptations
retain the new result-subject query variant, default Python runtime environment
configuration, and optional Java annotation provenance in editor transport.
The historical 0.12.0 local-override results above remain historical evidence;
release qualification uses the public registry dependency graph.

Current migration validation: registry-only all-target check and strict Clippy
passed. All 323 ordinary tests passed across the suite and focused schema-8
fixture rerun, along with 21 existing scheduled regressions and 132 extension
tests. The real server was accepted in an isolated VS Code profile; a fake
incompatible engine was shut down. Nine release-helper tests cover exact
metadata, complete checksums, archive extraction layout, and server/engine
evidence. Hosted platform builds remain separate qualification.

The current code-smell run remains unreliable: semantic provider async-contract
errors, partial/work-limited TypeScript proofs, and missing Python declaration
coverage prevent a clean assertion. Eight note-level loop prompts describe
per-message parsing, per-artifact reads and serialization. No suppression was
added and no clean policy result is claimed.
