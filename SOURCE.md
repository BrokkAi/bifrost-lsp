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
