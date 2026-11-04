// E2B's own move as the World clock passes (docs/contributing/architecture.md, clock.ts): a sandbox whose timeout has
// passed is killed, so it is gone, and its machine removed.
import type { HandlerContext } from '@volter/world-core';
import { SANDBOX } from './shared.ts';

// source: spec:/components/schemas/NewSandbox "Time to live for the sandbox in seconds."
// source: spec:/components/schemas/ListedSandbox "Time when the sandbox will expire"
export async function clock(ctx: HandlerContext): Promise<void> {
  const now = Date.parse(ctx.occurredAt);
  for (const sb of ctx.rowsRaw(SANDBOX).filter(s => s.state === 'running' || s.state === 'paused')) {
    const status = await ctx.machines.status(String(sb.id));
    if (!status || status.state === 'started' || status.state === 'paused') continue;
    // source: spec:delete_sandboxes_sandboxid "The sandbox was killed successfully"
    await ctx.machines.remove(String(sb.id));
    await ctx.remove(SANDBOX, String(sb.id), 'sandbox.guest_ended');
  }
  for (const sb of ctx.rowsRaw(SANDBOX).filter((s) => s.state === 'running' && Date.parse(String(s.endAt)) <= now)) {
    const then = await ctx.at(String(sb.endAt));
    if (sb._autoPause === true) {
      const refusal = then.legal(SANDBOX, 'state', 'sandbox.timeout', 'running', 'paused', String(sb.id), 'vendor');
      if (refusal) throw new Error('the sandbox timeout was refused');
      await then.machines.pause(String(sb.id));
      await then.write(SANDBOX, String(sb.id), { state: 'paused' }, 'sandbox.timeout');
      continue;
    }
    await then.machines.remove(String(sb.id));
    await then.remove(SANDBOX, String(sb.id), 'sandbox.timeout');
  }
}
