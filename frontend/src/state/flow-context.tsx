import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import { initialState, reducer, type Action, type FlowState } from './flow'

interface FlowContextValue {
  state: FlowState
  dispatch: Dispatch<Action>
}

const FlowContext = createContext<FlowContextValue | null>(null)

export function FlowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>
}

export function useFlow(): FlowContextValue {
  const value = useContext(FlowContext)
  if (!value) throw new Error('useFlow は FlowProvider の中で使います')
  return value
}
