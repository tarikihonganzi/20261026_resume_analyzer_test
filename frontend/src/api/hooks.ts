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

/** 設定（API キーはマスクした値）。保存したら、`queryKeys.settings` を更新して画面に反映する。 */
export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings })
}

/** 保存済みの条件セット。保存・上書き・削除のあとは、`queryKeys.conditionSets` を無効にして読み直す。 */
export function useConditionSets() {
  return useQuery({ queryKey: queryKeys.conditionSets, queryFn: api.conditionSets })
}
