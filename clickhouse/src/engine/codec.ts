// Native packet/block primitives from the vendor protocol reference. No state lives here.
// source: https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/docs/native-protocol/basics.md "For lengths, packet codes and other cases"
import { clickhouse } from '@volter/world-core';
const { ClickHouseCompressionError, decodeFrame, defaultOf, DT, encodeFrame, fromStored, parseDateText, toOutput } = clickhouse;
type ClickHouseColumn = clickhouse.ClickHouseColumn;
type QueryResult = clickhouse.QueryResult;
import { columnSupported, minimumColumnBytes } from './schema.ts';
import { SqlError } from './ddl.ts';

export class NeedMore extends Error {}
const decoder = new TextDecoder('utf-8', { fatal: true }), encoder = new TextEncoder();
export class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  take(n: number): Uint8Array { if (!Number.isSafeInteger(n) || n < 0) throw new SqlError(117, 'Invalid native length'); if (n > this.bytes.length - this.at) throw new NeedMore(); const out = this.bytes.subarray(this.at, this.at + n); this.at += n; return out; }
  byte(): number { return this.take(1)[0]!; }
  uint(): bigint {
    let result = 0n;
    for (let n = 0; n < 10; n++) { const value = this.byte(); if (n === 9 && value > 1) throw new SqlError(117, 'Invalid VarUInt'); result |= BigInt(value & 127) << BigInt(n * 7); if (!(value & 128)) return result; }
    throw new SqlError(117, 'Invalid VarUInt');
  }
  number(): number { const value = this.uint(); if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new SqlError(48, 'Native length exceeds the representable address domain'); return Number(value); }
  integer(size: number, signed = false): bigint {
    const bytes = this.take(size); let value = 0n;
    for (let i = 0; i < size; i++) value |= BigInt(bytes[i]!) << BigInt(i * 8);
    return signed ? BigInt.asIntN(size * 8, value) : value;
  }
  string(): string { try { return decoder.decode(this.take(this.number())); } catch (error) { if (error instanceof NeedMore) throw error; throw new SqlError(48, 'Non-UTF8 native String values are not implemented'); } }
}
export class Writer {
  private parts: Uint8Array[] = [];
  raw(bytes: Uint8Array): this { this.parts.push(bytes); return this; }
  byte(value: number): this { return this.raw(Uint8Array.of(value)); }
  uint(value: number | bigint): this { let remaining = BigInt(value); if (remaining < 0n || remaining > 0xffffffffffffffffn) throw new SqlError(117, 'Invalid VarUInt'); do { const byte = Number(remaining & 127n); remaining >>= 7n; this.byte(byte | (remaining ? 128 : 0)); } while (remaining); return this; }
  integer(value: number | bigint, size: number): this { let remaining = BigInt.asUintN(size * 8, BigInt(value)); const bytes = new Uint8Array(size); for (let i = 0; i < size; i++) { bytes[i] = Number(remaining & 255n); remaining >>= 8n; } return this.raw(bytes); }
  string(value: string): this { const bytes = encoder.encode(value); return this.uint(bytes.length).raw(bytes); }
  finish(): Uint8Array { const out = new Uint8Array(this.parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of this.parts) { out.set(part, offset); offset += part.length; } return out; }
}
function child(type: string, name: string): string | undefined { const match = new RegExp('^' + name + '\\((.*)\\)$', 's').exec(type); return match?.[1]; }
function readColumn(reader: Reader, type: string, count: number): unknown[] {
  const nullable = child(type, 'Nullable');
  if (nullable) { const nulls = reader.take(count), values = readColumn(reader, nullable, count); return values.map((value, i) => nulls[i] ? null : value); }
  const array = child(type, 'Array');
  if (array) {
    const offsets: number[] = []; let last = 0;
    for (let i = 0; i < count; i++) { const value = reader.integer(8); if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(last)) throw new SqlError(117, 'Invalid Array offset'); last = Number(value); offsets.push(last); }
    const values = readColumn(reader, array, last); let start = 0;
    return offsets.map(end => { const row = values.slice(start, end); start = end; return row; });
  }
  if (!columnSupported(type)) throw new SqlError(48, `Native column type ${type} is not implemented`);
  if (count > Math.floor((reader.bytes.length - reader.at) / minimumColumnBytes(type))) throw new NeedMore();
  const integer = /^(U?Int)(8|16|32|64)$/.exec(type);
  if (integer) return Array.from({ length: count }, () => { const value = reader.integer(Number(integer[2]) / 8, integer[1] === 'Int'); return Number(integer[2]) === 64 ? value.toString() : Number(value); });
  if (type === 'String') return Array.from({ length: count }, () => reader.string());
  const fixed = /^FixedString\((\d+)\)$/.exec(type);
  if (fixed) return Array.from({ length: count }, () => { try { return decoder.decode(reader.take(Number(fixed[1]))); } catch (error) { if (error instanceof NeedMore) throw error; throw new SqlError(48, 'Non-UTF8 FixedString values are not implemented'); } });
  if (type === 'Float32' || type === 'Float64') return Array.from({ length: count }, () => { const size = type === 'Float32' ? 4 : 8, raw = reader.take(size), view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength); return size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true); });
  if (type === 'Date' || type === 'Date32') return Array.from({ length: count }, () => new Date(Number(reader.integer(type === 'Date' ? 2 : 4, type === 'Date32')) * 86400000).toISOString().slice(0, 10));
  if (/^DateTime(?:\('.*'\))?$/.test(type)) return Array.from({ length: count }, () => Number(reader.integer(4)));
  throw new SqlError(48, `Native column type ${type} is not implemented`);
}
function writeColumn(writer: Writer, type: string, values: unknown[]): void {
  const nullable = child(type, 'Nullable');
  if (nullable) { writer.raw(Uint8Array.from(values, value => value == null ? 1 : 0)); writeColumn(writer, nullable, values.map(value => value ?? toOutput(defaultOf(nullable)))); return; }
  const array = child(type, 'Array');
  if (array) { let offset = 0; const all: unknown[] = []; for (const value of values) { if (!Array.isArray(value)) throw new SqlError(53, 'Expected Array'); offset += value.length; writer.integer(offset, 8); all.push(...value); } writeColumn(writer, array, all); return; }
  const integer = /^(U?Int)(8|16|32|64)$/.exec(type);
  if (integer) { for (const value of values) writer.integer(BigInt(String(value)), Number(integer[2]) / 8); return; }
  if (type === 'String') { for (const value of values) writer.string(String(value)); return; }
  const fixed = /^FixedString\((\d+)\)$/.exec(type);
  if (fixed) { const size = Number(fixed[1]); for (const value of values) { const raw = encoder.encode(String(value)); if (raw.length > size) throw new SqlError(131, 'Too large value for FixedString'); const bytes = new Uint8Array(size); bytes.set(raw); writer.raw(bytes); } return; }
  if (type === 'Float32' || type === 'Float64') { const size = type === 'Float32' ? 4 : 8; for (const value of values) { const raw = new Uint8Array(size), view = new DataView(raw.buffer); if (size === 4) view.setFloat32(0, Number(value), true); else view.setFloat64(0, Number(value), true); writer.raw(raw); } return; }
  if (type === 'Date' || type === 'Date32') { for (const value of values) { const days = parseDateText(String(value)); if (days === undefined) throw new SqlError(27, 'Cannot parse Date'); writer.integer(days, type === 'Date' ? 2 : 4); } return; }
  if (/^DateTime(?:\('.*'\))?$/.test(type)) { for (const value of values) { const date = fromStored(value, type); if (!(date instanceof DT)) throw new SqlError(27, 'Cannot parse DateTime'); writer.integer(Math.floor(date.ms / 1000), 4); } return; }
  throw new SqlError(48, `Native column type ${type} is not implemented`);
}
export type Block = { columns: ClickHouseColumn[]; rows: unknown[][] };
export function readCompressedBlock(reader: Reader): Block {
  let plain = new Uint8Array();
  while (true) {
    let frame: ReturnType<typeof decodeFrame>;
    try { frame = decodeFrame(reader.bytes.subarray(reader.at)); }
    catch (error) { if (error instanceof ClickHouseCompressionError) throw new SqlError(error.code, error.message); throw error; }
    if (!frame) throw new NeedMore(); reader.at += frame.bytesRead;
    const joined = new Uint8Array(plain.length + frame.data.length); joined.set(plain); joined.set(frame.data, plain.length); plain = joined;
    const blockReader = new Reader(plain);
    try { const block = readBlock(blockReader); if (blockReader.at !== plain.length) throw new SqlError(117, 'Unexpected decoded trailing bytes'); return block; }
    catch (error) { if (!(error instanceof NeedMore)) throw error; }
  }
}
export function readBlock(reader: Reader): Block {
  while (true) { const field = reader.number(); if (!field) break; if (field === 1) reader.byte(); else if (field === 2) reader.integer(4, true); else throw new SqlError(117, 'Unknown BlockInfo field'); }
  const count = reader.number(), rows = reader.number(), columns: ClickHouseColumn[] = [], values: unknown[][] = [];
  if (!count && rows) throw new SqlError(117, 'Rows without columns');
  if (count > Math.floor((reader.bytes.length - reader.at) / 2)) throw new NeedMore();
  for (let i = 0; i < count; i++) { const name = reader.string(), type = reader.string(); columns.push({ name, type }); values.push(readColumn(reader, type, rows)); }
  return { columns, rows: Array.from({ length: rows }, (_, row) => values.map(column => column[row])) };
}
export function dataPacket(result: QueryResult, header = false, compressed = false): Uint8Array {
  const writer = new Writer().uint(1).byte(0).uint(2).integer(-1, 4).uint(0);
  writer.uint(result.meta.length).uint(header ? 0 : result.rows);
  for (const column of result.meta) { writer.string(column.name).string(column.type); writeColumn(writer, column.type, header ? [] : result.data.map(row => row[column.name])); }
  const body = writer.finish(), packet = new Writer().uint(1).string('');
  if (!compressed) return packet.raw(body).finish();
  // Flush at ordinary ClickHouse1MiB compression-block boundaries. A native block may span frames.
  for (let at = 0; at < body.length; at += 0x100000) packet.raw(encodeFrame(body.subarray(at, at + 0x100000)));
  return packet.finish();
}
export function exception(error: unknown): Uint8Array { const code = error instanceof SqlError ? error.code : 1002; return new Writer().uint(2).integer(code, 4).string('DB::Exception').string(error instanceof Error ? error.message : String(error)).string('').byte(0).finish(); }
export const endOfStream = (): Uint8Array => new Writer().uint(5).finish();
