// Prepare the exact release archive in a fresh installation; never assess publisher workspace links.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { selectedPack } from './selected-pack.mjs';

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const hash = (bytes, encoding = 'hex') => createHash('sha512').update(bytes).digest(encoding);
const selected = selectedPack();
const inventory = read(join(selected.release, 'pack-inventory.json'));
assert.equal(inventory.name, selected.manifest.name);
assert.equal(inventory.version, selected.manifest.version);
assert.equal(inventory.filename, inventory.filename.split(/[\\/]/).at(-1));
const archive = join(selected.release, inventory.filename);
const integrity = 'sha512-' + hash(readFileSync(archive), 'base64');
assert.equal(integrity, inventory.integrity, 'Release archive differs from its packed inventory');
const publisher = read('package.json');
const standard = read('node_modules/@volter/twin-standard/package.json');
const tools = publisher.dependencies;
assert.ok(tools['@volter/world'], 'Installed customer assessment requires an exact released product CLI pin');
const workRoot = process.env.PACK_ASSESSMENT_ROOT ?? tmpdir();
mkdirSync(workRoot, { recursive: true });
const work = mkdtempSync(join(workRoot, `catalog-packed-${selected.vendor}-`));
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const clientDependencyChoices = Object.entries(selected.manifest.devDependencies ?? {}).flatMap(([name, candidate]) => {
  const evaluator = standard.devDependencies?.[name];
  return evaluator && evaluator !== candidate ? [{ name, candidate, evaluator, selected: evaluator }] : [];
});
assert.ok(!Object.hasOwn(tools, inventory.name), 'Selected artifact collides with evaluator tools');
write(join(work, 'package.json'), {
  name: 'packed-customer-assessment', private: true, type: 'module',
  dependencies: { ...selected.manifest.devDependencies, ...standard.devDependencies, ...tools, [inventory.name]: `file:${archive}` },
});
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.stdout}`);
};
process.stderr.write('Preparing locked evaluator dependencies and the exact candidate archive\n');
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], work);
const lock = read(join(work, 'package-lock.json'));
assert.equal(lock.packages[`node_modules/${inventory.name}`]?.integrity, integrity, 'Installed candidate bytes differ from packed release');
for (const [name, version] of Object.entries(tools)) {
  assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} differs from the released evaluator pin`);
}
const installed = join(work, 'node_modules', inventory.name);
const candidateRequire = createRequire(join(installed, 'package.json'));
const evaluatorRequire = createRequire(join(work, 'package.json'));
assert.equal(candidateRequire.resolve('@volter/world-core/runtime'), evaluatorRequire.resolve('@volter/world-core/runtime'), 'Candidate and evaluator resolve different kernels');
const installedStandard = join(work, 'node_modules/@volter/twin-standard');
assert.equal(read(join(installedStandard, 'package.json')).version, standard.version);
const clientSdkLocks = [];
for (const directory of standard.assessmentClientSdks ?? []) {
  process.stderr.write(`Preparing frozen standard SDK fixtures: ${directory}\n`);
  const sdkRoot = join(installedStandard, directory);
  assert.ok(!relative(installedStandard, sdkRoot).startsWith('..'));
  const before = readFileSync(join(sdkRoot, 'bun.lock'), 'utf8');
  run(process.argv[2], ['install', '--frozen-lockfile', '--ignore-scripts'], sdkRoot);
  assert.equal(readFileSync(join(sdkRoot, 'bun.lock'), 'utf8'), before);
  clientSdkLocks.push({ directory, manifest: read(join(sdkRoot, 'package.json')), lockSha512: hash(before) });
}
const packDir = join(work, 'packs', selected.vendor);
mkdirSync(dirname(packDir), { recursive: true });
cpSync(installed, packDir, { recursive: true });
assert.ok(!realpathSync(packDir).startsWith(process.cwd() + '/'), 'Assessment uses a publisher checkout');
const { prepareConsumerApp } = await import(pathToFileURL(evaluatorRequire.resolve('@volter/twin-standard')).href);
const appDir = join(work, 'customer-app');
const consumerFixture = prepareConsumerApp(packDir, appDir);
process.stderr.write('Preparing the declared customer SDK dependencies\n');
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], appDir);
// A dependency may also claim the flattened volter bin. Select the pinned product's own declared entry.
const productRoot = join(work, 'node_modules/@volter/world');
const product = read(join(productRoot, 'package.json'));
assert.equal(product.name, '@volter/world');
assert.equal(product.version, tools['@volter/world']);
assert.equal(typeof product.bin?.volter, 'string', 'Product package has no declared volter entry');
const cli = realpathSync(join(productRoot, product.bin.volter));
assert.ok(!relative(realpathSync(productRoot), cli).startsWith('..'), 'CLI entry is outside the installed product');
const consumer = { appDir, cli, artifactIntegrity: integrity };
const prepared = {
  schemaVersion: 1, vendor: selected.vendor, package: inventory.name, version: inventory.version,
  archive, integrity, work, packDir, release: selected.release,
  sourceCommit: process.env.GITHUB_SHA ?? null, tools, clientDependencyChoices, clientSdkLocks, consumer, consumerFixture,
  executionEnvironment: { imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null, postgresTools: process.env.VOLTER_WORLD_POSTGRES_BIN ?? null },
  consumerDependencyLockSha512: hash(readFileSync(join(appDir, 'package-lock.json'))),
  dependencyLockSha512: hash(readFileSync(join(work, 'package-lock.json'))),
  scope: 'Exact packed archive installed without scripts or workspace links; released standard and declared registry dependencies',
};
write(join(selected.release, 'prepared-assessment.json'), prepared);
cpSync(join(work, 'package-lock.json'), join(selected.release, 'assessment-package-lock.json'));
cpSync(join(appDir, 'package-lock.json'), join(selected.release, 'consumer-package-lock.json'));
process.stderr.write('Packed candidate and customer dependency preparation complete\n');
process.stdout.write(JSON.stringify(prepared) + '\n');
