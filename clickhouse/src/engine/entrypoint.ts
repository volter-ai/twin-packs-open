// The vendor entrypoint's user branch, from authenticated original bytes, never a shell runner.
// source: https://github.com/ClickHouse/ClickHouse/blob/v24.12.6.70-stable/docker/server/entrypoint.sh "explicitly skip changing user"
import * as kernel from '@volter/world-core';
const { digest } = kernel;

type SourceFile = { target: string; bytes: Uint8Array; sha256: string };
export type UserGeneration = {
  source: string;
  action: 'preserve' | 'generate' | 'gap';
  reason: string;
  file?: SourceFile;
};
const ENTRYPOINT = '/entrypoint.sh';
const GENERATED = '/etc/clickhouse-server/users.d/default-user.xml';
// This identifies behavior, not an image release: only the carrier's actual file can select it.
const SOURCE_SHA256 = '3df252708aaf6b49d60d0a11cb45fa04f396643cd994017ba433eadf4f9b6be8';

/** Render exactly the served vendor user branch; unknown invocation/source or comparison stays a gap. */
export function generateEntrypointUser(manifest: kernel.managedOriginalInputs.ManagedOriginalInputs, files: SourceFile[], users: { path?: string; defaultPresent: boolean; defaultChanged?: boolean }): UserGeneration {
  const gap = (reason: string): UserGeneration => ({ source: ENTRYPOINT, action: 'gap', reason });
  const source = files.find(file => file.target === ENTRYPOINT);
  if (!source || source.sha256 !== SOURCE_SHA256 || digest('sha256', source.bytes) !== SOURCE_SHA256) return gap('Entrypoint user generation has no matching retained vendor source');
  const { start } = manifest;
  const entrypoint = start.entrypoint ?? start.imageEntrypoint, command = start.command ?? start.imageCommand ?? [];
  if (!entrypoint || entrypoint.length !== 1 || entrypoint[0] !== ENTRYPOINT || command.length) return gap('Entrypoint invocation or server arguments have no served source branch');
  // Source lines 108-124 precede SKIP and all generation branches under set -eo pipefail.
  if (!users.path || !users.defaultPresent || !files.some(file => file.target === users.path)) return gap('Entrypoint requires its declared user_directories.users_xml.path and original users.default before user setup');
  const env = start.environment;
  // Source lines 54-61: a present regular password file wins; command substitution removes trailing LF bytes.
  const passwordPath = env.CLICKHOUSE_PASSWORD_FILE || '';
  let password = env.CLICKHOUSE_PASSWORD || '';
  if (passwordPath) {
    if (!passwordPath.startsWith('/') || passwordPath.split('/').slice(1).some(part => !part || part === '.' || part === '..' || /[\0\r\n\\]/u.test(part))) return gap('Entrypoint password file path is outside the served absolute paths');
    const held = files.find(file => file.target === passwordPath);
    if (held) {
      try { password = new TextDecoder('utf-8', { fatal: true }).decode(held.bytes).replace(/\n+$/u, ''); }
      catch { return gap('Entrypoint password file is not a served UTF-8 value'); }
    } else if (manifest.imageInventory.some(file => file.target === passwordPath && ['file', 'link'].includes(file.type))
      || manifest.inventory.some(file => file.target === passwordPath && file.type === 'link')) return gap('Entrypoint password file bytes are outside the authenticated inputs');
  }
  if (password.includes('\0')) return gap('Entrypoint password command substitution contains an unserved NUL');
  const user = env.CLICKHOUSE_USER || 'default', access = env.CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT || '0';
  // Source lines 126-150: skip is exact "1", including when other user variables are present.
  if ((env.CLICKHOUSE_SKIP_USER_SETUP || '0') === '1') return { source: ENTRYPOINT, action: 'preserve', reason: 'Vendor CLICKHOUSE_SKIP_USER_SETUP=1 preserves the source user configuration' };
  let text: string;
  if (user !== 'default' || password !== '' || access !== '0') {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(user)) return gap('Entrypoint generated user element name is outside the served XML names');
    text = `<clickhouse><users><default remove="remove"></default><${user}><profile>default</profile><networks><ip>::/0</ip></networks><password><![CDATA[${password.replace(/\]\]>/gu, ']]]]><![CDATA[>')}]]></password><quota>default</quota><access_management>${access}</access_management></${user}></users></clickhouse>`;
  } else if (users.defaultChanged === true) {
    return { source: ENTRYPOINT, action: 'preserve', reason: 'Vendor preserves an explicitly changed default user' };
  } else if (users.defaultChanged === false) {
    // Source lines 155-169: no explicit setup and an unchanged default restrict network access.
    text = '<clickhouse><users><default><networks><ip>::1</ip><ip>127.0.0.1</ip></networks></default></users></clickhouse>';
  } else return gap('Entrypoint default-user comparison has no supported complete XML reading');
  const bytes = new TextEncoder().encode(text);
  return { source: ENTRYPOINT, action: 'generate', reason: 'Vendor user generation produces the default-user fragment before server configuration',
    file: { target: GENERATED, bytes, sha256: digest('sha256', bytes) } };
}
