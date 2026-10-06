// Apache-2.0; adapted from volter-ai/twin-world scripts/publish/build.mjs at 6d17a5a.
// Build one public package to node-consumable JS in <package>/dist/src (the one publishing
// pipeline, docs/contributing/architecture.md#the-publishing-pipeline).
//
//   node scripts/publish/build.mjs [<package dir>]     default: the cwd
//
// In-repo every package is consumed from SOURCE (.ts): the live package.json `exports`/`bin`
// point at ./src. This emits the JS + .d.ts the PUBLISHED package ships; prepare-publish.mjs
// flips the manifest to dist inside `npm pack` and restores it after. Steps:
//   1. `tsc -p tsconfig.build.json` — .js + .d.ts into dist/src, relative `./x.ts` specifiers
//      rewritten to `./x.js` in the JS (rewriteRelativeImportExtensions); the shebang survives.
//   2. the `.ts` specifiers tsc leaves inside the emitted .d.ts → `.js`, so node/tsc resolve them.
//
// pack.mjs runs that pair through `npm pack` for a package and its workspace siblings, writing
// the published tarballs into a destination directory instead of a registry.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const packageRoot = resolve(process.argv[2] ?? process.cwd());
const dist = resolve(packageRoot, 'dist');
const distSrc = resolve(dist, 'src');
// a twin pack (src/manifest.ts) with no build config of its own is built by the catalog's: its src and each lane's
// (a directory beside it with its own src/manifest.ts), so a pack is published as the platform packages are with no
// per-pack file (architecture, "The publishing pipeline")
const isPack = existsSync(join(packageRoot, 'src', 'manifest.ts'));
const lanes = isPack ? readdirSync(packageRoot).filter((d) => d !== 'src' && existsSync(join(packageRoot, d, 'src', 'manifest.ts'))) : [];
let config = 'tsconfig.build.json';
if (!existsSync(join(packageRoot, config))) {
  if (!isPack) { process.stderr.write(`${packageRoot}: no tsconfig.build.json\n`); process.exit(2); }
  config = 'tsconfig.publish.tmp.json';
  writeFileSync(join(packageRoot, config), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, types: ['node', 'bun'],
      allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, resolveJsonModule: true, declaration: true, noEmit: false, outDir: 'dist', rootDir: '.',
    },
    include: ['src', ...lanes.map((l) => `${l}/src`)].flatMap((d) => [`${d}/**/*.ts`, `${d}/**/*.tsx`]),
    exclude: ['**/*.test.ts', '**/*.test.tsx'],
  }, null, 2));
}
rmSync(dist, { recursive: true, force: true }); // the whole built form is remade — nothing stale survives
const tsc = spawnSync('bunx', ['--no-install', 'tsc', '-p', config], { cwd: packageRoot, encoding: 'utf8', stdio: 'inherit' });
if (config !== 'tsconfig.build.json') rmSync(join(packageRoot, config), { force: true });
// a pack's types are its grade's to judge (the typecheck criterion), not its publish's: what tsc emitted ships
if (tsc.status !== 0 && !(config !== 'tsconfig.build.json' && existsSync(join(distSrc, 'index.js')))) { process.stderr.write('tsc build failed\n'); process.exit(tsc.status ?? 1); }
if (tsc.status !== 0) process.stderr.write('built with type errors, which the pack\'s grade reports (typecheck)\n');

function rewriteDeclarations(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { rewriteDeclarations(path); continue; }
    if (!path.endsWith('.d.ts')) continue;
    const text = readFileSync(path, 'utf8')
      .replace(/((?:from|import)\s+['"][^'"]+)\.tsx?(['"])/g, '$1.js$2')
      .replace(/(import\(['"][^'"]+)\.tsx?(['"]\))/g, '$1.js$2');
    writeFileSync(path, text);
  }
}
rewriteDeclarations(dist); // dist/src, and a pack's dist/client beside it

// 3. what the sources reach for beside themselves ships beside the built form too: every non-TS
//    file under src (a .mjs helper spawned by path) into dist/src, and every asset the manifest's
//    `files` ships beside src (a JSON registry, a client/ tree) into dist/, so `dist/src/../x`
//    resolves exactly as `src/../x` does.
function copyTree(from, to, keep) {
  if (!existsSync(from)) return;
  if (!statSync(from).isDirectory()) { if (keep(from)) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); } return; }
  for (const entry of readdirSync(from)) copyTree(join(from, entry), join(to, entry), keep);
}
const notTs = (path) => !/\.tsx?$/.test(path) || path.endsWith('.d.ts');
copyTree(join(packageRoot, 'src'), distSrc, (path) => notTs(path) && !/\.test\./.test(path));
for (const lane of lanes) copyTree(join(packageRoot, lane, 'src'), join(dist, lane, 'src'), (path) => notTs(path) && !/\.test\./.test(path));
// 4. a page's browser client, PREBUILT for a Node host: every top-level client/*.tsx bundled by
//    `bun build` into dist/client/<name>.bundle.js — what world-core's bundleClient serves under
//    Node (under Bun it still builds at serve time). Bun is the pack-time toolchain here.
const clientDir = join(packageRoot, 'client');
if (existsSync(clientDir)) {
  for (const entry of readdirSync(clientDir)) {
    if (!/\.tsx$/.test(entry) || /\.test\./.test(entry)) continue;
    const outfile = join(dist, 'client', entry.replace(/\.tsx$/, '.bundle.js'));
    mkdirSync(dirname(outfile), { recursive: true });
    const b = spawnSync('bun', ['build', join(clientDir, entry), '--target', 'browser', '--minify', '--outfile', outfile], { cwd: packageRoot, encoding: 'utf8' });
    if (b.status !== 0) { process.stderr.write(`client bundle failed for ${entry}:\n${b.stderr.slice(-800)}\n`); process.exit(b.status ?? 1); }
  }
}
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
for (const entry of Array.isArray(manifest.files) ? manifest.files : []) {
  if (typeof entry !== 'string' || entry.startsWith('!') || entry.includes('*') || ['src', 'dist', 'README.md', 'LICENSE', 'CHANGELOG.md'].includes(entry)) continue;
  copyTree(join(packageRoot, entry), join(packageRoot, 'dist', entry), (path) => !/\.test\./.test(path));
}
process.stdout.write(`built ${packageRoot.split('/').slice(-2).join('/')} → dist/src\n`);
