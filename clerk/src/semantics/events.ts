// How Clerk renders an event's `data` for a write (docs/contributing/architecture.md, the events row): the manifest's
// `events` declares the rest (CLERK_EVENTS), and the kernel signs, delivers and records.
import type { EventWrite, WriteHookContext } from '@volter/world-core';
import { eventData } from './shared.ts';

export function data(ctx: WriteHookContext, write: EventWrite): Record<string, unknown> {
  return eventData(ctx, write);
}
