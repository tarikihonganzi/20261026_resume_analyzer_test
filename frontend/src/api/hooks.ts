import { useQuery } from '@tanstack/react-query'
import { api } from './client'

export const queryKeys = {
  catalog: ['catalog'] as const,
  conditionSets: ['condition-sets'] as const,
  settings: ['settings'] as const,
}

/** プリセット条件。アプリの実行中は変わらない。 */
export function useCatalog() {
  return useQuery({ queryKey: queryKeys.catalog, queryFn: api.catalog, staleTime: Infinity })
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings })
}

export function useConditionSets() {
  return useQuery({ queryKey: queryKeys.conditionSets, queryFn: api.conditionSets })
}
