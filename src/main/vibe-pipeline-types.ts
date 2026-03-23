import type { PipelineStage } from '../shared/types'

export type StageId = PipelineStage['id']

export interface DiagnosticEntry {
  ts: number
  stage: StageId | 'init'
  level: 'info' | 'warn' | 'error'
  source: 'stdout' | 'stderr' | 'pipeline' | 'build' | 'runtime'
  message: string
}

export interface SkillInventoryEntry {
  id: string
  name: string
  description: string
}

export interface BrainstormBrief {
  problem: string
  mvp_features: string[]
  out_of_scope: string[]
  stack: { frontend: string; backend: string; db: string; rationale: string }
  data_model: Array<{ entity: string; fields: string[]; relations: string[] }>
  ux_flow: string[]
  file_architecture: string[]
  risks: string[]
  confidence: number
}

export interface SkillForgeResult {
  name: string
  content: string
  covers: string[]
}

export interface EngineerFile {
  path: string
  content: string
  layer: 'types' | 'constants' | 'utils' | 'data' | 'logic' | 'api' | 'ui' | 'entry' | 'config'
}

export interface EngineerManifest {
  installCommand: string
  buildCommand: string
  startCommand: string
  entryPoint: string
  envVars: Array<{ key: string; description: string; required: boolean }>
  fileTree: string[]
  files: EngineerFile[]
}

export interface BrowserReviewResult {
  initial_screenshot: string
  ux_flow_results: Array<{
    step: string
    status: 'pass' | 'fail'
    screenshot: string
    notes: string
  }>
  console_errors: string[]
  console_warnings: string[]
  edge_case_results: Array<{ case: string; status: 'pass' | 'fail'; notes: string }>
  overall_status: 'pass' | 'fail' | 'partial'
  review_complete: true
}

export interface QAResult {
  status: 'pass' | 'fail' | 'partial'
  passing_features: string[]
  failing_features: Array<{ feature: string; root_cause: string }>
  console_errors: Array<{ message: string; severity: 'low' | 'medium' | 'high' }>
  edge_case_results: Array<{ case: string; status: 'pass' | 'fail'; notes: string }>
  recommendation: 'ship' | 'fix then ship' | 'needs redesign'
  delivery_summary: string
}

export interface SelectorPlan {
  selector: string
  action: 'click' | 'type' | 'noop'
  text?: string
}

export interface ChatPayload {
  message?: { content?: string }
  error?: { message?: string }
}

export interface DiagnosticReport {
  category:
    | 'missing_dependency'
    | 'missing_file'
    | 'type_error'
    | 'syntax_error'
    | 'runtime_crash'
    | 'port_not_exposed'
    | 'unknown'
  affectedFiles: string[]
  missingPackages: string[]
  errorMessages: string[]
  fixContext: string
}

export const PIPELINE_STAGE_LABELS: Record<StageId, string> = {
  skill_inventory_check: 'Skill Inventory',
  brainstorm: 'Brainstorm',
  skill_forge: 'Skill Forge',
  engineer: 'Engineer',
  sandbox: 'Sandbox',
  browser: 'Browser Review',
  qa: 'QA Synthesis'
}

export const ENGINEER_LAYER_ORDER: EngineerFile['layer'][] = [
  'types',
  'constants',
  'utils',
  'data',
  'logic',
  'api',
  'ui',
  'entry',
  'config'
]

export const MAX_SELF_HEAL_ATTEMPTS = 5
