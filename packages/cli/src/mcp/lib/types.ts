/**
 * Feature catalog types for OpenSaaS Stack MCP server
 */

export type QuestionType = 'text' | 'textarea' | 'select' | 'multiselect' | 'boolean'

export interface FeatureQuestion {
  id: string
  text: string
  type: QuestionType
  required?: boolean
  options?: string[]
  defaultValue?: string | boolean | string[]
  dependsOn?: {
    questionId: string
    value: string | boolean
  }
  followUp?: {
    if: string | boolean
    ask: string
    type: QuestionType
    options?: string[]
  }
}

export interface Feature {
  id: string
  name: string
  description: string
  includes: string[]
  dependsOn?: string[] // Other feature IDs required
  questions: FeatureQuestion[]
  category: 'authentication' | 'content' | 'storage' | 'search' | 'custom'
}

export interface WizardSession {
  id: string
  featureId: string
  feature: Feature
  currentQuestionIndex: number
  answers: Record<string, string | boolean | string[]>
  followUpAnswers: Record<string, string | boolean | string[]>
  isComplete: boolean
  createdAt: Date
  updatedAt: Date
}

export interface SessionStorage {
  [sessionId: string]: WizardSession
}

export interface GeneratedFile {
  path: string
  content: string
  language: string
  description: string
}

export interface FeatureImplementation {
  configUpdates: string
  files: GeneratedFile[]
  instructions: string[]
  devGuideSection: string
  envVars?: Record<string, string>
  nextSteps: string[]
}

export interface DocumentationLookup {
  topic: string
  content: string
  url: string
  codeExamples: string[]
  relatedTopics: string[]
}

export interface ValidationError {
  message: string
  location: string
  suggestion: string
  before?: string
  after?: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
  suggestions: string[]
}
