import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
if (!process.env.VOLTER_WORLD) throw new Error('Publisher qualification requires its owned World');
const pack = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const require = createRequire(join(pack.work, 'package.json'));
let report;
try {
  const { assessPack } = await import(pathToFileURL(require.resolve('@volter/twin-standard')).href);
  report = { ...await assessPack(pack.packDir, { consumer: pack.consumer }), integrity: pack.integrity, sourceCommit: pack.sourceCommit, preparation: 'prepared-assessment.json' };
} catch (error) {
  report = {
    ready: false, package: pack.package, version: pack.version, vendor: pack.vendor,
    integrity: pack.integrity, sourceCommit: pack.sourceCommit, preparation: 'prepared-assessment.json',
    scope: 'Assessment interrupted; no completed readiness result.',
    assessmentError: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.slice(0, 32768) } : { message: String(error) },
  };
}
mkdirSync(pack.release, { recursive: true });
writeFileSync(join(pack.release, 'qualification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ready: report.ready, package: report.package, version: report.version, integrity: report.integrity, report: join(pack.release, 'qualification.json'), browser: 'Independent catalog assessment after publication' }));
process.exit(report.ready ? 0 : 1);
