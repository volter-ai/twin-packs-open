// The PostgREST lane's state machines and state rulings (docs/contributing/architecture.md, "What an author writes, and
// how"): none. The lane serves nothing (every operation is the gap: ../../../journeys/decisions.json), so it keeps no state.
import type { StateField } from '@volter/world-core';

export const states: Record<string, { state?: Record<string, StateField>; notState?: string[] }> = {};
