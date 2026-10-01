use std::sync::Arc;

use lsp_types::{Position, Uri};

use crate::analyzer::declaration_range::code_unit_declaration_name_range;
use crate::analyzer::lexical_definitions::LexicalDefinition;
use crate::analyzer::usages::get_definition::{
    DefinitionLookupRequest, DefinitionLookupStatus, NavigationTarget,
    navigation_declaration_site_at_offset, navigation_declaration_site_targets,
    resolve_definition_batch_with_source, resolve_navigation_batch_with_source,
};
use crate::analyzer::{CodeUnit, IAnalyzer, Project, ProjectFile, Range as ByteRange};
use crate::lsp::conversion::position_to_byte_offset;
use crate::lsp::handlers::import_ambiguity::is_ambiguous_imported_reference;
use crate::lsp::handlers::util::{identifier_span_at_offset, read_document_for_uri};
use crate::navigation::NavigationOperation;

pub(super) struct BroadSymbolTarget {
    pub(super) file: ProjectFile,
    pub(super) content: String,
    pub(super) line_starts: Vec<usize>,
    pub(super) start_byte: usize,
    pub(super) end_byte: usize,
    pub(super) candidates: Vec<CodeUnit>,
    pub(super) navigation_targets: Vec<NavigationTarget>,
    pub(super) lexical_definition: Option<LexicalDefinition>,
    /// Whether the selected route proved its answer exhaustive. A `false`
    /// answer is still the locations the route found; the surface that has a
    /// channel for doubt says so rather than staying silent.
    pub(super) complete: bool,
}

pub(super) struct ModeledSymbolTarget {
    pub(super) content: String,
    pub(super) line_starts: Vec<usize>,
    pub(super) start_byte: usize,
    pub(super) end_byte: usize,
    pub(super) symbol: crate::analyzer::semantic_model::SemanticModelSymbol,
}

#[derive(Clone, Copy)]
enum TargetResolution {
    Broad,
    Navigation(NavigationOperation),
}

pub(super) fn broad_symbol_target_at_position(
    analyzer: &dyn IAnalyzer,
    project: &dyn Project,
    uri: &Uri,
    position: &Position,
) -> Option<BroadSymbolTarget> {
    symbol_target_at_position(analyzer, project, uri, position, TargetResolution::Broad)
}

pub(super) fn navigation_target_at_position(
    analyzer: &dyn IAnalyzer,
    project: &dyn Project,
    uri: &Uri,
    position: &Position,
    operation: NavigationOperation,
) -> Option<BroadSymbolTarget> {
    symbol_target_at_position(
        analyzer,
        project,
        uri,
        position,
        TargetResolution::Navigation(operation),
    )
}

pub(super) fn modeled_symbol_target_at_position(
    analyzer: &dyn IAnalyzer,
    project: &dyn Project,
    uri: &Uri,
    position: &Position,
) -> Option<ModeledSymbolTarget> {
    let (file, content, line_starts) = read_document_for_uri(project, uri)?;
    let byte_offset = position_to_byte_offset(&content, &line_starts, position);
    let (start_byte, end_byte) = identifier_span_at_offset(&content, byte_offset)?;
    reject_ambiguous_import(analyzer, &file, &content, start_byte, end_byte)?;
    let outcome = resolve_definition_batch_with_source(
        analyzer,
        vec![DefinitionLookupRequest {
            file: file.clone(),
            line: None,
            column: None,
            start_byte: Some(start_byte),
            end_byte: Some(end_byte),
        }],
        file.clone(),
        Arc::from(content.as_str()),
    )
    .into_iter()
    .next()?;
    let target = outcome.resolved_reference_target()?;
    let overlay = analyzer.semantic_model_overlay()?;
    let matched = overlay.symbols_named(target);
    if matched.disposition
        != crate::analyzer::semantic_model::SemanticModelOverlayDisposition::Unique
        || !matched.records[0].externally_visible()
    {
        return None;
    }
    Some(ModeledSymbolTarget {
        content,
        line_starts,
        start_byte,
        end_byte,
        symbol: matched.records[0].clone(),
    })
}

fn symbol_target_at_position(
    analyzer: &dyn IAnalyzer,
    project: &dyn Project,
    uri: &Uri,
    position: &Position,
    resolution: TargetResolution,
) -> Option<BroadSymbolTarget> {
    let (file, content, line_starts) = read_document_for_uri(project, uri)?;
    let byte_offset = position_to_byte_offset(&content, &line_starts, position);
    let (start_byte, end_byte) = identifier_span_at_offset(&content, byte_offset)?;
    let selected = ByteRange {
        start_byte,
        end_byte,
        start_line: 0,
        end_line: 0,
    };
    let declaration =
        selected_code_unit_declaration_at_cursor(analyzer, &file, &content, &selected, |_| true)
            .or_else(|| match resolution {
                TargetResolution::Navigation(_) => {
                    navigation_declaration_site_at_offset(analyzer, &file, &content, start_byte)
                }
                TargetResolution::Broad => None,
            });
    let answer = match resolution {
        TargetResolution::Broad => declaration
            .map(|declaration| ResolvedSymbolAnswer {
                candidates: vec![declaration],
                navigation_targets: Vec::new(),
                lexical_definition: None,
                complete: true,
            })
            .or_else(|| {
                reject_ambiguous_import(analyzer, &file, &content, start_byte, end_byte)?;
                resolved_target(
                    analyzer,
                    &file,
                    Arc::from(content.as_str()),
                    start_byte,
                    end_byte,
                    resolution,
                )
            })?,
        TargetResolution::Navigation(operation) => {
            reject_ambiguous_import(analyzer, &file, &content, start_byte, end_byte)?;
            match resolved_target(
                analyzer,
                &file,
                Arc::from(content.as_str()),
                start_byte,
                end_byte,
                resolution,
            ) {
                Some(answer) => answer,
                None => {
                    let navigation_targets =
                        navigation_declaration_site_targets(analyzer, declaration?, operation);
                    if navigation_targets.is_empty() {
                        return None;
                    }
                    let candidates = navigation_targets
                        .iter()
                        .map(|target| target.code_unit.clone())
                        .collect();
                    ResolvedSymbolAnswer {
                        candidates,
                        navigation_targets,
                        lexical_definition: None,
                        complete: true,
                    }
                }
            }
        }
    };

    Some(BroadSymbolTarget {
        file,
        content,
        line_starts,
        start_byte,
        end_byte,
        candidates: answer.candidates,
        navigation_targets: answer.navigation_targets,
        lexical_definition: answer.lexical_definition,
        complete: answer.complete,
    })
}

fn reject_ambiguous_import(
    analyzer: &dyn IAnalyzer,
    file: &ProjectFile,
    content: &str,
    start_byte: usize,
    end_byte: usize,
) -> Option<()> {
    let identifier = content.get(start_byte..end_byte)?;
    (!is_ambiguous_imported_reference(analyzer, file, identifier)).then_some(())
}

pub(super) fn selected_code_unit_declaration_at_cursor(
    analyzer: &dyn IAnalyzer,
    file: &ProjectFile,
    content: &str,
    cursor_range: &ByteRange,
    predicate: impl Fn(&CodeUnit) -> bool,
) -> Option<CodeUnit> {
    if let Some(code_unit) = analyzer.enclosing_code_unit(file, cursor_range)
        && code_unit.source() == file
        && predicate(&code_unit)
        && let Some(selection) =
            code_unit_declaration_name_range(analyzer, file, content, &code_unit)
        && cursor_range.start_byte >= selection.start_byte
        && cursor_range.start_byte < selection.end_byte
    {
        return Some(code_unit);
    }

    analyzer
        .declarations(file)
        .into_iter()
        .filter(|code_unit| code_unit.source() == file && predicate(code_unit))
        .filter(|code_unit| {
            analyzer.ranges(code_unit).iter().any(|range| {
                cursor_range.start_byte >= range.start_byte
                    && cursor_range.start_byte < range.end_byte
            })
        })
        .filter_map(|code_unit| {
            let selection = code_unit_declaration_name_range(analyzer, file, content, &code_unit)?;
            (cursor_range.start_byte >= selection.start_byte
                && cursor_range.start_byte < selection.end_byte)
                .then_some((selection.end_byte - selection.start_byte, code_unit))
        })
        .min_by_key(|(name_len, code_unit)| {
            (
                *name_len,
                analyzer
                    .ranges(code_unit)
                    .iter()
                    .map(|range| range.end_byte.saturating_sub(range.start_byte))
                    .min()
                    .unwrap_or(usize::MAX),
            )
        })
        .map(|(_, code_unit)| code_unit)
}

/// What one lookup answered for the cursor.
///
/// `complete` is the answer's own exhaustiveness, not whether anything was
/// found: an `incomplete` status carries real definitions under an open gap,
/// and the surface that has a channel for doubt reports it there.
struct ResolvedSymbolAnswer {
    candidates: Vec<CodeUnit>,
    navigation_targets: Vec<NavigationTarget>,
    lexical_definition: Option<LexicalDefinition>,
    complete: bool,
}

fn resolved_target(
    analyzer: &dyn IAnalyzer,
    file: &ProjectFile,
    content: Arc<str>,
    start_byte: usize,
    end_byte: usize,
    resolution: TargetResolution,
) -> Option<ResolvedSymbolAnswer> {
    let requests = vec![DefinitionLookupRequest {
        file: file.clone(),
        line: None,
        column: None,
        start_byte: Some(start_byte),
        end_byte: Some(end_byte),
    }];
    match resolution {
        TargetResolution::Broad => {
            let outcome =
                resolve_definition_batch_with_source(analyzer, requests, file.clone(), content)
                    .into_iter()
                    .next()?;
            if !outcome.status.carries_definitions()
                || (outcome.definitions.is_empty() && outcome.lexical_definition.is_none())
            {
                return None;
            }
            Some(ResolvedSymbolAnswer {
                candidates: outcome.definitions,
                navigation_targets: Vec::new(),
                lexical_definition: outcome.lexical_definition,
                complete: outcome.status != DefinitionLookupStatus::Incomplete,
            })
        }
        TargetResolution::Navigation(operation) => {
            let outcome = resolve_navigation_batch_with_source(
                analyzer,
                requests,
                file.clone(),
                content,
                operation,
            )
            .into_iter()
            .next()?;
            if !(outcome.status.carries_definitions()
                || outcome.status == DefinitionLookupStatus::Ambiguous)
                || (outcome.targets.is_empty() && outcome.lexical_definition.is_none())
            {
                return None;
            }
            let candidates = outcome
                .targets
                .iter()
                .map(|target| target.code_unit.clone())
                .collect();
            Some(ResolvedSymbolAnswer {
                candidates,
                navigation_targets: outcome.targets,
                lexical_definition: outcome.lexical_definition,
                complete: outcome.status != DefinitionLookupStatus::Incomplete,
            })
        }
    }
}
