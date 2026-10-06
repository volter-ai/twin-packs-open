// The CWE names linked by GitHub's repository-advisory creation guide, from MITRE's research-concepts view.
// Run from the packs root: bun github/spec/derive-cwes.ts
import { gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
const text = gunzipSync(readFileSync(new URL('./cwes.txt.gz', import.meta.url))).toString();
const names = Object.fromEntries([...text.matchAll(/([^\n]+)\n - \((\d+)\)/g)].map((match) => [`CWE-${match[2]}`, match[1]!.trim()]));
writeFileSync(new URL('../src/engine/cwes.json', import.meta.url), JSON.stringify(names, null, 2) + '\n');
