import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compilePackFacts } from '@volter/twin-standard';
assert.ok(process.env.VOLTER_WORLD, 'pack builds run through a World');
const result = spawnSync('bunx', ['--no-install', 'tsc', '-p', 'tavily/tsconfig.build.json'], { stdio: 'inherit' });
assert.equal(result.status, 0, 'compiled build failed');
function copyJson(source: string, target: string) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name);
    if (entry.isDirectory()) copyJson(from, to);
    else if (entry.name.endsWith('.json')) copyFileSync(from, to);
  }
}
copyJson('tavily/src', 'tavily/dist/src');
const facts = await compilePackFacts([{ vendor: 'tavily', dir: join(process.cwd(), 'tavily') }]);
assert.deepEqual(facts.undeclared, []);
mkdirSync('tavily/generated', { recursive: true });
writeFileSync('tavily/generated/pack-facts.json', JSON.stringify(facts, null, 2) + '\n');
const manifest = JSON.parse(readFileSync('tavily/package.json', 'utf8'));
assert.equal(manifest.name, '@volter/twin-tavily');
