// ClickHouse configuration is vendor behavior. XML grammar is parsed by the strict kernel helper;
// hashes use the kernel, and SQL statement boundaries use this pack's existing vendor lexer.
// source: https://clickhouse.com/docs/operations/configuration-files "merged recursively"
import * as kernel from '@volter/world-core';
import { tokens } from './ddl.ts';
import { generateEntrypointUser } from './entrypoint.ts';
import type { ReadonlyMode, ServerConfiguration, UserPolicy } from './configuration.ts';
import { servedReadonly } from './user-policy.ts';

export type OriginalFile = { target: string; bytes: Uint8Array; sha256: string };
export type OriginalInputs = {
  kind: 'clickhouse.original-inputs'; version: 1;
  source: { image?: string; commit?: string };
  files: OriginalFile[];
  /** Names that the trusted declaration assigns to this server, not guessed cluster members. */
  selfHosts: string[];
  /** Issued throwaway credentials by source user name; original passwords are never copied. */
  credentials?: Record<string, string>;
  environment?: Record<string, string>;
  /** Neutral carrier bytes, rehashed here; never a caller assertion of completeness. */
  carrier?: { bytes: Uint8Array; sha256: string; objects: Array<{ sha256: string; bytes: Uint8Array }> };
};
export type InputDisposition = { file: string; directive: string; disposition: 'applied' | 'gap' | 'superseded'; reason: string };
export type OriginalPlan = {
  kind: 'clickhouse.original-input-reading'; version: 1; complete: boolean;
  source: OriginalInputs['source']; files: Array<{ target: string; bytes: number; sha256: string }>;
  configuration: ServerConfiguration;
  queries: Array<{ file: string; line: number; sql: string }>;
  generated: Array<{ target: string; source: string }>;
  directives: InputDisposition[];
};
type Xml = { name: string; attrs: Record<string, string>; text: string; children: Xml[]; file: string; path: string };
const { digest, xml } = kernel;
function xmlNode(element: kernel.xml.XmlElement, file: string, path: string, instruction: (path: string) => void): Xml {
  const one = (element: kernel.xml.XmlElement, path: string): Xml => {
    for (const node of element.content) if (node.kind === 'processing-instruction') instruction(`${path}/?${node.target}`);
    return { name: element.name, attrs: element.attributes,
      text: element.content.filter((node): node is kernel.xml.XmlText => node.kind === 'text' || node.kind === 'cdata').map(node => node.value).join(''), children: [], file, path };
  };
  const root = one(element, path), pending = [{ element, node: root }];
  while (pending.length) {
    const { element, node } = pending.pop()!;
    const children = element.content.filter((each): each is kernel.xml.XmlElement => each.kind === 'element');
    for (const [index, child] of children.entries()) {
      const mapped = one(child, `${node.path}/${child.name}[${index + 1}]`);
      node.children.push(mapped); pending.push({ element: child, node: mapped });
    }
  }
  return root;
}
function statements(text: string): Array<{ sql: string; line: number }> {
  const result: Array<{ sql: string; line: number }> = []; let start = 0;
  for (const token of tokens(text)) if (!token.quoted && token.value === ';') {
    if (tokens(text.slice(start, token.start)).length) result.push({ sql: text.slice(start, token.start), line: text.slice(0, start).split('\n').length });
    start = token.end;
  }
  if (tokens(text.slice(start)).length) result.push({ sql: text.slice(start), line: text.slice(0, start).split('\n').length });
  return result;
}
function validTarget(path: string): boolean { return path.startsWith('/') && !path.split('/').slice(1).some(part => !part || part === '.' || part === '..' || /[\0\r\n]/.test(part)); }
function pathOrder(a: string, b: string): number {
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return left.length - right.length;
}

/** Read all supplied bytes before returning a plan. Any gap keeps the plan non-applicable. No vendor or store call. */
export async function readOriginalInputs(input: OriginalInputs): Promise<OriginalPlan> {
  if (!xml || typeof xml.parseDocument !== 'function') throw new Error('ClickHouse original inputs require the World kernel with strict XML document support');
  if (input.kind !== 'clickhouse.original-inputs' || input.version !== 1 || !Array.isArray(input.files) || !input.files.length
    || !Array.isArray(input.selfHosts) || !input.selfHosts.length || input.selfHosts.some(host => typeof host !== 'string' || !host || /[\0\r\n]/.test(host))
    || (!input.source?.image && !input.source?.commit)
    || (input.source?.image !== undefined && !/^(?:[A-Za-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(input.source.image))
    || (input.source?.commit !== undefined && !/^[a-f0-9]{40}$/.test(input.source.commit))
    || [input.environment, input.credentials].some(map => map !== undefined && (!map || typeof map !== 'object' || Array.isArray(map) || Object.values(map).some(value => typeof value !== 'string'))))
    throw new Error('Original ClickHouse inputs need a pinned source, files and declared self host names');
  const plan: OriginalPlan = { kind: 'clickhouse.original-input-reading', version: 1, complete: false, source: { ...input.source }, files: [], configuration: {}, queries: [], generated: [], directives: [] };
  let carrier: kernel.managedOriginalInputs.ManagedOriginalInputs | undefined;
  const mark = (file: string, directive: string, disposition: InputDisposition['disposition'], reason: string) => plan.directives.push({ file, directive, disposition, reason });
  const gap = (node: Xml, reason: string) => { const pending = [node]; while (pending.length) { const each = pending.pop()!; mark(each.file, each.path, 'gap', reason); pending.push(...each.children); } };
  const applied = (node: Xml, reason: string) => mark(node.file, node.path, 'applied', reason);
  // A mount manifest is not a complete image reading. Image defaults and entrypoint-generated files
  // require the authenticated carrier; accepting a supplied list alone would silently omit them.
  if (input.carrier) {
    if (!kernel.managedOriginalInputs || typeof kernel.managedOriginalInputs.readSnapshot !== 'function') throw new Error('Original inputs require the World carrier reader');
    const objects = new Map(input.carrier.objects.map(entry => [entry.sha256, entry.bytes]));
    if (objects.size !== input.carrier.objects.length) throw new Error('Duplicate original carrier object');
    const snapshot = kernel.managedOriginalInputs.readSnapshot(input.carrier.bytes, input.carrier.sha256, name => {
      const bytes = objects.get(name.slice('objects/'.length));
      if (!bytes) throw new Error('Missing original carrier object');
      return bytes;
    });
    const source = snapshot.manifest;
    carrier = source;
    if (source.family !== 'clickhouse' || source.source.image !== input.source.image || source.source.commit !== input.source.commit || snapshot.objects.size !== objects.size
      || JSON.stringify(source.start.selfHosts) !== JSON.stringify(input.selfHosts) || JSON.stringify(source.start.environment) !== JSON.stringify(input.environment)) throw new Error('Original carrier identity differs from the vendor inputs');
    const files = new Map(source.inventory.filter(entry => entry.type === 'file').map(entry => [entry.target, entry]));
    if (files.size !== input.files.length || input.files.some(file => files.get(file.target)?.sha256 !== file.sha256)) throw new Error('Original carrier files differ from the vendor inputs');
    mark('/etc/clickhouse-server/config.d', 'image-rootfs', 'applied', 'Configuration inventory is authenticated against its original image and committed mount overlay; no configuration meaning is inferred');
    for (const entry of source.inventory) if (entry.type === 'link') mark(entry.target, 'original-link', 'gap', 'Vendor-path symlink configuration reading is not served');
    const ignored = source.start.service.ignored;
    if (Array.isArray(ignored)) for (const entry of ignored) mark(source.source.compose, 'compose-directive', 'gap', `Original service directive remains unsupported: ${String((entry as { key?: unknown }).key)}`);
    if (source.start.unset.length) mark(source.source.compose, 'source-interpolation', 'gap', 'The original definition contains unresolved variables; their names are retained in the carrier');
  } else {
    mark('/etc/clickhouse-server/config.d', 'image-rootfs', 'gap', 'Complete pinned image configuration inventory has no authenticated carrier');
    mark('/etc/clickhouse-server/users.d/default-user.xml', 'entrypoint-generation', 'gap', 'Pinned entrypoint-generated user configuration has no authenticated carrier');
  }
  const seen = new Set<string>(); const roots: Xml[] = [];
  for (const file of [...input.files].sort((a, b) => pathOrder(a.target, b.target))) {
    if (!validTarget(file.target) || seen.has(file.target) || !(file.bytes instanceof Uint8Array) || !/^[a-f0-9]{64}$/.test(file.sha256) || digest('sha256', file.bytes) !== file.sha256)
      throw new Error(`Original input identity does not match: ${String(file.target)}`);
    seen.add(file.target); plan.files.push({ target: file.target, bytes: file.bytes.length, sha256: file.sha256 });
    if (carrier && file.target === '/entrypoint.sh') continue; // The authenticated source branch is consumed below.
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
    catch { mark(file.target, '/', 'gap', 'The binary schema or executable format has no configured consumer'); continue; }
    if (/^\/docker-entrypoint-initdb\.d\/[^/]+\.sql$/.test(file.target)) {
      try {
        for (const query of statements(text)) plan.queries.push({ file: file.target, ...query });
        mark(file.target, '/', 'gap', 'Bootstrap needs the pinned entrypoint initialization state, CLICKHOUSE_ALWAYS_RUN_INITDB_SCRIPTS, CLICKHOUSE_USER and glob-order contract');
      }
      catch { mark(file.target, '/', 'gap', 'Bootstrap SQL has malformed statement boundaries'); }
      continue;
    }
    if (/^\/docker-entrypoint-initdb\.d\//.test(file.target)) {
      // Running shell is not inferred from strings: cp, readiness loops and conditional commands need their real runner.
      let commands = 0;
      for (const [index, line] of text.split('\n').entries()) if (line.trim() && !line.trimStart().startsWith('#')) { commands++; mark(file.target, `line:${index + 1}`, 'gap', 'Bootstrap shell/control flow has no configured source runner'); }
      if (!commands) mark(file.target, '/', 'gap', 'Comment-only bootstrap still needs its pinned entrypoint initialization and execution contract');
      continue;
    }
    if (!/\.xml$/i.test(file.target)) { mark(file.target, '/', 'gap', 'Schema, non-XML configuration or user-script mount has no configured consumer'); continue; }
    try {
      const document = await xml.parseDocument(text);
      const instruction = (path: string) => mark(file.target, path, 'gap', 'XML processing instruction has no configured consumer');
      for (const node of [...document.prologue, ...document.epilogue]) if (node.kind === 'processing-instruction' && node.target !== 'xml') instruction(`/?${node.target}`);
      const root = xmlNode(document.root, file.target, '/' + document.root.name, instruction);
      if (root.name === 'functions') { gap(root, 'Executable/XML UDFs require their declared program and RowBinary contract'); continue; }
      if (!['clickhouse', 'yandex'].includes(root.name)) { gap(root, 'Unknown ClickHouse configuration root'); continue; }
      roots.push(root);
    } catch (error) {
      if (error instanceof xml.XmlDocumentError) mark(file.target, '/', 'gap', error.message);
      else throw error;
    }
  }
  const merge = (documents: Xml[], main: string): Xml[] => {
    const held = new Map<string, Xml>();
    // Main config precedes fragments; fragments follow the vendor's full-path order.
    const rank = (root: Xml) => root.file === main ? 0 : 1;
    const join = (before: Xml | undefined, next: Xml, depth = 0): Xml | undefined => {
      if (depth > 256) { gap(next, 'Configuration fragment merge exceeds the served depth'); return next; }
      if (next.attrs.remove !== undefined && next.attrs.replace !== undefined) { gap(next, 'Both remove and replace are invalid on one element'); return before; }
      if (next.attrs.remove !== undefined) { if (before) gapReplacement(before); applied(next, 'Removed by the declared configuration'); return undefined; }
      if (before && next.attrs.replace === undefined && Object.keys(before.attrs).some(name => !['replace', 'remove'].includes(name))) gap(before, 'Earlier attributes in a fragment merge are not modeled');
      if (!before || next.attrs.replace !== undefined || (!before.children.length && !next.children.length)) { if (before) gapReplacement(before); return next; }
      if (before.text.trim() || next.text.trim()) { gap(next, 'Mixed scalar/container merge is not modeled'); return next; }
      if (new Set(before.children.map(child => child.name)).size !== before.children.length || new Set(next.children.map(child => child.name)).size !== next.children.length) { gap(next, 'Repeated-name fragment merge is not modeled'); return next; }
      const children = new Map(before.children.map(child => [child.name, child]));
      for (const child of next.children) { const merged = join(children.get(child.name), child, depth + 1); if (merged) children.set(child.name, merged); else children.delete(child.name); }
      applied(before, 'Merged with the later fragment'); return { ...next, children: [...children.values()] };
    };
    const gapReplacement = (node: Xml) => { const pending = [node]; while (pending.length) { const each = pending.pop()!; mark(each.file, each.path, 'superseded', 'Replaced by a later configuration fragment'); pending.push(...each.children); } };
    for (const root of [...documents].sort((a, b) => rank(a) - rank(b) || pathOrder(a.file, b.file))) {
      if (Object.keys(root.attrs).length || root.text.trim()) gap(root, 'Root attributes or mixed content are not modeled');
      if (new Set(root.children.map(child => child.name)).size !== root.children.length) gap(root, 'Same-named siblings within one source root are not modeled');
      for (const node of root.children) { const merged = join(held.get(node.name), node); if (merged) held.set(node.name, merged); else held.delete(node.name); }
    }
    return [...held.values()];
  };
  const scalar = (node: Xml): string | undefined => {
    if (node.children.length) { gap(node, 'A scalar directive contains nested XML'); return undefined; }
    for (const key of Object.keys(node.attrs)) if (!['from_env', 'replace', 'remove'].includes(key)) { gap(node, `Configuration attribute ${key} is not modeled`); return undefined; }
    if (node.attrs.from_env !== undefined) {
      const name = node.attrs.from_env;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !Object.hasOwn(input.environment ?? {}, name)) { gap(node, 'The declared environment substitution has no supplied value'); return undefined; }
      return input.environment![name]!;
    }
    return node.text.trim();
  };
  const plain = (node: Xml): boolean => { if (Object.keys(node.attrs).some(key => !['replace', 'remove'].includes(key)) || node.text.trim()) { gap(node, 'Container attributes or mixed content are not modeled'); return false; } return true; };
  const configMain = '/etc/clickhouse-server/config.xml';
  const fragment = (main: string, file: string): boolean => {
    const directory = main.slice(0, main.lastIndexOf('/'));
    const directories = [/\.[^/.]+$/.test(main) ? main.replace(/\.[^/.]+$/, '.d') : main + '.d', directory + '/conf.d'];
    return directories.some(path => file.startsWith(path + '/') && /^[^/.][^/]*\.xml$/i.test(file.slice(path.length + 1)));
  };
  if (input.environment?.CLICKHOUSE_CONFIG && input.environment.CLICKHOUSE_CONFIG !== configMain) mark(configMain, 'CLICKHOUSE_CONFIG', 'gap', 'Alternate main configuration path is not served');
  const configRoots = roots.filter(root => root.file === configMain || fragment(configMain, root.file));
  if (!configRoots.some(root => root.file === configMain)) mark(configMain, '/', 'gap', 'Main configuration is absent from the supplied bytes');
  const effective = merge(configRoots, configMain);
  const directories = effective.find(node => node.name === 'user_directories');
  const xmlDirectory = directories?.children.find(node => node.name === 'users_xml');
  const directoryPointer = xmlDirectory?.children.find(node => node.name === 'path');
  const declaredUserPath = directoryPointer ? scalar(directoryPointer) : undefined;
  const userPointer = directoryPointer ?? effective.find(node => node.name === 'users_config');
  const pointed = directoryPointer ? declaredUserPath : userPointer ? scalar(userPointer) : 'users.xml';
  let usersMain = pointed ? (pointed.startsWith('/') ? pointed : '/etc/clickhouse-server/' + pointed) : undefined;
  if (usersMain && !validTarget(usersMain)) { if (userPointer) gap(userPointer, 'The users_config target is not canonical'); usersMain = undefined; }
  const userRoots = usersMain ? roots.filter(root => root.file === usersMain || fragment(usersMain!, root.file)) : [];
  if (usersMain && !userRoots.some(root => root.file === usersMain)) mark(usersMain, '/', 'gap', 'Main users configuration is absent from the supplied bytes');
  let effectiveUsers = merge(userRoots, usersMain ?? '');
  if (carrier) {
    const originalDefault = userRoots.find(root => root.file === usersMain)?.children.find(node => node.name === 'users')?.children.find(node => node.name === 'default');
    const processedDefault = effectiveUsers.find(node => node.name === 'users')?.children.find(node => node.name === 'default');
    const unchanged = (node: Xml): boolean => {
      const pending = [node];
      while (pending.length) {
        const each = pending.pop()!;
        if (Object.keys(each.attrs).length) return false;
        pending.push(...each.children);
      }
      return true;
    };
    // extract-from-config hashes Poco innerText, not the XML structure. An untouched plain node
    // proves equality; a merged/substituted default requires the unserved DOM-text comparison.
    const defaultChanged = originalDefault && originalDefault === processedDefault && unchanged(originalDefault) ? false : undefined;
    const vendorUserPath = declaredUserPath && usersMain && userRoots.some(root => root.file === usersMain) ? usersMain : undefined;
    const generation = generateEntrypointUser(carrier, input.files, { path: vendorUserPath, defaultPresent: Boolean(originalDefault), defaultChanged });
    mark(generation.source, 'user-generation', generation.action === 'gap' ? 'gap' : 'applied', generation.reason);
    if (generation.file) {
      const file = generation.file;
      // Generated passwords stay transient; neither their length nor a template digest enters the reading.
      plan.generated.push({ target: file.target, source: generation.source });
      // The vendor overwrites this fragment, before it reads the effective users configuration.
      const before = userRoots.filter(root => root.file !== file.target);
      for (const root of userRoots.filter(root => root.file === file.target)) {
        const pending = [root]; while (pending.length) { const node = pending.pop()!; mark(node.file, node.path, 'superseded', 'Overwritten by the authenticated vendor entrypoint'); pending.push(...node.children); }
      }
      try {
        const document = await xml.parseDocument(new TextDecoder('utf-8', { fatal: true }).decode(file.bytes));
        const generated = xmlNode(document.root, file.target, '/' + document.root.name, path => mark(file.target, path, 'gap', 'Generated processing instruction is not served'));
        effectiveUsers = merge([...before, generated], usersMain ?? '');
      } catch (error) {
        if (error instanceof xml.XmlDocumentError) mark(file.target, '/', 'gap', error.message);
        else throw error;
      }
    }
    // With no database or initdb entries there is no initialization call, regardless of fresh/resumed data.
    if (generation.action !== 'gap' && !(carrier.start.environment.CLICKHOUSE_DB || '')
      && ![...carrier.inventory, ...carrier.imageInventory].some(entry => entry.target.startsWith('/docker-entrypoint-initdb.d/')))
      mark('/entrypoint.sh', 'initdb', 'applied', 'Vendor has no initial database or initdb entries to execute');
    else mark('/entrypoint.sh', 'initdb', 'gap', 'Database/initdb execution still needs the pinned initialization, user and resume contract');
  }
  for (const root of roots) if (!configRoots.includes(root) && !userRoots.includes(root)) gap(root, 'XML file is outside the declared main and fragment merge sets');
  for (const node of effective) {
    if (node.name === 'macros' && plain(node)) {
      const macros: Record<string, string> = Object.create(null);
      for (const child of node.children) { const value = scalar(child); if (value !== undefined) { if (Object.hasOwn(macros, child.name)) gap(child, 'Duplicate macro'); else { macros[child.name] = value; applied(child, 'Declared replication macro'); } } }
      plan.configuration.macros = macros; applied(node, 'Replication macro map');
    } else if (['http_port', 'tcp_port'].includes(node.name)) {
      const value = scalar(node), expected = node.name === 'http_port' ? '8123' : '9000';
      if (value === expected) applied(node, 'Named vendor listener, allocated by the World'); else gap(node, 'This vendor listener port is not served');
    } else if (node.name === 'remote_servers' && plain(node)) {
      const clusters: Record<string, string[]> = Object.create(null);
      for (const cluster of node.children) {
        const shard = cluster.children[0], replica = shard?.children[0];
        if (!plain(cluster) || cluster.children.length !== 1 || shard?.name !== 'shard' || !plain(shard) || shard.children.length !== 1 || replica?.name !== 'replica' || !plain(replica)) { gap(cluster, 'Only one declared local shard/replica is served'); continue; }
        const host = replica.children.find(child => child.name === 'host'), port = replica.children.find(child => child.name === 'port');
        if (replica.children.length !== 2 || !host || !port || !input.selfHosts.includes(scalar(host) ?? '') || scalar(port) !== '9000' || Object.hasOwn(clusters, cluster.name)) { gap(cluster, 'Remote, ambiguous or unsupported cluster topology'); continue; }
        clusters[cluster.name] = ['local']; applied(host, 'This declared server'); applied(port, 'Native wire'); applied(replica, 'Local replica'); applied(shard, 'Local shard'); applied(cluster, 'Local cluster');
      }
      plan.configuration.clusters = clusters; applied(node, 'Declared cluster map');
    } else if (node.name === 'users_config') {
      const path = scalar(node);
      if (path && input.files.some(file => file.target === (path.startsWith('/') ? path : '/etc/clickhouse-server/' + path))) applied(node, 'The declared users file is included in this reading'); else gap(node, 'The declared users file is absent');
    } else gap(node, `Server directive ${node.name} is not served`);
  }
  const profileModes = new Map<string, ReadonlyMode>();
  // source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/programs/server/users.xml "Profile that allows only read queries"
  for (const node of effectiveUsers.filter(node => node.name === 'profiles')) {
    if (!plain(node)) continue;
    let complete = true;
    for (const profile of node.children) {
      if (!plain(profile) || profileModes.has(profile.name)) { gap(profile, 'Duplicate or unsupported profile container'); complete = false; continue; }
      let mode: ReadonlyMode = 0, served = true;
      if (profile.children.length > 1 || profile.children.some(child => child.name !== 'readonly')) {
        gap(profile, 'Profile settings other than readonly are not served'); served = false;
      } else if (profile.children[0]) {
        const setting = profile.children[0], value = scalar(setting);
        try {
          mode = servedReadonly(value);
          applied(setting, 'Read-only policy enforced before HTTP/native query execution');
        } catch (error) { gap(setting, error instanceof Error ? error.message : 'The readonly profile value is not served'); served = false; }
      }
      if (served) { profileModes.set(profile.name, mode); applied(profile, 'Declared empty or read-only profile'); }
      else complete = false;
    }
    if (complete) applied(node, 'Declared profile map');
  }
  for (const node of effectiveUsers) {
    if (node.name === 'profiles') continue;
    if (node.name !== 'users' || !plain(node)) { gap(node, `User/profile/ACL directive ${node.name} is not served`); continue; }
    const map: Record<string, string> = Object.create(null);
    const policies: Record<string, UserPolicy> = Object.create(null);
    let complete = true;
    for (const user of node.children) {
      if (!plain(user) || new Set(user.children.map(child => child.name)).size !== user.children.length) { gap(user, 'Duplicate or unsupported user container'); complete = false; continue; }
      const password = user.children.find(child => child.name === 'password');
      if (!password) { gap(user, 'This authentication scheme is not served'); complete = false; continue; }
      const value = scalar(password);
      const issued = input.credentials && Object.hasOwn(input.credentials, user.name) ? input.credentials[user.name] : undefined;
      if (value === undefined) { complete = false; continue; }
      if ((value !== '' || password.text.length !== 0 || password.attrs.from_env !== undefined) && typeof issued !== 'string') { gap(password, 'A throwaway credential must be supplied for this source user'); complete = false; continue; }
      if (Object.hasOwn(map, user.name)) { gap(user, 'Duplicate source user'); complete = false; continue; }
      let served = true, mode: ReadonlyMode = 0;
      for (const field of user.children) {
        if (field === password) continue;
        if (field.name === 'profile') {
          const name = scalar(field), selected = name !== undefined ? profileModes.get(name) : undefined;
          if (selected === undefined) { gap(field, 'The selected profile is absent or contains unserved settings'); served = false; }
          else { mode = selected; applied(field, 'Selected read-only policy for this user'); }
        } else if (field.name === 'networks') {
          // source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/programs/server/users.xml "To open access from everywhere"
          if (!plain(field) || field.children.length !== 1 || field.children[0]?.name !== 'ip' || scalar(field.children[0]) !== '::/0') {
            gap(field, 'Restricted networks, DNS rules or an unsupported network set require a peer-address policy'); served = false;
          } else { applied(field.children[0], 'The vendor unrestricted network includes every peer'); applied(field, 'Unrestricted network policy'); }
        } else { gap(field, `User directive ${field.name} is not served`); served = false; }
      }
      applied(password, 'Issued throwaway credential or the source empty password');
      if (!served) { complete = false; continue; }
      map[user.name] = typeof issued === 'string' ? issued : '';
      policies[user.name] = { readonly: mode }; applied(user, 'Declared authentication and read-only policy');
    }
    plan.configuration.users = map; plan.configuration.userPolicies = policies;
    if (complete) applied(node, 'Declared user and policy maps');
  }
  plan.complete = !plan.directives.some(row => row.disposition === 'gap');
  return plan;
}
