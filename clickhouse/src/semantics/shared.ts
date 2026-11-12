import { clickhouse, type HandlerContext } from '@volter/world-core';
import { SqlError, Statement, splitTop, textOf } from '../engine/ddl.ts';
import { columnSupported } from '../engine/schema.ts';
const { defaultOf, executeSql, fromStored, isModeledSchemaType, parseDateText, parseSql, toStored } = clickhouse;
type ClickHouseColumn = clickhouse.ClickHouseColumn;
type Query = clickhouse.Query;
type QueryResult = clickhouse.QueryResult;
type Catalog = clickhouse.Catalog;
type Relation = clickhouse.Relation;

export type { ServerConfiguration } from '../engine/configuration.ts';

export const WIRE_HEADER = 'x-volter-clickhouse-native';

export type Table = { id: string; database: string; name: string; engine: string; columns: ClickHouseColumn[]; generation: number; storageKey?: string; replicationPath?: string; replica?: string; arguments: string[]; sortingKey: string[]; definition: string };
export const own = (ctx: HandlerContext, row: Record<string, unknown>): Record<string, unknown> => ctx.own(row);
export function databases(ctx: HandlerContext): string[] { return ['default', 'system', ...ctx.rows('database').map(row => String(own(ctx, row).name))]; }
export function tables(ctx: HandlerContext): Table[] {
  return ctx.rows('table').map(row => ({ ...own(ctx, row), id: String(row.id) } as Table));
}
export function table(ctx: HandlerContext, database: string, name: string): Table {
  const found = tables(ctx).find(row => row.database === database && row.name === name);
  if (!found) throw new SqlError(60, `Table ${database}.${name} does not exist`);
  return found;
}
export function cluster(ctx: HandlerContext, name: string | undefined): void {
  if (!name) return;
  const configuration = ctx.rows('_configuration').at(-1);
  const clusters = configuration ? own(ctx, configuration).clusters as Record<string, unknown> | undefined : undefined;
  const declared = clusters && Object.hasOwn(clusters, name) ? clusters[name] : undefined;
  if (!declared) throw new SqlError(701, `Requested cluster '${name}' not found`);
  // Distributed fanout cannot be invented from a name. This instance currently owns one local shard.
  if (!Array.isArray(declared) || declared.length !== 1 || declared[0] !== 'local') throw new SqlError(48, 'Remote cluster execution is not implemented');
}
function relation(columns: ClickHouseColumn[], rows: unknown[][]): Relation { return { columns, rows, declared: true }; }
export function catalog(ctx: HandlerContext, database: string): Catalog {
  const held = tables(ctx), rows = ctx.rows('row').map(row => own(ctx, row));
  const lookup = (target: Table, visited: Set<string>): Relation => {
    if (visited.has(target.id)) throw new SqlError(306, 'Distributed table cycle');
    visited.add(target.id);
    if (target.engine === 'Distributed') {
      const [name, db, source] = target.arguments;
      cluster(ctx, name);
      return lookup(table(ctx, db!, source!), visited);
    }
    return relation(target.columns, rows.filter(row => row.table === (target.storageKey ?? target.id) && row.generation === target.generation)
      .map(row => (row.values as unknown[]).map((value, i) => fromStored(value, target.columns[i]!.type))));
  };
  return { table(name, final) {
    const pieces = name.split('.'), db = pieces.length > 1 ? pieces[0]! : database, key = pieces.length > 1 ? pieces.slice(1).join('.') : name;
    if (db === 'system' && key === 'databases') return relation([{ name: 'name', type: 'String' }, { name: 'engine', type: 'String' }], databases(ctx).map(name => [name, 'Atomic']));
    if (db === 'system' && key === 'tables') return relation([
      { name: 'database', type: 'String' }, { name: 'name', type: 'String' }, { name: 'engine', type: 'String' }, { name: 'create_table_query', type: 'String' },
    ], held.map(row => [row.database, row.name, row.engine, row.definition]));
    if (db === 'system' && key === 'columns') return relation([
      { name: 'database', type: 'String' }, { name: 'table', type: 'String' }, { name: 'name', type: 'String' }, { name: 'type', type: 'String' },
    ], held.flatMap(row => row.columns.map(column => [row.database, row.name, column.name, column.type])));
    const target = held.find(row => row.database === db && row.name === key);
    if (!target) return undefined;
    if (final && !['Memory', 'MergeTree', 'ReplicatedMergeTree', 'Distributed'].includes(target.engine)) throw new SqlError(48, `FINAL for ${target.engine} is not implemented`);
    return lookup(target, new Set());
  } };
}

/** Local replicated tables coordinate through the same branch store, not a fabricated remote Keeper. */
export function replication(ctx: HandlerContext, args: string[], database: string, name: string): { replicationPath: string; replica: string; storageKey: string } {
  const record = ctx.rows('_configuration').at(-1), configuration = record ? own(ctx, record) : {};
  if (configuration.localReplication !== true) throw new SqlError(225, 'Replication coordination is not configured');
  const macros = { ...(configuration.macros as Record<string, string> | undefined), database, table: name };
  const expand = (value: string): string => value.replace(/\{([^}]+)\}/g, (_, key: string) => {
    if (!Object.hasOwn(macros, key)) throw new SqlError(137, `No macro ${key} in configuration`);
    return macros[key as keyof typeof macros]!;
  });
  const replicationPath = expand(args[0]!), replica = expand(args[1]!);
  if (!replicationPath.startsWith('/') || !replica || replica.includes('/')) throw new SqlError(36, 'Invalid replication path or replica');
  return { replicationPath, replica, storageKey: 'replication:' + replicationPath };
}

export type QueryOptions = { database: string; readonly: boolean; query: string; user?: string; data?: unknown[][]; describeInsert?: boolean };
const empty = (): QueryResult => ({ meta: [], data: [], rows: 0, rowsRead: 0, bytesRead: 0 });
const operation = 'query_post';
function sessionQuery(query: Query, options: QueryOptions): Query {
  // Session/server functions are facts of this connection, bound before the shared evaluator runs.
  const facts: Record<string, string> = { currentdatabase: options.database, currentuser: options.user ?? 'default', version: '26.9.13.15' };
  function bind(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(bind);
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (node.k === 'fn' && Object.hasOwn(facts, String(node.name).toLowerCase())) {
      if ((node.args as unknown[]).length) throw new SqlError(42, `${node.name} expects no arguments`);
      return { k: 'lit', v: facts[String(node.name).toLowerCase()], type: 'String', text: `${node.name}()` };
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, bind(child)]));
  }
  return bind(query) as Query;
}
function storedValue(value: unknown, type: string): unknown {
  const nullable = /^Nullable\((.*)\)$/.exec(type), array = /^Array\((.*)\)$/.exec(type);
  if (nullable) return value == null ? null : storedValue(value, nullable[1]!);
  if (value == null) throw new SqlError(53, 'NULL for a non-nullable column');
  if (array) { if (!Array.isArray(value)) throw new SqlError(53, 'Expected Array value'); return value.map(item => storedValue(item, array[1]!)); }
  if ((type === 'Date' || type === 'Date32') && typeof value === 'string') { const days = parseDateText(value); if (days === undefined || (type === 'Date' && (days < 0 || days > 65535))) throw new SqlError(27, `Cannot parse ${type}`); }
  const converted = toStored(value, type);
  if (/^Float(32|64)$/.test(type)) {
    const number = type === 'Float32' ? Math.fround(Number(converted)) : Number(converted);
    if (Number.isNaN(number) && String(value).toLowerCase() !== 'nan') throw new SqlError(27, 'Cannot parse Float');
    return Number.isFinite(number) ? number : String(number);
  }
  const fixed = /^FixedString\((\d+)\)$/.exec(type);
  if (fixed && new TextEncoder().encode(String(converted)).length > Number(fixed[1])) throw new SqlError(131, 'Too large value for FixedString');
  return converted;
}
function requireDatabase(ctx: HandlerContext, name: string): void { if (!databases(ctx).includes(name)) throw new SqlError(81, `Database ${name} does not exist`); }
function columnList(s: Statement): ClickHouseColumn[] {
  return splitTop(s.grouped()).map(items => {
    const name = items[0]; if (!name || name.string) throw new SqlError(62, 'Expected column name');
    const type = textOf(items.slice(1)).replace(/\s*([(),])\s*/g, '$1');
    if (!isModeledSchemaType(type)) throw new SqlError(50, `Unknown or unsupported data type ${type}`);
    if (!columnSupported(type)) throw new SqlError(48, `Column type ${type} is not implemented`);
    return { name: name.value, type };
  });
}
function targetForInsert(ctx: HandlerContext, target: Table): Table {
  const seen = new Set<string>();
  while (target.engine === 'Distributed') {
    if (seen.has(target.id)) throw new SqlError(306, 'Distributed table cycle'); seen.add(target.id);
    const [name, db, source] = target.arguments; cluster(ctx, name); target = table(ctx, db!, source!);
  }
  return target;
}
export async function execute(ctx: HandlerContext, options: QueryOptions): Promise<QueryResult> {
  ctx.call.request.signal.throwIfAborted();
  const s = new Statement(options.query), read = s.peek('SELECT') || s.peek('WITH') || s.peek('SHOW') || s.peek('DESCRIBE');
  if (!read && options.readonly) throw new SqlError(164, 'Cannot execute query in readonly mode');
  requireDatabase(ctx, options.database);
  if (s.take('CREATE')) {
    if (s.take('DATABASE')) {
      const ifNotExists = s.ifNotExists(), name = s.name(); cluster(ctx, s.cluster()); s.finish();
      if (databases(ctx).includes(name)) { if (ifNotExists) return empty(); throw new SqlError(82, `Database ${name} already exists`); }
      ctx.legal('database', '_present', operation, false, 'true');
      const created = await ctx.createUnique('database', { name, engine: 'Atomic', _present: true }, operation);
      if (!created.created && !ifNotExists) throw new SqlError(82, `Database ${name} already exists`);
      return empty();
    }
    s.need('TABLE'); const ifNotExists = s.ifNotExists(), address = s.qualified(options.database);
    cluster(ctx, s.cluster()); requireDatabase(ctx, address.database);
    const columns = columnList(s);
    if (new Set(columns.map(c => c.name)).size !== columns.length) throw new SqlError(15, 'Duplicate column');
    s.need('ENGINE'); s.take('='); const engine = s.name();
    const args = s.peek('(') ? splitTop(s.grouped()).map(items => items.length === 1 ? items[0]!.value : textOf(items)) : [];
    if (!['Memory', 'MergeTree', 'ReplicatedMergeTree', 'Distributed'].includes(engine)) throw new SqlError(48, `Table engine ${engine} is not implemented`);
    if ((engine === 'Memory' || engine === 'MergeTree') && args.length) throw new SqlError(42, `${engine} takes no engine arguments`);
    if (engine === 'ReplicatedMergeTree' && args.length !== 2) throw new SqlError(42, 'ReplicatedMergeTree requires a path and replica name');
    if (engine === 'Distributed') {
      if (args.length < 3 || args.length > 4) throw new SqlError(42, 'Distributed requires cluster, database, table, optional sharding key');
      cluster(ctx, args[0]);
    }
    let sortingKey: string[] = []; let partitionBy = '';
    if (s.take('PARTITION')) { s.need('BY'); const start = s.at; while (s.peek() && !s.peek('ORDER') && !s.peek('SETTINGS') && !s.peek(';')) s.at++; partitionBy = textOf(s.items.slice(start, s.at)); }
    if (s.take('ORDER')) {
      s.need('BY'); sortingKey = s.peek('(') ? splitTop(s.grouped()).map(items => items.length === 1 ? items[0]!.value : textOf(items)) : [s.name()];
      for (const name of sortingKey) if (!columns.some(column => column.name === name)) throw new SqlError(47, `Unknown sorting column ${name}`);
    }
    if (engine.endsWith('MergeTree') && !sortingKey.length) throw new SqlError(42, 'MergeTree requires ORDER BY');
    const settings: Record<string, string> = {};
    if (s.take('SETTINGS')) do { const name = s.name(); s.need('='); const value = s.items[s.at++]; if (!value) throw new SqlError(62, 'Expected setting value'); if (name !== 'index_granularity') throw new SqlError(115, `Unknown setting ${name}`); settings[name] = value.value; } while (s.take(','));
    s.finish();
    const existing = tables(ctx).find(row => row.database === address.database && row.name === address.name);
    if (existing) { if (ifNotExists) return empty(); throw new SqlError(57, `Table ${address.database}.${address.name} already exists`); }
    ctx.legal('table', '_present', operation, false, 'true');
    const replicated = engine === 'ReplicatedMergeTree' ? replication(ctx, args, address.database, address.name) : undefined;
    if (replicated) {
      const schema = JSON.stringify({ columns, sortingKey, partitionBy });
      const held = await ctx.createUnique('_replication', { path: replicated.replicationPath, schema }, operation);
      if (String(ctx.own(held.row).schema) !== schema) throw new SqlError(122, 'Replication schema differs');
    }
    const created = await ctx.createUnique('table', { ...address, ...replicated, columns, engine, arguments: args, sortingKey, partitionBy, settings, generation: 0, definition: options.query, _present: true }, operation);
    if (!created.created) {
      const held = ctx.own(created.row);
      if (held.database !== address.database || held.name !== address.name) throw new SqlError(253, 'Replica already exists');
      if (!ifNotExists) throw new SqlError(57, `Table ${address.database}.${address.name} already exists`);
    }
    return empty();
  }
  if (s.take('INSERT')) {
    s.need('INTO'); const address = s.qualified(options.database), declared = table(ctx, address.database, address.name);
    const names = s.peek('(') ? splitTop(s.grouped()).map(items => { if (items.length !== 1) throw new SqlError(62, 'Expected column name'); return items[0]!.value; }) : declared.columns.map(c => c.name);
    if (new Set(names).size !== names.length || names.some(name => !declared.columns.some(c => c.name === name))) throw new SqlError(16, 'Unknown or duplicate insert column');
    const columns = names.map(name => declared.columns.find(c => c.name === name)!);
    if (options.describeInsert || options.data) {
      // Native clients send an INSERT header followed by typed blocks. Refuse other SQL before its sample/write.
      s.take('VALUES'); s.finish();
      if (options.describeInsert) return { ...empty(), meta: columns };
    }
    let input = options.data;
    if (!input && s.take('VALUES')) {
      input = [];
      do {
        const values = textOf(s.grouped());
        const result = executeSql(parseSql('SELECT ' + values), { table: () => undefined }, Date.parse(ctx.occurredAt));
        if (result.rows !== 1) throw new SqlError(62, 'Expected one VALUES tuple');
        input.push(result.meta.map(column => result.data[0]![column.name]));
      } while (s.take(','));
      s.finish();
    } else if (!input && s.take('FORMAT')) {
      const format = s.name(); if (format !== 'JSONEachRow') throw new SqlError(73, `Format ${format} is not implemented`);
      const offset = s.items[s.at - 1]!.end;
      const payload = options.query.slice(offset).trim();
      input = payload ? payload.split('\n').filter(line => line.trim()).map(line => {
        let row: Record<string, unknown>; try { row = JSON.parse(line); } catch { throw new SqlError(27, 'Cannot parse JSONEachRow'); }
        if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(name => !names.includes(name))) throw new SqlError(117, 'Unknown JSONEachRow field');
        return names.map(name => Object.hasOwn(row, name) ? row[name] : defaultOf(columns[names.indexOf(name)]!.type));
      }) : [];
    }
    if (!input) throw new SqlError(62, 'INSERT requires data');
    const target = targetForInsert(ctx, declared);
    if (target.columns.length !== declared.columns.length || target.columns.some((column, i) => column.name !== declared.columns[i]!.name || column.type !== declared.columns[i]!.type)) throw new SqlError(53, 'Distributed destination schema differs');
    // Validate and convert the whole block before making its first write.
    const rows = input.map(row => {
      if (row.length !== names.length) throw new SqlError(20, 'Number of columns does not match');
      return target.columns.map(column => storedValue(names.includes(column.name) ? row[names.indexOf(column.name)] : defaultOf(column.type), column.type));
    });
    for (const values of rows) { ctx.legal('row', '_present', operation, false, 'true'); await ctx.create('row', { table: target.storageKey ?? target.id, generation: target.generation, values, _present: true }, operation); }
    return empty();
  }
  if (s.take('SYSTEM')) {
    s.need('FLUSH'); s.need('LOGS'); s.finish();
    const configuration = ctx.rows('_configuration').at(-1);
    // Flush has no pending work only when the operator explicitly disabled system logging.
    // Enabled query/system log tables are an unimplemented capability, never acknowledged as flushed.
    if (!configuration || ctx.own(configuration).systemLogs !== 'disabled') throw new SqlError(48, 'Enabled system logs are not implemented');
    return empty();
  }
  if (s.take('DESCRIBE')) {
    s.take('TABLE'); const address = s.qualified(options.database); s.finish(); const target = table(ctx, address.database, address.name);
    const meta = ['name', 'type', 'default_type', 'default_expression', 'comment', 'codec_expression', 'ttl_expression'].map(name => ({ name, type: 'String' }));
    const data = target.columns.map(column => Object.fromEntries(meta.map(field => [field.name, field.name === 'name' ? column.name : field.name === 'type' ? column.type : ''])));
    return { meta, data, rows: data.length, rowsRead: data.length, bytesRead: 0 };
  }
  if (s.take('SHOW')) {
    if (s.take('DATABASES')) { s.finish(); const data = databases(ctx).map(name => ({ name })); return { meta: [{ name: 'name', type: 'String' }], data, rows: data.length, rowsRead: data.length, bytesRead: 0 }; }
    s.need('TABLES'); const db = s.take('FROM') ? s.name() : options.database; s.finish(); requireDatabase(ctx, db);
    const data = tables(ctx).filter(row => row.database === db).map(row => ({ name: row.name })); return { meta: [{ name: 'name', type: 'String' }], data, rows: data.length, rowsRead: data.length, bytesRead: 0 };
  }
  if (read) return executeSql(sessionQuery(parseSql(options.query), options), catalog(ctx, options.database), Date.parse(ctx.occurredAt));
  throw new SqlError(48, 'Query statement is not implemented');
}
