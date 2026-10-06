import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function selectedPack() {
  const vendor = process.env.PACK_VENDOR ?? 'tavily';
  if (!/^[a-z][a-z0-9-]*$/.test(vendor)) throw new Error('PACK_VENDOR must name a vendor directory');
  const directory = resolve(vendor);
  if (realpathSync(directory) !== directory) throw new Error('Selected pack directory must not be a symlink');
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  return { vendor, directory, manifest, release: resolve('release', vendor) };
}
