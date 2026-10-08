use lsp_types::{GotoDefinitionParams, GotoDefinitionResponse, Location};

use crate::analyzer::{CodeUnit, Project, RustAnalyzer, WorkspaceAnalyzer, resolve_analyzer};
use crate::hash::HashSet;
use crate::lsp::handlers::type_target::{
    ImplementationMemberKind, ImplementationTargetKind, TypeTargetEligibility, resolve_type_target,
};
use crate::lsp::handlers::util::code_unit_location;

pub fn handle(
    workspace: &WorkspaceAnalyzer,
    project: &dyn Project,
    params: &GotoDefinitionParams,
) -> Option<GotoDefinitionResponse> {
    let analyzer = workspace.analyzer();
    let target = resolve_type_target(
        workspace,
        project,
        &params.text_document_position_params.text_document.uri,
        &params.text_document_position_params.position,
        TypeTargetEligibility::TypeDefinition,
    )?;
    let locations = locations_for_units(analyzer, project, target.units.into_iter());
    if locations.is_empty() {
        return None;
    }
    Some(GotoDefinitionResponse::Array(locations))
}

pub fn implementation(
    workspace: &WorkspaceAnalyzer,
    project: &dyn Project,
    params: &GotoDefinitionParams,
) -> Result<Option<GotoDefinitionResponse>, String> {
    let analyzer = workspace.analyzer();
    let Some(provider) = analyzer.type_hierarchy_provider() else {
        return Ok(None);
    };
    let Some(target) = resolve_type_target(
        workspace,
        project,
        &params.text_document_position_params.text_document.uri,
        &params.text_document_position_params.position,
        TypeTargetEligibility::Implementation,
    ) else {
        return Ok(None);
    };

    let target_units = target.units;
    let mut descendants = Vec::new();
    let mut seen = HashSet::default();
    for type_unit in &target_units {
        if !provider.supports_type_hierarchy(type_unit) {
            continue;
        }
        for descendant in provider.get_descendants(type_unit) {
            if seen.insert(descendant.clone()) {
                descendants.push(descendant);
            }
        }
    }

    let units: Vec<_> = match target.implementation_kind {
        ImplementationTargetKind::Type => descendants,
        ImplementationTargetKind::Member {
            declaration,
            name,
            kind,
        } => {
            if let Some(implementations) = rust_trait_member_implementations(
                analyzer,
                &target_units,
                declaration.as_ref(),
                &name,
                kind,
            )? {
                implementations
            } else {
                descendants
                    .into_iter()
                    .flat_map(|descendant| analyzer.direct_children(&descendant))
                    .filter(|child| implementation_member_matches(child, &name, kind))
                    .collect()
            }
        }
    };
    let locations = locations_for_units(analyzer, project, units.into_iter());
    if locations.is_empty() {
        return Ok(None);
    }
    Ok(Some(GotoDefinitionResponse::Array(locations)))
}

fn rust_trait_member_implementations(
    analyzer: &dyn crate::analyzer::IAnalyzer,
    target_units: &[CodeUnit],
    declaration: Option<&CodeUnit>,
    name: &str,
    kind: ImplementationMemberKind,
) -> Result<Option<Vec<CodeUnit>>, String> {
    let Some(rust) = resolve_analyzer::<RustAnalyzer>(analyzer) else {
        return Ok(None);
    };
    if let Some(member) = declaration
        && let Some(implementations) = rust
            .rust_trait_member_implementations(member)
            .map_err(|error| format!("Rust implementation query failed: {error:?}"))?
    {
        return Ok(Some(implementations));
    }

    for trait_unit in target_units {
        // An external impl target can be a namespace-only owner, not an
        // indexed declaration with a canonical source row.
        if !analyzer
            .declarations(trait_unit.source())
            .contains(trait_unit)
        {
            continue;
        }
        if !rust
            .is_rust_trait_declaration(trait_unit)
            .map_err(|error| format!("Rust implementation query failed: {error:?}"))?
        {
            continue;
        }
        for child in analyzer.direct_children(trait_unit) {
            if implementation_member_matches(&child, name, kind)
                && let Some(implementations) = rust
                    .rust_trait_member_implementations(&child)
                    .map_err(|error| format!("Rust implementation query failed: {error:?}"))?
            {
                return Ok(Some(implementations));
            }
        }
    }
    Ok(None)
}

fn implementation_member_matches(
    child: &CodeUnit,
    name: &str,
    kind: ImplementationMemberKind,
) -> bool {
    child.identifier() == name
        && match kind {
            ImplementationMemberKind::Method => child.is_function(),
            ImplementationMemberKind::Field => false,
        }
}

fn locations_for_units(
    analyzer: &dyn crate::analyzer::IAnalyzer,
    project: &dyn Project,
    units: impl Iterator<Item = CodeUnit>,
) -> Vec<Location> {
    units
        .filter_map(|unit| code_unit_location(analyzer, project, &unit))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::{CodeUnitType, Language, TestProject};
    use std::sync::Arc;

    #[test]
    fn rust_implementation_distinguishes_namespace_owners_from_declarations() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let file = crate::analyzer::ProjectFile::new(root.clone(), "lib.rs");
        file.write("pub trait Present {}\n").unwrap();
        let analyzer = RustAnalyzer::new(Arc::new(TestProject::new(root, Language::Rust)));
        let missing = CodeUnit::new(file, CodeUnitType::Class, "crate", "Missing");
        let error = analyzer.is_rust_trait_declaration(&missing).unwrap_err();
        assert!(format!("{error:?}").contains("Unavailable"));
        let implementations = rust_trait_member_implementations(
            &analyzer,
            &[missing],
            None,
            "method",
            ImplementationMemberKind::Method,
        )
        .unwrap();
        assert!(implementations.is_none());
    }
}
