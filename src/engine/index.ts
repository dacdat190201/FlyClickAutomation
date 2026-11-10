export { AutomationEngine } from './automation-engine';
export { MockAutomationAdapter, type MockAdapterOptions, type MockCall } from './mock-adapter';
export { canTransition, isActive, isTerminal, nextState, type EngineEvent } from './state-machine';
export {
  EngineState,
  type AutomationAdapter,
  type AutomationTask,
  type EngineCommand,
  type EngineConfig,
  type EngineListener,
  type EngineSnapshot,
  type ExecutionContext,
} from './types';
