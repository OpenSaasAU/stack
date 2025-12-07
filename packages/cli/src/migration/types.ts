/**
 * Migration types - Shared types for the migration system
 */

export type ProjectType = 'prisma' | 'nextjs' | 'keystone'

export interface ModelInfo {
  name: string
  fieldCount: number
}

export interface ProjectAnalysis {
  projectTypes: ProjectType[]
  cwd: string
  models?: ModelInfo[]
  provider?: string
  hasAuth?: boolean
  authLibrary?: string
}

export interface FieldMapping {
  prismaType: string
  opensaasType: string
  opensaasImport: string
}

export interface MigrationQuestion {
  id: string
  text: string
  type: 'text' | 'select' | 'boolean' | 'multiselect'
  options?: string[]
  defaultValue?: string | boolean | string[]
  required?: boolean
  dependsOn?: {
    questionId: string
    value: string | boolean
  }
}

export interface MigrationSession {
  id: string
  projectType: ProjectType
  analysis: ProjectAnalysis
  currentQuestionIndex: number
  answers: Record<string, string | boolean | string[]>
  generatedConfig?: string
  isComplete: boolean
  createdAt: Date
  updatedAt: Date
}

export interface MigrationOutput {
  configContent: string
  dependencies: string[]
  files: Array<{
    path: string
    content: string
    language: string
    description: string
  }>
  steps: string[]
  warnings: string[]
}

export interface IntrospectedModel {
  name: string
  fields: IntrospectedField[]
  hasRelations: boolean
  primaryKey: string
}

export interface IntrospectedField {
  name: string
  type: string
  isRequired: boolean
  isUnique: boolean
  isId: boolean
  isList: boolean
  defaultValue?: string
  relation?: {
    name: string
    model: string
    fields: string[]
    references: string[]
  }
}

export interface IntrospectedSchema {
  provider: string
  models: IntrospectedModel[]
  enums: Array<{ name: string; values: string[] }>
}
