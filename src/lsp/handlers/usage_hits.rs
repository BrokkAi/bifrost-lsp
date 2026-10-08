use crate::analyzer::usages::{
    DEFAULT_MAX_FILES, DEFAULT_MAX_USAGES, ExplicitCandidateProvider, FuzzyResult, QueryResult,
    UsageFinder, UsageHit, UsageProofAuthority, UsageQueryCompletion,
};
use crate::analyzer::{CodeUnit, IAnalyzer, ProjectFile};
use crate::cancellation::CancellationToken;
use crate::hash::HashSet;
use crate::lsp::request_context::RequestCancelled;
use lsp_server::{ErrorCode, ResponseError};
use std::sync::Arc;

pub(super) fn usage_hits_for_candidates_with_cancellation(
    analyzer: &dyn IAnalyzer,
    candidates: &[CodeUnit],
    cancellation: CancellationToken,
) -> Result<Vec<UsageHit>, ResponseError> {
    let query = UsageFinder::new().with_cancellation(cancellation).query(
        analyzer,
        candidates,
        DEFAULT_MAX_FILES,
        DEFAULT_MAX_USAGES,
    );
    complete_usage_hits(query)
}

pub(super) fn usage_hits_for_candidates_in_file(
    analyzer: &dyn IAnalyzer,
    candidates: &[CodeUnit],
    file: &ProjectFile,
) -> Result<Vec<UsageHit>, ResponseError> {
    let files: HashSet<ProjectFile> = [file.clone()].into_iter().collect();
    let provider = ExplicitCandidateProvider::new(Arc::new(files));
    let query = UsageFinder::new().query_with_provider(
        analyzer,
        candidates,
        Some(&provider),
        DEFAULT_MAX_FILES,
        DEFAULT_MAX_USAGES,
    );
    Ok(complete_usage_hits(query)?
        .into_iter()
        .filter(|hit| &hit.file == file)
        .collect())
}

fn complete_usage_hits(query: QueryResult) -> Result<Vec<UsageHit>, ResponseError> {
    match query.completion {
        UsageQueryCompletion::Cancelled => return Err(RequestCancelled.into()),
        UsageQueryCompletion::CandidateFilesBudgetExhausted
        | UsageQueryCompletion::SourceBytesBudgetExhausted => {
            return Err(ResponseError {
                code: ErrorCode::RequestFailed as i32,
                message: format!(
                    "Usage analysis did not complete: {:?}; result: {:?}",
                    query.completion, query.result
                ),
                data: None,
            });
        }
        UsageQueryCompletion::Complete => {}
    }
    // A native inventory certifies what it enumerated, so a site it retained as
    // unproven, a nonzero omitted total, or an ambiguous target group is a gap
    // in a list this boundary would otherwise publish as proven and complete.
    // A legacy language resolver never made that claim: its unproven and
    // editor-only candidates are the list it has always returned, and failing
    // the request instead would take references away from the editor.
    let can_publish = match (&query.result, query.proof_authority) {
        (
            FuzzyResult::Success { .. } | FuzzyResult::Ambiguous { .. },
            UsageProofAuthority::Legacy,
        ) => true,
        (
            FuzzyResult::Success {
                unproven_by_overload,
                unproven_total_by_overload,
                ..
            },
            UsageProofAuthority::Native,
        ) => {
            unproven_by_overload.values().all(|hits| hits.is_empty())
                && unproven_total_by_overload.values().all(|total| *total == 0)
        }
        (FuzzyResult::Ambiguous { .. }, UsageProofAuthority::Native) => false,
        (
            FuzzyResult::Incomplete { .. }
            | FuzzyResult::Failure { .. }
            | FuzzyResult::TooManyCallsites { .. },
            _,
        ) => false,
    };
    if !can_publish {
        return Err(ResponseError {
            code: ErrorCode::RequestFailed as i32,
            message: format!(
                "Usage analysis cannot produce a complete proven reference list: {:?}",
                query.result
            ),
            data: None,
        });
    }
    Ok(query
        .result
        .all_hits_including_imports()
        .into_iter()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::CodeUnitType;
    use crate::analyzer::usages::UsageAnalysisDiagnostic;
    use std::collections::BTreeSet;

    fn query(
        result: FuzzyResult,
        completion: UsageQueryCompletion,
        proof_authority: UsageProofAuthority,
    ) -> QueryResult {
        QueryResult {
            completion,
            candidate_files: HashSet::default(),
            candidate_files_truncated: false,
            source_bytes_truncated: false,
            scanned_source_bytes: 0,
            candidate_files_sample: None,
            result,
            proof_authority,
            graph_failure: None,
        }
    }

    /// The uncertain-candidate cases below, with the proof tiers a native
    /// inventory certifies: unproven only, mixed proven and unproven, an
    /// editor-only candidate that contributes no external total, and an
    /// omitted-sample total with no retained sites.
    fn uncertain_successes(
        target: &CodeUnit,
        proven: &UsageHit,
        unproven: &UsageHit,
    ) -> Vec<FuzzyResult> {
        [
            (BTreeSet::new(), BTreeSet::from([unproven.clone()]), 1),
            (
                BTreeSet::from([proven.clone()]),
                BTreeSet::from([unproven.clone()]),
                1,
            ),
            (
                BTreeSet::new(),
                BTreeSet::from([unproven.clone().into_import()]),
                0,
            ),
            (BTreeSet::new(), BTreeSet::new(), 1),
        ]
        .into_iter()
        .map(|(hits, candidates, total)| FuzzyResult::Success {
            hits_by_overload: [(target.clone(), hits)].into_iter().collect(),
            unproven_by_overload: [(target.clone(), candidates)].into_iter().collect(),
            unproven_total_by_overload: [(target.clone(), total)].into_iter().collect(),
        })
        .collect()
    }

    #[test]
    fn editor_usage_lists_require_complete_enumeration_even_with_proven_sites() {
        let file = ProjectFile::new(std::env::temp_dir(), "target.rs");
        let target = CodeUnit::new(file.clone(), CodeUnitType::Function, "", "target");
        let hit = UsageHit::new(file, 0, 0, 6, target.clone(), 1.0, "target");
        for authority in [UsageProofAuthority::Native, UsageProofAuthority::Legacy] {
            for hits in [BTreeSet::new(), BTreeSet::from([hit.clone()])] {
                let success = FuzzyResult::success(target.clone(), hits.clone());
                assert_eq!(
                    complete_usage_hits(query(success, UsageQueryCompletion::Complete, authority))
                        .unwrap(),
                    hits.iter().cloned().collect::<Vec<_>>()
                );
                let incomplete = FuzzyResult::Incomplete {
                    hits_by_overload: [(target.clone(), hits)].into_iter().collect(),
                    unproven_by_overload: Default::default(),
                    unproven_total_by_overload: Default::default(),
                    diagnostics: vec![UsageAnalysisDiagnostic {
                        fq_name: "target".to_string(),
                        strategy: "native_rust".to_string(),
                        reason_kind: "unsupported_reference".to_string(),
                        reason: "A reference cannot be enumerated".to_string(),
                    }],
                };
                let error = complete_usage_hits(query(
                    incomplete,
                    UsageQueryCompletion::Complete,
                    authority,
                ))
                .unwrap_err();
                assert_eq!(error.code, ErrorCode::RequestFailed as i32);
                assert!(error.message.contains("native_rust"));
                assert!(error.message.contains("unsupported_reference"));
                assert!(error.message.contains("A reference cannot be enumerated"));
            }
        }
    }

    #[test]
    fn editor_usage_lists_do_not_drop_unproven_or_ambiguous_native_evidence() {
        let file = ProjectFile::new(std::env::temp_dir(), "target.rs");
        let target = CodeUnit::new(file.clone(), CodeUnitType::Function, "", "target");
        let proven = UsageHit::new(file.clone(), 0, 0, 6, target.clone(), 1.0, "target");
        let mut unproven = UsageHit::new(file.clone(), 1, 10, 16, target.clone(), 0.0, "target");
        unproven.proof = crate::analyzer::usages::UsageProof::Unproven;
        for result in uncertain_successes(&target, &proven, &unproven) {
            let error = complete_usage_hits(query(
                result,
                UsageQueryCompletion::Complete,
                UsageProofAuthority::Native,
            ))
            .unwrap_err();
            assert_eq!(error.code, ErrorCode::RequestFailed as i32);
            assert!(error.message.contains("unproven_by_overload"));
            assert!(error.message.contains("unproven_total_by_overload"));
        }
        let alternative = CodeUnit::new(file, CodeUnitType::Function, "other", "target");
        let ambiguous = FuzzyResult::ambiguous(
            target.clone(),
            "target".to_string(),
            BTreeSet::from([target, alternative]),
            BTreeSet::from([proven]),
        );
        let error = complete_usage_hits(query(
            ambiguous,
            UsageQueryCompletion::Complete,
            UsageProofAuthority::Native,
        ))
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::RequestFailed as i32);
        assert!(error.message.contains("candidate_targets"));
        assert!(error.message.contains("other"));
    }

    /// A legacy language resolver never carried proof tiers, so the same
    /// answers stay the proven list the editor has always received.
    #[test]
    fn editor_usage_lists_publish_legacy_resolver_answers_unchanged() {
        let file = ProjectFile::new(std::env::temp_dir(), "target.rb");
        let target = CodeUnit::new(file.clone(), CodeUnitType::Function, "", "target");
        let proven = UsageHit::new(file.clone(), 0, 0, 6, target.clone(), 1.0, "target");
        let mut unproven = UsageHit::new(file.clone(), 1, 10, 16, target.clone(), 0.0, "target");
        unproven.proof = crate::analyzer::usages::UsageProof::Unproven;
        for result in uncertain_successes(&target, &proven, &unproven) {
            let expected = result
                .all_hits_including_imports()
                .into_iter()
                .collect::<Vec<_>>();
            assert_eq!(
                complete_usage_hits(query(
                    result,
                    UsageQueryCompletion::Complete,
                    UsageProofAuthority::Legacy,
                ))
                .unwrap(),
                expected
            );
        }
        let alternative = CodeUnit::new(file, CodeUnitType::Function, "other", "target");
        let ambiguous = FuzzyResult::ambiguous(
            target.clone(),
            "target".to_string(),
            BTreeSet::from([target, alternative]),
            BTreeSet::from([proven.clone()]),
        );
        assert_eq!(
            complete_usage_hits(query(
                ambiguous,
                UsageQueryCompletion::Complete,
                UsageProofAuthority::Legacy,
            ))
            .unwrap(),
            vec![proven]
        );
    }

    #[test]
    fn editor_usage_lists_preserve_execution_terminal_errors() {
        let cancelled = complete_usage_hits(query(
            FuzzyResult::empty_success(),
            UsageQueryCompletion::Cancelled,
            UsageProofAuthority::Legacy,
        ))
        .unwrap_err();
        assert_eq!(cancelled.code, ErrorCode::RequestCanceled as i32);
        let bounded = complete_usage_hits(query(
            FuzzyResult::empty_success(),
            UsageQueryCompletion::CandidateFilesBudgetExhausted,
            UsageProofAuthority::Legacy,
        ))
        .unwrap_err();
        assert_eq!(bounded.code, ErrorCode::RequestFailed as i32);
        assert!(bounded.message.contains("CandidateFilesBudgetExhausted"));
    }
}
