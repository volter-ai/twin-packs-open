import { clickhouse } from '@volter/world-core';
const { stringifyJson, toOutput, valueToText } = clickhouse;
type QueryResult = clickhouse.QueryResult;
import { SqlError } from './ddl.ts';

const escape = (value: unknown): string => value == null ? '\\N' : valueToText(value).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\0');
export function formatResult(result: QueryResult, format: string): { body: string; type: string } {
  const meta = result.meta.map(({ name, type }) => ({ name, type }));
  const arrays = result.data.map(row => result.meta.map(column => toOutput(row[column.name])));
  if (format === 'JSON' || format === 'JSONCompact') {
    const data = format === 'JSONCompact' ? arrays : result.data.map(row => Object.fromEntries(result.meta.map(column => [column.name, toOutput(row[column.name])])));
    return { body: stringifyJson({ meta, data, rows: result.rows, statistics: { rows_read: result.rowsRead, bytes_read: result.bytesRead } }) + '\n', type: 'application/json' };
  }
  if (format === 'JSONEachRow' || format === 'JSONCompactEachRow' || format === 'JSONStringsEachRow') {
    const data = format === 'JSONCompactEachRow' ? arrays : result.data.map(row => Object.fromEntries(result.meta.map(column => [column.name, format === 'JSONStringsEachRow' ? valueToText(row[column.name]) : toOutput(row[column.name])])));
    return { body: data.map(stringifyJson).join('\n') + (data.length ? '\n' : ''), type: 'application/x-ndjson' };
  }
  if (['TabSeparated', 'TSV', 'TabSeparatedWithNames', 'TabSeparatedWithNamesAndTypes'].includes(format)) {
    const lines: string[] = [];
    if (format.includes('WithNames')) lines.push(result.meta.map(column => escape(column.name)).join('\t'));
    if (format.includes('AndTypes')) lines.push(result.meta.map(column => escape(column.type)).join('\t'));
    lines.push(...result.data.map(row => result.meta.map(column => escape(row[column.name])).join('\t')));
    return { body: lines.join('\n') + (lines.length ? '\n' : ''), type: 'text/tab-separated-values; charset=utf-8' };
  }
  if (format === 'CSV' || format === 'CSVWithNames') {
    const quoted = (value: unknown): string => '"' + (value == null ? '\\N' : valueToText(value)).replace(/"/g, '""') + '"';
    const lines = format === 'CSVWithNames' ? [result.meta.map(column => quoted(column.name)).join(',')] : [];
    lines.push(...result.data.map(row => result.meta.map(column => quoted(row[column.name])).join(',')));
    return { body: lines.join('\n') + (lines.length ? '\n' : ''), type: 'text/csv; charset=utf-8' };
  }
  throw new SqlError(73, `Unknown or unsupported format ${format}`);
}
