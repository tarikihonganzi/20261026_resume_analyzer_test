// OpenAPI から生成した型（types.gen.ts）の別名。手で書き直さない（`npm run gen-types`）。
import type { components } from './types.gen'

type Schemas = components['schemas']

export type Condition = Schemas['Condition']
export type ConditionKind = Condition['kind']
export type CatalogItem = Schemas['CatalogItem']
export type ConditionSet = Schemas['ConditionSet']
export type ConditionSetInput = Schemas['ConditionSetInput']
export type ResumeCheck = Schemas['ResumeCheck']
export type SettingsView = Schemas['SettingsView']
export type SettingsUpdate = Schemas['SettingsUpdate']
export type ConnectionTestRequest = Schemas['ConnectionTestRequest']
export type ConnectionTestResponse = Schemas['ConnectionTestResponse']

export type EvaluationResult = Schemas['EvaluationResult']
export type JudgedCondition = Schemas['JudgedCondition']
export type EvaluationPoint = Schemas['EvaluationPoint']
export type VerifiedQuote = Schemas['VerifiedQuote']
export type MissingRequired = Schemas['MissingRequired']

export type StageData = Schemas['StageData']
export type Stage = StageData['stage']
export type StreamError = Schemas['StreamError']
