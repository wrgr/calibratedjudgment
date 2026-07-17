// Frontend visibility flag for assessment modes. Backend routes, services, and
// data handling for every mode remain intact — this only controls what the SPA
// renders and routes to. To re-enable Scenario (mode B) and/or Free Response
// (mode C) in the UI, add 'scenario' / 'free_response' back to ENABLED_MODES;
// nothing else needs to change.
import type { AssessmentMode } from './types';

export const ENABLED_MODES: AssessmentMode[] = ['essay_trace'];

export function isModeEnabled(mode: AssessmentMode): boolean {
  return ENABLED_MODES.includes(mode);
}
