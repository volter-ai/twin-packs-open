// The bootstrap column subset shared by both ClickHouse transports.
export function columnSupported(type: string): boolean {
  if (/^(?:U?Int(?:8|16|32|64)|Float(?:32|64)|String|Date|Date32|DateTime)$/.test(type)) return true;
  const fixed = /^FixedString\(([1-9][0-9]*)\)$/.exec(type);
  if (fixed) return Number.isSafeInteger(Number(fixed[1])) && Number(fixed[1]) <= 0x40000000;
  const wrapper = /^(Array|Nullable)\((.*)\)$/.exec(type);
  if (wrapper) return !(wrapper[1] === 'Nullable' && /^(Nullable|Array)\(/.test(wrapper[2]!)) && columnSupported(wrapper[2]!);
  const date = /^DateTime\('([^']+)'\)$/.exec(type);
  if (date) { try { new Intl.DateTimeFormat('en', { timeZone: date[1] }); return true; } catch { return false; } }
  return false;
}
export function minimumColumnBytes(type: string): number {
  const integer = /^U?Int(8|16|32|64)$/.exec(type), fixed = /^FixedString\(([1-9][0-9]*)\)$/.exec(type);
  if (integer) return Number(integer[1]) / 8;
  if (fixed) return Number(fixed[1]);
  if (type === 'Float64') return 8;
  if (type === 'Float32' || type === 'Date32' || type.startsWith('DateTime')) return 4;
  if (type === 'Date') return 2;
  return 1;
}
