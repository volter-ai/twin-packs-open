import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessPack } from '@volter/twin-standard';
if (!process.env.VOLTER_WORLD) throw new Error('Publisher qualification requires its owned World');
const report = await assessPack(resolve('tavily'));
mkdirSync('release', { recursive: true });
writeFileSync('release/qualification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ready: report.ready, package: report.package, version: report.version, report: 'release/qualification.json', browser: 'Independent catalog assessment after publication' }));
process.exit(report.ready ? 0 : 1);
