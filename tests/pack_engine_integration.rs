mod common;

use brokk_bifrost_analysis::analyzer::{
    canonical_hash::{lower_hex_string, sha256_bytes},
    semantic_model::{
        CATALOG_SCHEMA_VERSION, CatalogOpenMode, CatalogOptions, SEMANTIC_MODEL_SCHEMA_VERSION,
        SemanticPackCatalog,
    },
};
use brokk_bifrost_policy::{
    CatalogRegistryLimits, PolicyRegistry, PolicyRegistryLimits, PolicySourceIdentity,
    TaintCatalogRegistry,
};
use common::lsp_client::{LspServer, server_binary, uri_for};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
};
use tempfile::TempDir;

const POLICY_PACK_ID: &str = "fixture.open";
const POLICY_ID: &str = "fixture.open.avoid-target";
const POLICY_PATH: &str = "policies/selected.rqlp";
const POLICY_SOURCE: &str = r#"(policy
  :schema-version 1
  :id "fixture.open.avoid-target"
  :name "Avoid target"
  :message "Avoid declaring target"
  :severity warning
  :analysis
    (analysis
      :type match
      :selector
        (rql :schema-version 1
          (language typescript (function :name "target")))))"#;

fn profile() -> Value {
    let output = Command::new(server_binary())
        .arg("pack-engine-profile")
        .output()
        .expect("run pack-engine-profile");
    assert!(
        output.status.success(),
        "pack-engine-profile failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("profile JSON")
}

fn isolated_server_command(root: &Path, cache_root: &Path) -> Command {
    let mut command = Command::new(server_binary());
    command
        .arg("--root")
        .arg(root)
        .arg("--server")
        .arg("lsp")
        .stdin(Stdio::null())
        .env("BIFROST_SEMANTIC_PACK_CACHE_ROOT", cache_root)
        .env_remove("BIFROST_OPEN_SEMANTIC_PACK_BUNDLE")
        .env_remove("BIFROST_OPEN_POLICY_PACK_ROOT");
    command
}

fn authored_policy_hash(source: &str) -> String {
    let catalogs = Arc::new(TaintCatalogRegistry::new_without_workspace(
        CatalogRegistryLimits::default(),
    ));
    let mut registry =
        PolicyRegistry::new_without_workspace(catalogs, PolicyRegistryLimits::default());
    registry
        .register_policy_bytes_deferred(
            PolicySourceIdentity::new(format!("builtin:{POLICY_PACK_ID}/{POLICY_PATH}")),
            source.as_bytes(),
        )
        .expect("parse selected policy fixture")
        .semantic_hash()
        .to_string()
}

fn write_policy_pack(root: &Path) -> PathBuf {
    let policy_root = root.join(POLICY_PACK_ID);
    let source_path = policy_root.join(POLICY_PATH);
    fs::create_dir_all(source_path.parent().expect("policy parent"))
        .expect("create policy source directory");
    fs::write(&source_path, POLICY_SOURCE).expect("write selected policy source");
    let manifest = json!({
        "schema_version": 2,
        "id": POLICY_PACK_ID,
        "version": "0.1.0",
        "name": "Portable LSP fixture",
        "description": "A small authored policy used to test selected policy roots.",
        "policies": [{
            "path": POLICY_PATH,
            "id": POLICY_ID,
            "authored_hash": authored_policy_hash(POLICY_SOURCE),
            "resolved_semantic_hash": authored_policy_hash(POLICY_SOURCE),
            "category": "correctness",
            "supported_languages": ["typescript"],
            "required_capabilities": ["structural-match"],
            "severity_rationale": "The fixture checks that the selected policy source is evaluated.",
            "remediation": "Rename the fixture function."
        }]
    });
    fs::write(
        policy_root.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest).expect("serialize policy manifest"),
    )
    .expect("write policy manifest");
    policy_root
}

fn release_bundle(root: &Path, bifrost_requirement: &str) -> PathBuf {
    let activation = json!([{}]);
    let measurement_activation = json!({});
    let compatibility = json!({
        "bifrost": bifrost_requirement,
        "toolchains": []
    });
    let provenance = json!({
        "source": "https://example.invalid/fixture/widget",
        "revision": "lsp-integration-fixture"
    });
    let safety = json!({
        "generated_code_only": false,
        "review_required": false
    });
    let authored = json!({
        "schema_version": SEMANTIC_MODEL_SCHEMA_VERSION,
        "pack_id": "fixture.lsp.widget",
        "version": "1.0.0",
        "producer": { "name": "bifrost-lsp-fixture", "version": "1.0.0" },
        "language": "go",
        "ecosystem": "go",
        "compatibility": compatibility,
        "provenance": provenance,
        "license": "Apache-2.0",
        "completeness": "complete",
        "safety": safety,
        "shards": [{
            "id": "fixture.widget.declarations",
            "activation": activation,
            "payload": {
                "kind": "declaration_facts",
                "types": [{
                    "id": "type.fixture.widget",
                    "name": "fixture.example/widget.Widget",
                    "type_kind": "struct",
                    "visibility": "public",
                    "locator": {
                        "kind": "artifact",
                        "path": "fixture/widget.go",
                        "symbol": "fixture.example/widget.Widget"
                    }
                }],
                "members": [],
                "relations": []
            }
        }]
    });
    let artifact_bytes = serde_json::to_vec(&authored).expect("serialize authored fixture");
    let artifact_digest = lower_hex_string(&sha256_bytes(&artifact_bytes));
    let artifact_path = root.join("authored.json");
    let spec_path = root.join("fixture.spec.json");
    fs::write(&artifact_path, &artifact_bytes).expect("write authored fixture");
    fs::write(
        root.join("NOTICE.txt"),
        "Standalone LSP integration fixture.\n",
    )
    .expect("write fixture notice");

    let spec = json!({
        "schema_version": 1,
        "pack_id": "fixture.lsp.widget",
        "pack_version": "1.0.0",
        "ecosystem": "go",
        "kind": { "artifact_kind": "authored_semantic_model" },
        "artifact": {
            "file_name": "authored.json",
            "sha256": artifact_digest,
            "url": "https://example.invalid/fixture/widget.json",
            "container": null
        },
        "compatibility": compatibility,
        "activation": activation,
        "provenance": provenance,
        "license": "Apache-2.0",
        "safety": safety,
        "notices": ["NOTICE.txt"],
        "measurement_activation": measurement_activation,
        "measurement_queries": [{ "kind": "type", "name": "fixture.example/widget.Widget" }]
    });
    fs::write(
        &spec_path,
        serde_json::to_vec_pretty(&spec).expect("serialize release spec"),
    )
    .expect("write release spec");

    let bundle_root = root.join("bundle");
    brokk_bifrost_semantic_packs::release_bundle::generate_release_bundle(
        &bundle_root,
        &[brokk_bifrost_semantic_packs::release_bundle::BundleInput {
            spec_path,
            artifact_path,
        }],
    )
    .expect("generate native semantic-pack release fixture");
    bundle_root
}

fn installed_fixture_pack(cache_root: &Path) -> Value {
    let catalog_root = cache_root.join(format!("semantic-pack-catalog.v{CATALOG_SCHEMA_VERSION}"));
    let catalog = SemanticPackCatalog::open(
        &catalog_root,
        CatalogOpenMode::ReadOnly,
        CatalogOptions::default(),
    )
    .expect("open server-created semantic-pack catalog");
    let inventory = catalog
        .inventory_bounded(16)
        .expect("read installed semantic-pack inventory");
    assert!(inventory.complete, "fixture inventory must be complete");
    serde_json::to_value(
        inventory
            .packs
            .into_iter()
            .find(|pack| pack.pack_id == "fixture.lsp.widget")
            .expect("selected fixture pack was installed"),
    )
    .expect("serialize fixture inventory row")
}

#[test]
fn profile_matches_the_real_server_identity_negotiated_during_initialize() {
    let profile = profile();
    let engine_version = profile["engine_version"]
        .as_str()
        .expect("profile engine_version");
    assert!(
        !profile["build_identity"]
            .as_str()
            .unwrap_or_default()
            .is_empty()
    );
    assert_eq!(profile["capability_contract_version"], 1);
    assert_eq!(profile["model_set_sha256"].as_str().unwrap().len(), 64);
    assert!(profile["schemas"].is_object());
    assert!(profile["capabilities"].as_array().is_some());

    let version_output = Command::new(server_binary())
        .arg("--version")
        .output()
        .expect("run standalone server --version");
    assert!(version_output.status.success());
    assert_eq!(
        String::from_utf8(version_output.stdout)
            .expect("version output UTF-8")
            .trim(),
        format!("bifrost-lsp {}", env!("CARGO_PKG_VERSION"))
    );

    let root = TempDir::new().expect("workspace root");
    let server = LspServer::start(root.path());
    let initialize = server.initialize_response();
    assert!(initialize["error"].is_null(), "{initialize}");
    assert_eq!(
        initialize["result"]["capabilities"]["experimental"]["bifrost"]["protocolVersion"],
        1
    );
    assert_eq!(
        initialize["result"]["capabilities"]["experimental"]["bifrost"]["engineVersion"],
        engine_version,
        "profile and initialize must identify the exact same engine build"
    );
    server.shutdown();
}

#[test]
fn selected_policy_root_lists_and_runs_its_policy_in_the_real_lsp_process() {
    let root = TempDir::new().expect("workspace root");
    let policy_root = TempDir::new().expect("selected policy cache");
    write_policy_pack(policy_root.path());
    fs::create_dir_all(root.path().join("policies")).expect("create workspace policy directory");
    fs::write(root.path().join("policies/selected.rqlp"), "")
        .expect("write workspace policy placeholder");
    fs::write(
        root.path().join("app.ts"),
        "export function target(): void {}\nexport function targetNearMiss(): void {}\n",
    )
    .expect("write workspace source");

    let environment = vec![(
        "BIFROST_OPEN_POLICY_PACK_ROOT".to_owned(),
        policy_root.path().to_string_lossy().into_owned(),
    )];
    let mut server = LspServer::start_with_env(root.path(), &environment);
    let listed = server.request("bifrost/listPolicies", json!({}));
    assert!(listed["error"].is_null(), "{listed}");
    assert_eq!(listed["result"]["packs"].as_array().unwrap().len(), 1);
    assert_eq!(listed["result"]["packs"][0]["id"], POLICY_PACK_ID);
    assert_eq!(listed["result"]["packs"][0]["policies"][0]["id"], POLICY_ID);

    let result = server.request(
        "bifrost/runPolicy",
        json!({
            "documentUri": uri_for(&root.path().join("policies/selected.rqlp")),
            "evaluationDate": "2026-10-01",
            "policyId": POLICY_ID
        }),
    );
    assert!(result["error"].is_null(), "{result}");
    assert_eq!(
        result["result"]["report"]["rules"][0]["policy_id"],
        POLICY_ID
    );
    assert_eq!(
        result["result"]["report"]["runs"][0]["policy_id"],
        POLICY_ID
    );
    assert_eq!(
        result["result"]["report"]["runs"][0]["completion"]["type"],
        "complete"
    );
    assert_eq!(
        result["result"]["report"]["runs"][0]["findings"]
            .as_array()
            .unwrap()
            .len(),
        1,
        "the selected external source must actually be evaluated"
    );
    for params in [
        json!({"documentUri": uri_for(&root.path().join("policies/selected.rqlp")), "evaluationDate": "2026-10-01", "policyId": "unknown.policy"}),
        json!({"documentUri": uri_for(&root.path().join("policies/selected.rqlp")), "evaluationDate": "2026-10-01", "policyId": POLICY_ID, "source": POLICY_SOURCE}),
    ] {
        let invalid = server.request("bifrost/runPolicy", params);
        assert_eq!(invalid["error"]["code"], -32602, "{invalid}");
        assert!(invalid["result"].is_null(), "{invalid}");
    }
    server.shutdown();
}

#[test]
fn corrupt_selected_policy_source_fails_closed_before_the_lsp_session_starts() {
    let selected_root = TempDir::new().expect("selected policy cache");
    let pack_root = write_policy_pack(selected_root.path());
    fs::write(pack_root.join(POLICY_PATH), [0xff]).expect("corrupt selected policy source");
    let workspace = TempDir::new().expect("workspace root");
    let cache = TempDir::new().expect("isolated semantic cache");
    let output = isolated_server_command(workspace.path(), cache.path())
        .env("BIFROST_OPEN_POLICY_PACK_ROOT", selected_root.path())
        .output()
        .expect("start server with corrupt selected policy source");
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("cannot read configured policy source"),
        "the selected policy root must report its corrupt source: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn compatible_selected_semantic_bundle_is_installed_and_reused_offline() {
    let profile = profile();
    let version = profile["engine_version"].as_str().expect("engine version");
    let compatibility = format!(">={version}, <0.13.0");
    let fixture = TempDir::new().expect("release fixture");
    let bundle = release_bundle(fixture.path(), &compatibility);
    let cache = TempDir::new().expect("persistent semantic cache");
    let workspace = TempDir::new().expect("workspace root");
    fs::write(
        workspace.path().join("go.mod"),
        "module fixture.example/app\n\ngo 1.22\n",
    )
    .expect("write Go dependency fixture");
    fs::write(
        workspace.path().join("main.go"),
        "package main\nimport widget \"fixture.example/widget\"\nvar value widget.Widget\n",
    )
    .expect("write Go source fixture");
    fs::create_dir_all(workspace.path().join(".bifrost")).expect("create Bifrost config");
    fs::write(
        workspace.path().join(".bifrost/packs.json"),
        r#"{"schema_version":1,"ecosystems":["go"]}"#,
    )
    .expect("select Go pack activation");
    let environment = vec![
        (
            "BIFROST_OPEN_SEMANTIC_PACK_BUNDLE".to_owned(),
            bundle.to_string_lossy().into_owned(),
        ),
        (
            "BIFROST_SEMANTIC_PACK_CACHE_ROOT".to_owned(),
            cache.path().to_string_lossy().into_owned(),
        ),
    ];

    let mut first = LspServer::start_with_env(workspace.path(), &environment);
    assert_modeled_widget(&mut first, workspace.path());
    first.shutdown();
    let first_inventory = installed_fixture_pack(cache.path());
    assert_eq!(first_inventory["pack_version"], "1.0.0");
    assert_eq!(first_inventory["state"], "verified");

    let mut second = LspServer::start_with_env(workspace.path(), &environment);
    assert_modeled_widget(&mut second, workspace.path());
    second.shutdown();
    assert_eq!(installed_fixture_pack(cache.path()), first_inventory);
}

#[test]
fn incompatible_schema_or_corrupt_selected_semantic_bundle_is_rejected_before_initialize() {
    let incompatible_root = TempDir::new().expect("incompatible fixture");
    let incompatible_bundle = release_bundle(incompatible_root.path(), ">=0.12.0, <0.13.0");
    let index_path = incompatible_bundle.join("index.json");
    let mut index: Value = serde_json::from_slice(&fs::read(&index_path).unwrap()).unwrap();
    index["schema_version"] = json!(999);
    fs::write(index_path, serde_json::to_vec(&index).unwrap()).unwrap();
    let incompatible_workspace = TempDir::new().expect("workspace root");
    let incompatible_cache = TempDir::new().expect("semantic cache");
    let incompatible =
        isolated_server_command(incompatible_workspace.path(), incompatible_cache.path())
            .env("BIFROST_OPEN_SEMANTIC_PACK_BUNDLE", incompatible_bundle)
            .output()
            .expect("start server with incompatible semantic bundle");
    assert!(!incompatible.status.success());
    assert!(
        String::from_utf8_lossy(&incompatible.stderr)
            .contains("unsupported release bundle schema 999"),
        "incompatible content must fail closed: {}",
        String::from_utf8_lossy(&incompatible.stderr)
    );

    let corrupt_root = TempDir::new().expect("corrupt fixture");
    let corrupt_bundle = release_bundle(corrupt_root.path(), ">=0.12.0, <0.13.0");
    let index: Value = serde_json::from_slice(
        &fs::read(corrupt_bundle.join("index.json")).expect("read generated release index"),
    )
    .expect("parse generated release index");
    let manifest_path = index["packs"][0]["manifest"]["path"]
        .as_str()
        .expect("release manifest path");
    fs::write(corrupt_bundle.join(manifest_path), b"corrupt manifest")
        .expect("corrupt indexed release content");
    let corrupt_workspace = TempDir::new().expect("workspace root");
    let corrupt_cache = TempDir::new().expect("semantic cache");
    let corrupt = isolated_server_command(corrupt_workspace.path(), corrupt_cache.path())
        .env("BIFROST_OPEN_SEMANTIC_PACK_BUNDLE", corrupt_bundle)
        .output()
        .expect("start server with corrupt semantic bundle");
    assert!(!corrupt.status.success());
    assert!(
        String::from_utf8_lossy(&corrupt.stderr)
            .contains("failed to install configured open semantic packs"),
        "corrupt release bytes must fail closed: {}",
        String::from_utf8_lossy(&corrupt.stderr)
    );
}

fn assert_modeled_widget(server: &mut LspServer, root: &Path) {
    let response = server.request(
        "textDocument/hover",
        json!({
            "textDocument": {"uri": uri_for(&root.join("main.go"))},
            "position": {"line": 2, "character": 19}
        }),
    );
    assert!(response["error"].is_null(), "{response}");
    assert!(
        response["result"]["contents"]["value"]
            .as_str()
            .is_some_and(|text| text.contains("fixture.example/widget.Widget")),
        "selected semantic declaration must be queryable: {response}"
    );
}

#[test]
fn changed_catalog_semantic_hash_is_rejected_before_initialize() {
    let root = TempDir::new().unwrap();
    let selected_root = TempDir::new().unwrap();
    let pack_root = write_policy_pack(selected_root.path());
    let path = pack_root.join("manifest.json");
    let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["policies"][0]["resolved_semantic_hash"] = json!("0".repeat(64));
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let cache = TempDir::new().unwrap();
    let output = isolated_server_command(root.path(), cache.path())
        .env("BIFROST_OPEN_POLICY_PACK_ROOT", selected_root.path())
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("but the manifest records"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
