use lsp_server::{ErrorCode, ResponseError};
use lsp_types::{Location, ReferenceParams, Uri};

use crate::analyzer::usages::UsageHit;
use crate::analyzer::{Project, Range as ByteRange, WorkspaceAnalyzer};
use crate::lsp::conversion::{byte_range_to_lsp_range, path_to_uri_string};
use crate::lsp::handlers::broad_symbol::broad_symbol_target_at_position;
use crate::lsp::handlers::usage_hits::usage_hits_for_candidates_with_cancellation;
use crate::lsp::handlers::util::{
    FileContentCache, code_unit_location_from_content, python_model_reference_ranges,
    python_model_symbol_at_offset, read_document_for_uri,
};
use crate::lsp::request_context::RequestContext;

/// Resolve `textDocument/references`. Strategy:
/// 1. Prove the cursor is on a real declaration or structured reference.
/// 2. Run UsageFinder over the workspace.
/// 3. Map each UsageHit to an LSP Location.
/// 4. Optionally include the declaration site itself when
///    `params.context.include_declaration` is true.
pub fn handle(
    workspace: &WorkspaceAnalyzer,
    project: &dyn Project,
    params: &ReferenceParams,
    context: &RequestContext,
) -> Result<Option<Vec<Location>>, lsp_server::ResponseError> {
    context.check_cancelled()?;
    let uri = &params.text_document_position.text_document.uri;
    let analyzer = workspace.analyzer();
    let Some(target) = broad_symbol_target_at_position(
        analyzer,
        project,
        uri,
        &params.text_document_position.position,
    ) else {
        return model_references_at_position(analyzer, project, params, context);
    };
    context.check_cancelled()?;
    context.report("Searching workspace");

    let mut content_cache = FileContentCache::default();
    // `UsageHit::is_lsp_reference_site` excludes `Self`-type-alias occurrences:
    // `Self` names the enclosing type without writing its name, so
    // rust-analyzer's find-references and this server's contract both exclude
    // it from the editor list. Rename filters through the same predicate so
    // the two surfaces cannot drift apart on it.
    let hits = usage_hits_for_candidates_with_cancellation(
        analyzer,
        &target.candidates,
        context.cancellation_token(),
    )?
    .into_iter()
    .filter(UsageHit::is_lsp_reference_site);
    context.check_cancelled()?;
    context.report("Preparing locations");
    let mut locations = usage_hits_to_locations(project, hits, &mut content_cache, context)?;

    if params.context.include_declaration {
        for cu in &target.candidates {
            context.check_cancelled()?;
            let entry = content_cache
                .read_project(project, cu.source())
                .ok_or_else(|| source_read_failed(cu.source(), "declaration location"))?;
            let location = code_unit_location_from_content(
                analyzer,
                cu.source(),
                &entry.body,
                &entry.line_starts,
                cu,
            )
            .ok_or_else(|| source_read_failed(cu.source(), "declaration URI"))?;
            locations.push(location);
        }
    }

    if locations.is_empty()
        && let Some(locations) = model_references_at_position(analyzer, project, params, context)?
    {
        return Ok(Some(locations));
    }

    context.check_cancelled()?;
    locations.sort_by(|a, b| {
        a.uri
            .as_str()
            .cmp(b.uri.as_str())
            .then_with(|| a.range.start.line.cmp(&b.range.start.line))
            .then_with(|| a.range.start.character.cmp(&b.range.start.character))
    });
    locations.dedup_by(|a, b| a.uri.as_str() == b.uri.as_str() && a.range == b.range);
    context.check_cancelled()?;

    Ok(Some(locations))
}

fn model_references_at_position(
    analyzer: &dyn crate::analyzer::IAnalyzer,
    project: &dyn Project,
    params: &ReferenceParams,
    context: &RequestContext,
) -> Result<Option<Vec<Location>>, ResponseError> {
    let uri = &params.text_document_position.text_document.uri;
    let (file, source, line_starts) = match read_document_for_uri(project, uri) {
        Some(document) => document,
        None => return Ok(None),
    };
    let offset = crate::lsp::conversion::position_to_byte_offset(
        &source,
        &line_starts,
        &params.text_document_position.position,
    );
    let Some(overlay) = analyzer.semantic_model_overlay() else {
        return Ok(None);
    };
    let Some(symbol) = python_model_symbol_at_offset(&overlay, &file, &source, offset) else {
        return Ok(None);
    };
    let mut locations = Vec::new();
    let files = project
        .all_files()
        .map_err(|error| source_enumeration_failed(&error))?;
    for candidate in files {
        context.check_cancelled()?;
        if candidate
            .rel_path()
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("py")
        {
            continue;
        }
        let content = project
            .read_source(&candidate)
            .map_err(|error| source_read_failed(&candidate, &error.to_string()))?;
        let starts = crate::text_utils::compute_line_starts(&content);
        let parsed_uri: Uri = path_to_uri_string(&candidate.abs_path())
            .parse()
            .map_err(|error| source_read_failed(&candidate, &format!("URI: {error}")))?;
        locations.extend(
            python_model_reference_ranges(&content, &symbol.qualified_name)
                .into_iter()
                .map(|range| Location {
                    uri: parsed_uri.clone(),
                    range: byte_range_to_lsp_range(&content, &starts, &range),
                }),
        );
    }
    locations.sort_by(|a, b| {
        a.uri
            .as_str()
            .cmp(b.uri.as_str())
            .then_with(|| a.range.start.line.cmp(&b.range.start.line))
            .then_with(|| a.range.start.character.cmp(&b.range.start.character))
    });
    locations.dedup_by(|a, b| a.uri.as_str() == b.uri.as_str() && a.range == b.range);
    Ok(Some(locations))
}

fn usage_hits_to_locations(
    project: &dyn Project,
    hits: impl IntoIterator<Item = UsageHit>,
    cache: &mut FileContentCache,
    context: &RequestContext,
) -> Result<Vec<Location>, ResponseError> {
    let mut locations = Vec::new();
    for hit in hits {
        context.check_cancelled()?;
        locations.push(usage_hit_to_location(project, &hit, cache)?);
    }
    Ok(locations)
}

fn usage_hit_to_location(
    project: &dyn Project,
    hit: &UsageHit,
    cache: &mut FileContentCache,
) -> Result<Location, ResponseError> {
    let abs_path = hit.file.abs_path();
    let entry = cache
        .read_project(project, &hit.file)
        .ok_or_else(|| source_read_failed(&hit.file, "usage location source"))?;
    let range = ByteRange {
        start_byte: hit.start_offset,
        end_byte: hit.end_offset,
        start_line: hit.line,
        end_line: hit.line,
    };
    let lsp_range = byte_range_to_lsp_range(&entry.body, &entry.line_starts, &range);
    let uri: Uri = path_to_uri_string(&abs_path)
        .parse()
        .map_err(|error| source_read_failed(&hit.file, &format!("URI: {error}")))?;
    Ok(Location {
        uri,
        range: lsp_range,
    })
}

fn source_enumeration_failed(error: &std::io::Error) -> ResponseError {
    ResponseError {
        code: ErrorCode::RequestFailed as i32,
        message: format!("Python modeled reference enumeration did not complete: {error}"),
        data: None,
    }
}

fn source_read_failed(file: &crate::analyzer::ProjectFile, detail: &str) -> ResponseError {
    ResponseError {
        code: ErrorCode::RequestFailed as i32,
        message: format!(
            "Reference locations could not be completed for {}: {detail}",
            file.rel_path().display()
        ),
        data: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::{CodeUnit, CodeUnitType, FileSetProject, ProjectFile};
    use crate::cancellation::CancellationToken;
    use std::path::PathBuf;
    use std::sync::Arc;

    #[test]
    fn pre_cancelled_mapping_discards_analyzer_hits() {
        let root = std::env::temp_dir();
        let file = ProjectFile::new(root.clone(), PathBuf::from("Target.java"));
        let enclosing = CodeUnit::new(file.clone(), CodeUnitType::Function, "pkg", "Target.call");
        let hit = UsageHit::new(file, 0, 0, 6, enclosing, 1.0, "Target");
        let project = FileSetProject::new(root, [PathBuf::from("Target.java")]);
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        let context = RequestContext::new(
            cancellation,
            None,
            "Finding references",
            "Resolving symbol",
            Arc::new(|_| Ok(())),
        );

        let result =
            usage_hits_to_locations(&project, [hit], &mut FileContentCache::default(), &context);

        assert_eq!(
            result.unwrap_err().code,
            lsp_server::ErrorCode::RequestCanceled as i32
        );
    }

    #[test]
    fn missing_usage_source_fails_the_reference_request() {
        let root = tempfile::tempdir().unwrap();
        let root_path = root.path().to_path_buf();
        let file = ProjectFile::new(root_path.clone(), PathBuf::from("Missing.java"));
        let enclosing = CodeUnit::new(file.clone(), CodeUnitType::Function, "pkg", "Target.call");
        let hit = UsageHit::new(file.clone(), 0, 0, 6, enclosing, 1.0, "target");
        let project = FileSetProject::new(root_path, [PathBuf::from("Missing.java")]);

        let error =
            usage_hit_to_location(&project, &hit, &mut FileContentCache::default()).unwrap_err();

        assert_eq!(error.code, lsp_server::ErrorCode::RequestFailed as i32);
        assert!(error.message.contains("Missing.java"));
    }
}
