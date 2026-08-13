export type Blinded100Category = 'pain' | 'desired_outcome' | 'objection' | 'emotion' | 'other'
export type Blinded100Gold = {
  id: string
  category: Blinded100Category
  topicGroup: string
  mergeGroup: string
  topicCues: string[]
}
export type Blinded100PairGold = {
  pairId: string
  leftId: string
  rightId: string
  expectedMerge: boolean
  rationale: string
}

const topics = [
  { topicGroup: 'invoice_tax_clarity', topicCues: ['invoice', 'tax', 'billing'], intervention: 'correct and explain invoice tax calculation' },
  { topicGroup: 'mobile_project_search', topicCues: ['mobile', 'search', 'header'], intervention: 'keep project search visible and reachable on mobile' },
  { topicGroup: 'report_export_stall', topicCues: ['export', 'pdf', 'report'], intervention: 'make report export complete and return its PDF' },
  { topicGroup: 'support_resolution_quality', topicCues: ['support', 'repair', 'answer', 'resolution'], intervention: 'supply a concrete recovery procedure for the reported failure' },
  { topicGroup: 'compile_upload_progress', topicCues: ['compile', 'upload', 'build', 'progress'], intervention: 'show build and upload stage progress' },
  { topicGroup: 'guided_onboarding', topicCues: ['setup', 'onboarding', 'step', 'milestone'], intervention: 'guide setup with ordered steps and milestones' },
  { topicGroup: 'accessible_status_labels', topicCues: ['status', 'label', 'color', 'severity'], intervention: 'pair status colors with readable text or icons' },
  { topicGroup: 'offline_draft_sync', topicCues: ['offline', 'draft', 'sync', 'connection'], intervention: 'retain offline drafts and synchronize them after reconnection' },
  { topicGroup: 'migration_history_risk', topicCues: ['migration', 'history', 'notes', 'switch'], intervention: 'guarantee history preservation during migration' },
  { topicGroup: 'annual_contract_exit', topicCues: ['contract', 'annual', 'cancel', 'exit'], intervention: 'state annual renewal and cancellation terms before purchase' },
  { topicGroup: 'remote_local_write_permission', topicCues: ['remote', 'local', 'write', 'permission'], intervention: 'require explicit permission before remote work writes locally' },
  { topicGroup: 'trial_price_uncertainty', topicCues: ['trial', 'price', 'pricing', 'analyst'], intervention: 'state how collaborators change trial and post-trial pricing' },
  { topicGroup: 'save_confirmation_anxiety', topicCues: ['save', 'confirmation', 'saved', 'editor'], intervention: 'show an unambiguous save confirmation' },
  { topicGroup: 'silent_command_frustration', topicCues: ['command', 'terminal', 'shell', 'response'], intervention: 'show progress or failure for a long-running command' },
  { topicGroup: 'workspace_deletion_fear', topicCues: ['delete', 'deletion', 'workspace', 'preview'], intervention: 'preview affected workspace records before deletion' },
  { topicGroup: 'refund_relief', topicCues: ['refund', 'relief', 'repayment', 'payment'], intervention: 'complete and confirm the delayed refund' },
  { topicGroup: 'retention_policy_definition', topicCues: ['retention', 'archive', 'backup', 'deleted'], intervention: 'document retention triggers, scope, and expiry' },
  { topicGroup: 'plan_feature_facts', topicCues: ['plan', 'tier', 'subscription', 'pricing'], intervention: 'maintain a plan comparison that states feature availability' },
  { topicGroup: 'product_terminology', topicCues: ['term', 'meaning', 'scope', 'glossary'], intervention: 'maintain a glossary with bounded product definitions' },
  { topicGroup: 'compliance_scope_facts', topicCues: ['processor', 'legal', 'region', 'security'], intervention: 'publish legal-role and regional-processing scope' },
] as const

// Categories and merge groups are authored for each comment, independent of
// runtime output. Topic cues are shared only for lexical-coherence scoring.
const assignments: Array<readonly [string, Blinded100Category, string]> = [
  ['blind-001', 'pain', 'invoice_tax_clarity'],
  ['blind-002', 'pain', 'mobile_project_search'],
  ['blind-003', 'pain', 'report_export_stall'],
  ['blind-004', 'pain', 'support_import_recovery'],
  ['blind-005', 'desired_outcome', 'compile_upload_progress'],
  ['blind-006', 'desired_outcome', 'guided_onboarding'],
  ['blind-007', 'desired_outcome', 'accessible_status_labels_request'],
  ['blind-008', 'desired_outcome', 'offline_draft_sync'],
  ['blind-009', 'objection', 'migration_history_risk'],
  ['blind-010', 'objection', 'annual_contract_exit'],
  ['blind-011', 'objection', 'remote_local_write_permission'],
  ['blind-012', 'objection', 'trial_price_uncertainty'],
  ['blind-013', 'emotion', 'save_confirmation_anxiety'],
  ['blind-014', 'emotion', 'silent_command_frustration'],
  ['blind-015', 'emotion', 'workspace_deletion_fear'],
  ['blind-016', 'emotion', 'refund_relief'],
  ['blind-017', 'other', 'retention_lifecycle_timing'],
  ['blind-018', 'other', 'plan_feature_facts'],
  ['blind-019', 'other', 'product_terminology'],
  ['blind-020', 'other', 'compliance_legal_roles'],
  ['blind-021', 'pain', 'invoice_tax_clarity'],
  ['blind-022', 'pain', 'mobile_project_search'],
  ['blind-023', 'pain', 'report_export_stall'],
  ['blind-024', 'pain', 'support_upload_recovery'],
  ['blind-025', 'desired_outcome', 'compile_upload_progress'],
  ['blind-026', 'desired_outcome', 'guided_onboarding'],
  ['blind-027', 'desired_outcome', 'accessible_status_labels_request'],
  ['blind-028', 'desired_outcome', 'offline_draft_sync'],
  ['blind-029', 'objection', 'migration_history_risk'],
  ['blind-030', 'objection', 'annual_contract_exit'],
  ['blind-031', 'objection', 'remote_local_write_permission'],
  ['blind-032', 'objection', 'trial_price_uncertainty'],
  ['blind-033', 'emotion', 'save_confirmation_anxiety'],
  ['blind-034', 'emotion', 'silent_command_frustration'],
  ['blind-035', 'emotion', 'workspace_deletion_fear'],
  ['blind-036', 'emotion', 'refund_relief'],
  ['blind-037', 'other', 'retention_lifecycle_timing'],
  ['blind-038', 'other', 'plan_feature_facts'],
  ['blind-039', 'other', 'product_terminology'],
  ['blind-040', 'other', 'compliance_legal_roles'],
  ['blind-041', 'pain', 'invoice_tax_clarity'],
  ['blind-042', 'pain', 'mobile_project_search'],
  ['blind-043', 'pain', 'report_export_stall'],
  ['blind-044', 'pain', 'support_import_recovery'],
  ['blind-045', 'desired_outcome', 'compile_upload_progress'],
  ['blind-046', 'desired_outcome', 'guided_onboarding'],
  ['blind-047', 'pain', 'accessible_status_labels_current_friction'],
  ['blind-048', 'desired_outcome', 'offline_draft_sync'],
  ['blind-049', 'objection', 'migration_history_risk'],
  ['blind-050', 'objection', 'annual_contract_exit'],
  ['blind-051', 'objection', 'remote_local_write_permission'],
  ['blind-052', 'objection', 'trial_price_uncertainty'],
  ['blind-053', 'emotion', 'save_confirmation_anxiety'],
  ['blind-054', 'emotion', 'silent_command_frustration'],
  ['blind-055', 'emotion', 'workspace_deletion_fear'],
  ['blind-056', 'emotion', 'refund_relief'],
  ['blind-057', 'other', 'retention_report_scope'],
  ['blind-058', 'other', 'plan_feature_facts'],
  ['blind-059', 'other', 'product_terminology'],
  ['blind-060', 'other', 'compliance_processing_regions'],
  ['blind-061', 'pain', 'invoice_tax_clarity'],
  ['blind-062', 'pain', 'mobile_project_search'],
  ['blind-063', 'pain', 'report_export_stall'],
  ['blind-064', 'pain', 'support_sync_recovery'],
  ['blind-065', 'desired_outcome', 'compile_upload_progress'],
  ['blind-066', 'desired_outcome', 'guided_onboarding'],
  ['blind-067', 'desired_outcome', 'accessible_status_labels_request'],
  ['blind-068', 'desired_outcome', 'offline_draft_sync'],
  ['blind-069', 'objection', 'migration_history_risk'],
  ['blind-070', 'objection', 'annual_contract_exit'],
  ['blind-071', 'objection', 'remote_local_write_permission'],
  ['blind-072', 'objection', 'trial_price_uncertainty'],
  ['blind-073', 'emotion', 'save_confirmation_anxiety'],
  ['blind-074', 'emotion', 'silent_command_frustration'],
  ['blind-075', 'emotion', 'workspace_deletion_fear'],
  ['blind-076', 'emotion', 'refund_relief'],
  ['blind-077', 'other', 'retention_lifecycle_timing'],
  ['blind-078', 'other', 'plan_feature_facts'],
  ['blind-079', 'other', 'product_terminology'],
  ['blind-080', 'other', 'compliance_legal_roles'],
  ['blind-081', 'pain', 'invoice_tax_clarity'],
  ['blind-082', 'pain', 'mobile_project_search'],
  ['blind-083', 'pain', 'report_export_stall'],
  ['blind-084', 'pain', 'support_configuration_recovery'],
  ['blind-085', 'desired_outcome', 'compile_upload_progress'],
  ['blind-086', 'desired_outcome', 'guided_onboarding'],
  ['blind-087', 'desired_outcome', 'accessible_status_labels_request'],
  ['blind-088', 'desired_outcome', 'offline_draft_sync'],
  ['blind-089', 'objection', 'migration_history_risk'],
  ['blind-090', 'objection', 'annual_contract_exit'],
  ['blind-091', 'objection', 'remote_local_write_permission'],
  ['blind-092', 'objection', 'trial_price_uncertainty'],
  ['blind-093', 'emotion', 'save_confirmation_anxiety'],
  ['blind-094', 'emotion', 'silent_command_frustration'],
  ['blind-095', 'emotion', 'workspace_deletion_fear'],
  ['blind-096', 'emotion', 'refund_relief'],
  ['blind-097', 'other', 'retention_report_scope'],
  ['blind-098', 'other', 'plan_feature_facts'],
  ['blind-099', 'other', 'product_terminology'],
  ['blind-100', 'other', 'compliance_processing_regions'],
]

const interventionOverrides: Record<string, string> = {
  support_import_recovery: 'give the exact import-recovery procedure',
  support_upload_recovery: 'give the exact upload-recovery procedure',
  support_sync_recovery: 'give the exact synchronization-recovery procedure',
  support_configuration_recovery: 'give the exact configuration-recovery procedure',
  accessible_status_labels_request: 'add readable text or icons to status colors',
  accessible_status_labels_current_friction: 'repair the current color-only status treatment',
  retention_lifecycle_timing: 'state retention start, expiry, and automatic removal timing',
  retention_report_scope: 'state whether generated or exported reports are retained',
  compliance_legal_roles: 'publish controller, processor, and subprocessor responsibility',
  compliance_processing_regions: 'publish regional processing and backup-location scope',
}

export const blinded100Rubric: Blinded100Gold[] = assignments.map(([id, category, mergeGroup], index) => ({
  id,
  category,
  mergeGroup,
  topicGroup: topics[index % topics.length].topicGroup,
  topicCues: [...topics[index % topics.length].topicCues],
}))

const interventionFor = (gold: Blinded100Gold) => interventionOverrides[gold.mergeGroup]
  || topics.find((topic) => topic.topicGroup === gold.topicGroup)!.intervention
const pairId = (left: string, right: string) => [left, right].sort().join('::')

export const blinded100PairRubric: Blinded100PairGold[] = topics.flatMap(({ topicGroup }) => {
  const comments = blinded100Rubric.filter((item) => item.topicGroup === topicGroup)
  return comments.flatMap((left, leftIndex) => comments.slice(leftIndex + 1).map((right) => {
    const expectedMerge = left.category === right.category && left.mergeGroup === right.mergeGroup
    return {
      pairId: pairId(left.id, right.id),
      leftId: left.id,
      rightId: right.id,
      expectedMerge,
      rationale: expectedMerge
        ? `Same bounded customer job; shared operator intervention: ${interventionFor(left)}.`
        : `Separate reviewed outcomes: ${interventionFor(left)}; ${interventionFor(right)}.`,
    }
  }))
})
