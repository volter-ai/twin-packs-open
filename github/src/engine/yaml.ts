// The YAML a workflow file is written in (https://yaml.org/spec/1.2.2/), read as far as a workflow uses it: block
// mappings and sequences by indentation, flow sequences and mappings (`[main]`, `{a: b}`), plain, single- and
// double-quoted scalars, literal and folded block scalars (`|`, `>`), and comments. Anchors, tags and multiple documents
// are not read (a workflow has none).

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
type Line = { indent: number; text: string };

/** A scalar as YAML's core schema reads it. */
function scalar(raw: string): Value {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) return JSON.parse(s.replace(/\\'/g, "'")) as string;
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('[') || s.startsWith('{')) return flow(s);
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** A flow collection: `[a, b]`, `{a: b, c: [d]}`. */
function flow(s: string): Value {
  let i = 0;
  const skip = (): void => { while (i < s.length && /\s/.test(s[i]!)) i += 1; };
  const item = (): Value => {
    skip();
    if (s[i] === '[') { i += 1; const out: Value[] = []; skip(); if (s[i] === ']') { i += 1; return out; } for (;;) { out.push(item()); skip(); if (s[i] === ',') { i += 1; continue; } i += 1; return out; } }
    if (s[i] === '{') {
      i += 1; const out: Record<string, Value> = {}; skip(); if (s[i] === '}') { i += 1; return out; }
      for (;;) { skip(); const key = String(token(':')); i += 1; out[key] = item(); skip(); if (s[i] === ',') { i += 1; continue; } i += 1; return out; }
    }
    return scalar(String(token(',]}')));
  };
  const token = (stops: string): string => {
    skip();
    if (s[i] === '"' || s[i] === "'") { const q = s[i]!; let j = i + 1; while (j < s.length && s[j] !== q) j += s[j] === '\\' ? 2 : 1; const t = s.slice(i, j + 1); i = j + 1; return t; }
    let j = i; while (j < s.length && !stops.includes(s[j]!)) j += 1; const t = s.slice(i, j).trim(); i = j; return t;
  };
  return item();
}

/** A line's content without its comment (a `#` after a space, outside quotes). */
function uncomment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]!))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

/** A YAML document's value. */
export function parseYaml(source: string): Value {
  const lines: Line[] = source.split(/\r?\n/).map((raw) => ({ indent: raw.length - raw.trimStart().length, text: raw })).filter((l) => uncomment(l.text).trim() !== '' && l.text.trim() !== '---');
  let at = 0;
  const block = (indent: number): Value => {
    const first = lines[at];
    if (!first || first.indent < indent) return null;
    const trimmed = uncomment(first.text).trim();
    return trimmed.startsWith('- ') || trimmed === '-' ? sequence(first.indent) : mapping(first.indent);
  };
  const blockScalar = (style: string, parentIndent: number): string => {
    const body: string[] = [];
    let inner = -1;
    while (at < lines.length) {
      const l = lines[at]!;
      if (l.indent <= parentIndent) break;
      if (inner < 0) inner = l.indent;
      body.push(l.text.slice(inner));
      at += 1;
    }
    return style.startsWith('|') ? `${body.join('\n')}\n` : `${body.join(' ')}\n`;
  };
  const valueAfter = (rest: string, indent: number): Value => {
    if (rest === '') { at += 1; const next = lines[at]; return next && next.indent > indent ? block(next.indent) : null; }
    if (rest === '|' || rest === '>' || /^[|>][-+]?$/.test(rest)) { at += 1; return blockScalar(rest, indent); }
    at += 1;
    return scalar(rest);
  };
  const mapping = (indent: number): Value => {
    const out: Record<string, Value> = {};
    while (at < lines.length && lines[at]!.indent === indent) {
      const text = uncomment(lines[at]!.text).trim();
      const m = /^("[^"]*"|'[^']*'|[^:]+?):(\s+(.*))?$/.exec(text);
      if (!m) break;
      const key = String(scalar(m[1]!));
      out[key] = valueAfter((m[3] ?? '').trim(), indent);
    }
    return out;
  };
  const sequence = (indent: number): Value => {
    const out: Value[] = [];
    while (at < lines.length && lines[at]!.indent === indent && /^-(\s|$)/.test(uncomment(lines[at]!.text).trim())) {
      const text = uncomment(lines[at]!.text).trim().slice(1).trim();
      if (text === '') { at += 1; out.push(block(lines[at]?.indent ?? indent + 2)); continue; }
      // `- key: value` begins a mapping whose further keys sit under the key's column
      if (/^("[^"]*"|'[^']*'|[^:[{]+?):(\s|$)/.test(text)) {
        const column = lines[at]!.text.indexOf(text);
        lines[at] = { indent: column, text: ' '.repeat(column) + text };
        out.push(mapping(column));
        continue;
      }
      at += 1;
      out.push(scalar(text));
    }
    return out;
  };
  return block(lines[0]?.indent ?? 0);
}
