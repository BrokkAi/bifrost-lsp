use lsp_server::{ErrorCode, ResponseError};
use std::collections::BTreeMap;
use std::sync::Arc;

use lsp_types::{
    CallHierarchyIncomingCall, CallHierarchyIncomingCallsParams, CallHierarchyItem,
    CallHierarchyOutgoingCall, CallHierarchyOutgoingCallsParams, CallHierarchyPrepareParams,
    Position, Range as LspRange, Uri,
};

use crate::analyzer::usages::get_definition::{
    DefinitionLookupRequest, resolve_call_reference_definition_with_source,
};
use crate::analyzer::usages::{
    CallRelationResult, CallRelationService, DEFAULT_MAX_FILES, DEFAULT_MAX_USAGES, UsageProof,
    UsageProofAuthority, is_call_relation_unit, nearest_call_relation_unit,
};
use crate::analyzer::{
    AnalyzerQueryScope, CodeUnit, IAnalyzer, Project, ProjectFile, Range, WorkspaceAnalyzer,
};
use crate::lsp::conversion::{
    byte_range_to_lsp_range, path_to_uri_string, position_to_byte_offset,
};
use crate::lsp::handlers::document_symbol::lsp_symbol_parts;
use crate::lsp::handlers::hierarchy_support::{
    cursor_byte_range, hierarchy_item_data, resolve_hierarchy_item_code_unit,
};
use crate::lsp::handlers::util::{FileContentCache, read_document_for_uri};
use crate::lsp::request_context::RequestCancelled;
use brokk_bifrost_analysis::analyzer::QueryScope;

pub fn prepare(
    workspace: &WorkspaceAnalyzer,
    project: &dyn Project,
    params: &CallHierarchyPrepareParams,
) -> Option<Vec<CallHierarchyItem>> {
    let analyzer = workspace.analyzer();
    let _query_scope = AnalyzerQueryScope::new(analyzer);
    let uri = &params.text_document_position_params.text_document.uri;
    let (file, content, line_starts) = read_document_for_uri(project, uri)?;
    let offset = position_to_byte_offset(
        &content,
        &line_starts,
        &params.text_document_position_params.position,
    );
    let range = cursor_byte_range(&content, offset);
    let callable = prepare_target_at_cursor(
        analyzer,
        &file,
        &content,
        &line_starts,
        &params.text_document_position_params.position,
        &range,
    )?;

    let mut content_cache = FileContentCache::default();
    Some(vec![
        call_hierarchy_item(analyzer, project, &callable, &mut content_cache).ok()?,
    ])
}

fn prepare_target_at_cursor(
    analyzer: &dyn IAnalyzer,
    file: &crate::analyzer::ProjectFile,
    content: &str,
    line_starts: &[usize],
    position: &Position,
    range: &Range,
) -> Option<CodeUnit> {
    declaration_target_at_cursor(analyzer, file, content, line_starts, position, range)
        .or_else(|| call_reference_target_at_cursor(analyzer, file, content, range))
}

fn declaration_target_at_cursor(
    analyzer: &dyn IAnalyzer,
    file: &crate::analyzer::ProjectFile,
    content: &str,
    line_starts: &[usize],
    position: &Position,
    range: &Range,
) -> Option<CodeUnit> {
    let enclosing = analyzer.enclosing_code_unit(file, range)?;
    let callable = nearest_call_relation_unit(analyzer, enclosing)?;
    if callable.source() != file {
        return None;
    }
    let parts = lsp_symbol_parts(analyzer, &callable, content, line_starts, None);
    lsp_range_contains_position(&parts.selection_range, position).then_some(callable)
}

fn call_reference_target_at_cursor(
    analyzer: &dyn IAnalyzer,
    file: &crate::analyzer::ProjectFile,
    content: &str,
    range: &Range,
) -> Option<CodeUnit> {
    if range.start_byte >= range.end_byte {
        return None;
    }

    let outcome = resolve_call_reference_definition_with_source(
        analyzer,
        DefinitionLookupRequest {
            file: file.clone(),
            line: None,
            column: None,
            start_byte: Some(range.start_byte),
            end_byte: Some(range.end_byte),
        },
        file.clone(),
        Arc::from(content),
    )?;
    if !outcome.status.carries_definitions() {
        return None;
    }
    outcome
        .definitions
        .into_iter()
        .find_map(|definition| nearest_call_relation_unit(analyzer, definition))
}

fn lsp_range_contains_position(range: &LspRange, position: &Position) -> bool {
    compare_lsp_position(position, &range.start) != std::cmp::Ordering::Less
        && compare_lsp_position(position, &range.end) == std::cmp::Ordering::Less
}

fn compare_lsp_position(left: &Position, right: &Position) -> std::cmp::Ordering {
    left.line
        .cmp(&right.line)
        .then_with(|| left.character.cmp(&right.character))
}

pub fn incoming_calls(
    workspace: &WorkspaceAnalyzer,
    project: &dyn Project,
    params: &CallHierarchyIncomingCallsParams,
) -> Result<Option<Vec<CallHierarchyIncomingCall>>, ResponseError> {
    let scope = AnalyzerQueryScope::new(workspace.analyzer());
    let token = scope.token();
    let analyzer = workspace.analyzer();
    let _query_scope = AnalyzerQueryScope::new(analyzer);
    let Some(target) = resolve_item_code_unit(analyzer, project, &params.item) else {
        return Ok(None);
    };

    let relation = CallRelationService::incoming(
        analyzer,
        token,
        &target,
        DEFAULT_MAX_FILES,
        DEFAULT_MAX_USAGES,
    );
    require_complete_call_relation(&relation)?;

    let mut grouped: BTreeMap<String, (CodeUnit, Vec<LspRange>)> = BTreeMap::new();
    let mut content_cache = FileContentCache::default();
    for site in relation.sites {
        if site.proof != UsageProof::Proven {
            continue;
        }
        let range = source_range(project, &site.file, &site.callee_range, &mut content_cache)?;
        grouped
            .entry(unit_key(&site.caller))
            .or_insert_with(|| (site.caller, Vec::new()))
            .1
            .push(range);
    }

    let mut calls = Vec::with_capacity(grouped.len());
    for (caller, mut from_ranges) in grouped.into_values() {
        from_ranges.sort_by(compare_lsp_range);
        from_ranges.dedup();
        calls.push(CallHierarchyIncomingCall {
            from: call_hierarchy_item(analyzer, project, &caller, &mut content_cache)?,
            from_ranges,
        });
    }
    Ok(Some(calls))
}

pub fn outgoing_calls(
    workspace: &WorkspaceAnalyzer,
    project: &dyn Project,
    params: &CallHierarchyOutgoingCallsParams,
) -> Result<Option<Vec<CallHierarchyOutgoingCall>>, ResponseError> {
    let scope = AnalyzerQueryScope::new(workspace.analyzer());
    let token = scope.token();
    let analyzer = workspace.analyzer();
    let _query_scope = AnalyzerQueryScope::new(analyzer);
    let Some(caller) = resolve_item_code_unit(analyzer, project, &params.item) else {
        return Ok(None);
    };
    if !is_call_relation_unit(&caller) {
        return Ok(Some(Vec::new()));
    }
    let relation = CallRelationService::outgoing(analyzer, token, &caller, DEFAULT_MAX_USAGES);
    require_complete_call_relation(&relation)?;

    let mut grouped: BTreeMap<String, (CodeUnit, Vec<LspRange>)> = BTreeMap::new();
    let mut content_cache = FileContentCache::default();
    for site in relation.sites {
        if site.proof != UsageProof::Proven {
            continue;
        }
        let range = source_range(project, &site.file, &site.callee_range, &mut content_cache)?;
        grouped
            .entry(unit_key(&site.callee))
            .or_insert_with(|| (site.callee, Vec::new()))
            .1
            .push(range);
    }

    let mut calls = Vec::with_capacity(grouped.len());
    for (callee, mut from_ranges) in grouped.into_values() {
        from_ranges.sort_by(compare_lsp_range);
        from_ranges.dedup();
        calls.push(CallHierarchyOutgoingCall {
            to: call_hierarchy_item(analyzer, project, &callee, &mut content_cache)?,
            from_ranges,
        });
    }
    Ok(Some(calls))
}

fn require_complete_call_relation(relation: &CallRelationResult) -> Result<(), ResponseError> {
    if relation.cancelled {
        return Err(RequestCancelled.into());
    }
    // A native provider's diagnostics record incomplete enumeration or an
    // ambiguous target in an inventory it certifies, and the proven-only LSP
    // projection would omit exactly those sites, so the request fails instead.
    // A legacy resolver reports the same conditions alongside the list it has
    // always answered with, and the hierarchy projects it as before.
    if relation.proof_authority == UsageProofAuthority::Legacy {
        return Ok(());
    }
    if relation.truncated || !relation.diagnostics.is_empty() {
        return Err(ResponseError {
            code: ErrorCode::RequestFailed as i32,
            message: format!(
                "Call analysis did not complete: truncated={}, diagnostics={:?}",
                relation.truncated, relation.diagnostics
            ),
            data: None,
        });
    }
    Ok(())
}

fn source_range(
    project: &dyn Project,
    file: &ProjectFile,
    range: &Range,
    cache: &mut FileContentCache,
) -> Result<LspRange, ResponseError> {
    let entry = cache
        .read_project(project, file)
        .ok_or_else(|| source_read_failed(file, "call site location"))?;
    Ok(byte_range_to_lsp_range(
        &entry.body,
        &entry.line_starts,
        range,
    ))
}

fn call_hierarchy_item(
    analyzer: &dyn IAnalyzer,
    project: &dyn Project,
    code_unit: &CodeUnit,
    cache: &mut FileContentCache,
) -> Result<CallHierarchyItem, ResponseError> {
    let entry = cache
        .read_project(project, code_unit.source())
        .ok_or_else(|| source_read_failed(code_unit.source(), "call hierarchy item"))?;
    let parts = lsp_symbol_parts(analyzer, code_unit, &entry.body, &entry.line_starts, None);
    let uri: Uri = path_to_uri_string(&code_unit.source().abs_path())
        .parse()
        .map_err(|error| source_read_failed(code_unit.source(), &format!("URI: {error}")))?;

    Ok(CallHierarchyItem {
        name: parts.name,
        kind: parts.kind,
        tags: None,
        detail: parts.detail,
        uri: uri.clone(),
        range: parts.range,
        selection_range: parts.selection_range,
        data: Some(hierarchy_item_data(analyzer, code_unit, &uri)),
    })
}

fn source_read_failed(file: &ProjectFile, detail: &str) -> ResponseError {
    ResponseError {
        code: ErrorCode::RequestFailed as i32,
        message: format!(
            "Call hierarchy locations could not be completed for {}: {detail}",
            file.rel_path().display()
        ),
        data: None,
    }
}

fn resolve_item_code_unit(
    analyzer: &dyn IAnalyzer,
    project: &dyn Project,
    item: &CallHierarchyItem,
) -> Option<CodeUnit> {
    resolve_hierarchy_item_code_unit(analyzer, project, item.data.as_ref(), &item.uri, |unit| {
        is_call_relation_unit(unit)
    })
}

fn unit_key(unit: &CodeUnit) -> String {
    format!(
        "{}\0{}\0{:?}\0{}",
        unit.source().rel_path().display(),
        unit.fq_name(),
        unit.kind(),
        unit.signature().unwrap_or("")
    )
}

fn compare_lsp_range(left: &LspRange, right: &LspRange) -> std::cmp::Ordering {
    compare_lsp_position(&left.start, &right.start)
        .then_with(|| compare_lsp_position(&left.end, &right.end))
}

#[cfg(test)]
mod completion_tests {
    use super::*;
    use crate::analyzer::usages::get_definition::CallSyntaxKind;
    use crate::analyzer::usages::{CallRelationDiagnostic, CallRelationDiagnosticCode, CallSite};
    use crate::analyzer::{CodeUnitType, FileSetProject};

    #[test]
    fn hierarchy_rejects_native_semantic_gaps_and_ambiguous_unproven_sites() {
        let mut relation = CallRelationResult {
            proof_authority: UsageProofAuthority::Native,
            ..CallRelationResult::default()
        };
        assert!(require_complete_call_relation(&relation).is_ok());
        relation.diagnostics.push(CallRelationDiagnostic {
            code: CallRelationDiagnosticCode::TargetsAmbiguous,
            message: "Targets remain ambiguous".to_string(),
            context: "target".to_string(),
            reason_kind: None,
        });
        let file = ProjectFile::new(std::env::temp_dir(), "ambiguous.rs");
        let caller = CodeUnit::new(file.clone(), CodeUnitType::Function, "", "caller");
        let callee = CodeUnit::new(file.clone(), CodeUnitType::Function, "", "target");
        let range = Range {
            start_byte: 0,
            end_byte: 6,
            start_line: 0,
            end_line: 0,
        };
        relation.sites.push(CallSite {
            file,
            range,
            callee_range: range,
            caller,
            callee,
            kind: CallSyntaxKind::Function,
            proof: UsageProof::Unproven,
            receiver: None,
            arguments: Vec::new(),
        });
        let ambiguous_error = require_complete_call_relation(&relation).unwrap_err();
        assert_eq!(ambiguous_error.code, ErrorCode::RequestFailed as i32);
        assert!(ambiguous_error.message.contains("Targets remain ambiguous"));
        relation.diagnostics.push(CallRelationDiagnostic {
            code: CallRelationDiagnosticCode::AnalysisFailed,
            message: "native incomplete reference enumeration".to_string(),
            context: "target".to_string(),
            reason_kind: Some("semantic_incomplete".to_string()),
        });
        let error = require_complete_call_relation(&relation).unwrap_err();
        assert_eq!(error.code, ErrorCode::RequestFailed as i32);
        assert!(
            error
                .message
                .contains("native incomplete reference enumeration")
        );
        assert!(error.message.contains("semantic_incomplete"));
        relation.cancelled = true;
        assert_eq!(
            require_complete_call_relation(&relation).unwrap_err().code,
            ErrorCode::RequestCanceled as i32
        );
    }

    /// A legacy resolver's omission and ambiguity advisories travel with the
    /// list it has always answered with, so the hierarchy still projects it.
    /// Cancellation is an execution outcome, not a proof claim, and still ends
    /// the request.
    #[test]
    fn hierarchy_projects_legacy_resolver_relations_with_their_diagnostics() {
        let mut relation = CallRelationResult {
            truncated: true,
            diagnostics: vec![
                CallRelationDiagnostic {
                    code: CallRelationDiagnosticCode::CandidatesOmitted,
                    message: "omitted 1 unresolved call candidate for E.iMethod".to_string(),
                    context: "E.iMethod".to_string(),
                    reason_kind: None,
                },
                CallRelationDiagnostic {
                    code: CallRelationDiagnosticCode::TargetsAmbiguous,
                    message: "Targets remain ambiguous".to_string(),
                    context: "E.iMethod".to_string(),
                    reason_kind: None,
                },
            ],
            ..CallRelationResult::default()
        };
        assert_eq!(relation.proof_authority, UsageProofAuthority::Legacy);
        assert!(require_complete_call_relation(&relation).is_ok());
        relation.cancelled = true;
        assert_eq!(
            require_complete_call_relation(&relation).unwrap_err().code,
            ErrorCode::RequestCanceled as i32
        );
    }

    #[test]
    fn missing_call_site_source_fails_the_hierarchy_request() {
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().to_path_buf();
        let file = ProjectFile::new(root_path.clone(), "Missing.java");
        let project = FileSetProject::new(root_path, [std::path::PathBuf::from("Missing.java")]);
        let range = Range {
            start_byte: 0,
            end_byte: 6,
            start_line: 0,
            end_line: 0,
        };

        let error =
            source_range(&project, &file, &range, &mut FileContentCache::default()).unwrap_err();

        assert_eq!(error.code, ErrorCode::RequestFailed as i32);
        assert!(error.message.contains("Missing.java"));
    }
}
