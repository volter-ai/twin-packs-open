import { join, resolve } from 'node:path';
import { qualify } from './qualification-owner.ts';

await qualify(async ({ mode, args, command, world }) => {
  let runtimeRoot = process.cwd();
  let preparedPath: string | undefined;
  // Install the packed artifact and locked SDK fixtures before entering the assessment World.
  if (mode === 'assess') {
    const prepared = await command('node', ['scripts/prepare-assessment.mjs', process.execPath], { stdio: ['ignore', 'pipe', 'inherit'] });
    if (prepared.error || prepared.status !== 0) throw new Error(prepared.error?.message || prepared.stdout || 'Packed artifact preparation failed; see the preparation diagnostics above');
    const input = JSON.parse(prepared.stdout);
    runtimeRoot = input.work;
    preparedPath = join(input.release, 'prepared-assessment.json');
  }
  return world(runtimeRoot, [process.execPath, resolve('scripts/' + mode + '.ts'), ...(preparedPath ? [preparedPath] : []), ...args], process.cwd());
});
