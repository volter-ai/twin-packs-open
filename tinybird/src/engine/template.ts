// Tinybird's TEMPLATE LANGUAGE — the `%`-marked node SQL an Endpoint's request parameters flow
// through before ClickHouse sees it.
//
// Tinybird renders a node with a Tornado template whose expressions are Python, extended by its own
// functions (`defined`, the typed parameter functions `String(…)`, `Int32(…)`, `Array(…, 'String')`,
// `DateTime64(…)`, `Boolean(…)`, `JSON(…)`, `column(…)`, …). The reference for every rule here is
// the vendor's own implementation as shipped in `tinybird-cli` (`tinybird/sql_template.py`,
// `tinybird/tornado_template.py`, `tinybird/datatypes.py`); the semantics transcribed from it:
//
//   • Every name the template mentions is a variable. At request time a parameter the caller did
//     not send is `None`: `defined(x)` is False, `x == 'a'` is False, and a typed function without a
//     default raises "Required parameter is not defined". At PUBLISH time (the vendor's `test_mode`)
//     every variable is a Placeholder instead, so every branch renders with type-shaped stand-ins
//     (`'__no_value__'`, `0`, `'2019-01-01 00:00:00'`), which is how a broken node is refused at
//     create rather than at first call.
//   • `{{ expr }}` goes through `expression_wrapper`: a Python str renders as a quoted, escaped SQL
//     literal; a typed function's result renders as SQL (`Int32(x)` → `toInt32('5')`, `Array(x,
//     'String')` → `['a','b']`, `Boolean(x)` → `1`); `None` is the error "expression … evaluated to
//     null".
//   • Parameters typed `Array(…)` anywhere in the template arrive pre-split on commas
//     (`preprocess_variables`), so `{% for v in values %}` over a comma list iterates its items.
//
// Modeled statements: `{% if %}` / `{% elif %}` / `{% else %}` / `{% end %}`, `{% for x in … %}`,
// `{% set x = … %}`, `{# comment #}`. Modeled Python: literals (str, int, float, True/False/None,
// lists, dicts), names, calls with keyword arguments, attribute calls on str/list/dict (`get`,
// `startswith`, `endswith`, `split`, `lower`, `upper`, `strip`, `join`, `replace`), subscripts,
// `+ - * / %`, comparisons (`== != < <= > >= in not in is is not`), `and` / `or` / `not`, and the
// conditional expression `a if c else b`. Anything else (imports, lambdas, other statements, other
// functions) is refused with the vendor's 400, never guessed.

import { TinybirdQueryError } from './values.ts';

/** A template the vendor refuses to render (a 400 unless `custom_error` chose a status). */
export class TemplateError extends TinybirdQueryError {
  constructor(message: string, status = 400, readonly body?: unknown) {
    super(message, status);
    this.name = 'TemplateError';
  }
}

const REQUIRED_PARAM_NOT_DEFINED = 'Required parameter is not defined';

// ── template values ─────────────────────────────────────────────────────────────────────────

/** A variable with no value at publish time (the vendor's `Placeholder`). */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "class Placeholder:"
class Placeholder {
  constructor(readonly name = '__no_value__', readonly line = 1) {}
}
/** Raw SQL a template function produced (`Expression` / `Symbol` in the vendor's code). */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "class Expression(str):"
class RawSql {
  constructor(readonly sql: string) {}
}
/** A typed number (`Integer` / `Float`): compares as a number, renders as `toInt32('5')`. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "class Integer(int):"
class TypedNumber {
  constructor(readonly value: number | bigint, readonly type: string, readonly float: boolean) {}
}
/** A Python float (so `str()` prints `1.0`, not `1`). */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "class Float(float):"
class PyFloat {
  constructor(readonly value: number) {}
}

type TValue = string | number | bigint | boolean | null | PyFloat | TypedNumber | RawSql | Placeholder | TValue[] | { [k: string]: TValue } | TFunction;
type TFunction = { call: (args: TValue[], kwargs: Record<string, TValue>) => TValue };

const isFn = (v: TValue): v is TFunction => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as TFunction).call === 'function';
const isDict = (v: TValue): v is { [k: string]: TValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Placeholder) && !(v instanceof RawSql) && !(v instanceof TypedNumber) && !(v instanceof PyFloat) && !isFn(v);

function num(v: TValue): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof TypedNumber || v instanceof PyFloat) return Number(v.value);
  return undefined;
}
/** An exact Python int (a JS number while safe, a bigint beyond ±2^53), or undefined. */
function pyInt(v: TValue): number | bigint | undefined {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof TypedNumber && !v.float) return v.value;
  return undefined;
}
const normBig = (v: bigint): number | bigint => (v >= -9007199254740991n && v <= 9007199254740991n ? Number(v) : v);


function truthy(v: TValue): boolean {
  if (v === null || v === false || v === '' || v === 0) return false;
  if (v instanceof TypedNumber || v instanceof PyFloat) return v.value !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof RawSql) return v.sql !== '';
  if (isDict(v)) return Object.keys(v).length > 0;
  return true;
}

function pyStr(v: TValue): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  // a float renders as JavaScript prints it: no demanded pipe renders one
  if (v instanceof PyFloat) return String(v.value);
  if (v instanceof TypedNumber) {
    const shown = String(v.value);
    return `to${v.type}('${shown}')`;
  }
  if (v instanceof RawSql) return v.sql;
  if (v instanceof Placeholder) return '__no_value__';
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (isDict(v)) return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
  return '<function>';
}
function pyRepr(v: TValue): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return pyStr(v);
}

function pyEquals(a: TValue, b: TValue): boolean {
  const na = num(a);
  const nb = num(b);
  if (na !== undefined && nb !== undefined) return na === nb;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => pyEquals(x, b[i]!));
  if (a instanceof RawSql && typeof b === 'string') return a.sql === b;
  if (typeof a === 'string' && b instanceof RawSql) return a === b.sql;
  return a === b;
}

// ── SQL escaping (the vendor's `sqlescape_for_string_expression`) ───────────────────────────

const ESCAPES: Record<string, string> = {
  '\0': '\\0', '\r': '\\r', '\b': '\\b', '\t': '\\t', '\x1a': '\\z', '\n': '\\n',
  '"': '\\"', "'": "\\'", '\\': '\\\\', '%': '\\%', '`': '\\`',
};
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def sqlescape_generator(translations):"
function sqlString(s: string): string {
  let out = "'";
  for (const ch of s) out += ESCAPES[ch] ?? ch;
  return `${out}'`;
}
const SYMBOL_ESCAPES: Record<string, string> = { ...ESCAPES, '"': '' };
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def symbol(x, quote=\"`\"):"
function sqlEscapeSymbol(s: string): string {
  let out = '';
  for (const ch of s) out += SYMBOL_ESCAPES[ch] ?? ch;
  return out;
}

/** `expression_wrapper` + `str()`: what `{{ expr }}` writes into the SQL. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def expression_wrapper(x, name, escape_arrays: bool = False):"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "f'expression \"{truncated_name}\" evaluated to null'"
function renderExpression(v: TValue, source: string): string {
  if (typeof v === 'string') return sqlString(v);
  if (v instanceof Placeholder) return "'__no_value__'";
  if (v === null) {
    const shown = source.length > 20 ? `${source.slice(0, 20)}...` : source;
    throw new TemplateError(`Template Syntax Error: expression "${shown}" evaluated to null`);
  }
  return pyStr(v);
}

// ── parameter type testers (tinybird/datatypes.py) ──────────────────────────────────────────

const INT_BOUNDS: Record<string, [bigint, bigint]> = {
  Int8: [-(2n ** 7n), 2n ** 7n], Int16: [-(2n ** 15n), 2n ** 15n], Int32: [-(2n ** 31n), 2n ** 31n],
  Int64: [-(2n ** 63n), 2n ** 63n], Int128: [-(2n ** 127n), 2n ** 127n], Int256: [-(2n ** 255n), 2n ** 255n],
  UInt8: [0n, 2n ** 8n], UInt16: [0n, 2n ** 16n], UInt32: [0n, 2n ** 32n], UInt64: [0n, 2n ** 64n],
  UInt128: [0n, 2n ** 128n], UInt256: [0n, 2n ** 256n],
};
const DATETIME64_RES = [/^\d\d\d\d.\d\d.\d\d(T|\s)\d\d:\d\d:\d\d.\d\d\d/, /^\d\d.\d\d.\d\d\d\d.\d{1,2}:\d{1,2}:\d{1,2}.\d{1,3}/];
const DATETIME_RES = [/^\d\d\d\d.\d\d.\d\d(T|\s)\d\d:\d\d:\d\d/, /^\d\d.\d\d.\d\d\d\d.\d{1,2}:\d{1,2}:\d{1,2}/];
const BOOL_VALUES = new Set(['true', 'false', 'True', 'False', 'T', 'F', 'Y', 'N', 'Yes', 'No', 'On', 'Off', 'Enable', 'Disable', 'Enabled', 'Disabled', '1', '0']);

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "if testers[_type](str(t)):"
function passesTester(type: string, x: string): boolean {
  if (type === 'DateTime64') return DATETIME64_RES.some((r) => r.test(x));
  if (type === 'DateTime') return DATETIME_RES.some((r) => r.test(x));
  if (type === 'Date') return /^\d\d\d\d-\d\d-\d\d$/.test(x);
  if (type === 'Bool') return BOOL_VALUES.has(x);
  const bounds = INT_BOUNDS[type];
  if (bounds) {
    const re = type.startsWith('U') && type !== 'UInt128' && type !== 'UInt256' ? /^\d+$/ : /^[+-]?\d+$/;
    if (!re.test(x)) return false;
    const n = BigInt(x);
    return n >= bounds[0] && n < bounds[1];
  }
  return true;
}

// Publish-time stand-ins (`type_fns_check` in the vendor's code).
const CHECK_PLACEHOLDERS: Record<string, TValue> = {
  DateTime64: '2019-01-01 00:00:00.000', DateTime: '2019-01-01 00:00:00', Date: '2019-01-01',
  Float32: new PyFloat(0), Float64: new PyFloat(0), Int: 0, Integer: 0, Symbol: 'symbol', JSON: '{}',
  ...Object.fromEntries(Object.keys(INT_BOUNDS).map((k) => [k, 0])),
};

type Mode = { test: boolean };

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def transform_type("
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "raise SQLTemplateException(REQUIRED_PARAM_NOT_DEFINED, documentation=\"/cli/advanced-templates.html\")"
function transformType(tester: string, transform: (x: TValue) => TValue, mode: Mode, placeholderKey: string, stringPlaceholder?: string): TFunction {
  return {
    call(args, kwargs) {
      let x: TValue = args[0] ?? null;
      const def: TValue = kwargs.default ?? args[1] ?? null;
      const definedFlag = kwargs.defined ?? args[2] ?? true;
      if (x instanceof Placeholder) {
        x = truthy(def) ? def : (stringPlaceholder ?? (mode.test ? CHECK_PLACEHOLDERS[placeholderKey] ?? null : null));
      } else if (x === null) {
        x = def;
        if (x === null) {
          if (truthy(definedFlag)) throw new TemplateError(`Template Syntax Error: ${REQUIRED_PARAM_NOT_DEFINED}`);
          return null;
        }
      }
      if (tester === 'String') {
        if (x !== null) return transform(x);
      } else if (x !== null && passesTester(tester, pyStr(x))) {
        return transform(x);
      }
      throw new TemplateError(`Template Syntax Error: Error validating '${pyStr(x)}' to type ${tester}`);
    },
  };
}

/** Python's `int(x)` — exact at any width (`Integer(int(x))` in the vendor's code). */
function toIntValue(x: TValue): number | bigint {
  if (x instanceof Placeholder) throw new TemplateError("Template Syntax Error: int() argument must be a string, a bytes-like object or a real number, not 'Placeholder'");
  const i = pyInt(x);
  if (i !== undefined) return i;
  const n = num(x);
  if (n !== undefined) return Math.trunc(n);
  const text = pyStr(x).trim();
  if (!/^[+-]?\d+$/.test(text)) throw new TemplateError(`Template Syntax Error: invalid literal for int() with base 10: '${pyStr(x)}'`);
  return normBig(BigInt(text));
}


// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def boolean(x, default=None):"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "return int(bool(x))"
function booleanFn(x: TValue, def: TValue = null): number {
  if (x === null) return def === null ? 0 : booleanFn(def);
  if (x instanceof Placeholder) return booleanFn(def);
  if (typeof x === 'string' && (x === '0' || x.toLowerCase() === 'false')) return 0;
  return truthy(x) ? 1 : 0;
}

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def get_transform_types(placeholders=None):"
function typeFunctions(mode: Mode): Record<string, TFunction> {
  const fns: Record<string, TFunction> = {};
  // Dub's Endpoints test `Boolean(root)` (its v3 pipes)
  const bool: TFunction = { call: (a, k) => booleanFn(a[0] ?? null, k.default ?? a[1] ?? null) };
  fns.bool = bool;
  fns.Boolean = bool;
  for (const t of ['DateTime64', 'DateTime', 'Date']) fns[t] = transformType(t, (x) => pyStr(x), mode, t);
  fns.Int = transformType('Int32', (x) => toIntValue(x), mode, 'Int');
  fns.Integer = transformType('Int32', (x) => toIntValue(x), mode, 'Integer');
  for (const t of Object.keys(INT_BOUNDS)) fns[t] = transformType(t, (x) => new TypedNumber(toIntValue(x), t, false), mode, t);
  fns.String = transformType('String', (x) => pyStr(x), mode, 'String', '__no_value__');
  fns.Symbol = { call: (a) => symbol(a[0] ?? null) };
  fns.Column = fns.Symbol;
  fns.JSON = { call: (a, k) => jsonType(a[0] ?? null, k.default ?? a[1] ?? null) };
  fns.Array = { call: arrayCall };
  return fns;
}

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def symbol(x, quote=\"`\"):"
function symbol(x: TValue): RawSql {
  if (x instanceof Placeholder) return new RawSql('`placeholder`');
  return new RawSql(`\`${sqlEscapeSymbol(pyStr(x))}\``);
}

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def json_type(x, default=None):"
function jsonType(x: TValue, def: TValue): TValue {
  let v = x;
  if (v instanceof Placeholder) v = truthy(def) ? def : '__no_value__';
  if (v === null) v = typeof def === 'string' ? def : '{}';
  if (typeof v === 'string') {
    try {
      return fromJson(JSON.parse(v));
    } catch (e) {
      const shown = v.length > 16 ? `${v.slice(0, 16)}...` : v;
      const offset = v.search(/\S/);
      // Python JSONDecodeError reports the first expected value, including an empty input.
      const at = offset < 0 ? v.length : offset;
      const prefix = v.slice(at);
      const before = v.slice(0, at);
      const detail = !prefix || !/^[{\[\"0-9-]|^(true|false|null)\b/.test(prefix)
        ? `Expecting value: line ${before.split('\n').length} column ${at - before.lastIndexOf('\n')} (char ${at})`
        : (e as Error).message;
      throw new TemplateError(`Template Syntax Error: Error parsing JSON: '${shown}' - ${detail}`);
    }
  }
  return v;
}
function fromJson(v: unknown): TValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? v : new PyFloat(v);
  if (Array.isArray(v)) return v.map(fromJson);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fromJson(x)]));
  return null;
}

const TESTED_TYPES = new Set(['DateTime64', 'DateTime', 'Date', 'Bool', ...Object.keys(INT_BOUNDS)]);
/** `Array(x, T)` converts each element with PLAIN Python transforms (the vendor's `array_type`
 *  table: `int`, `float`, `str`, `boolean`, `symbol`), so `Array(ids, 'Int64')` renders `[1,2]`. */
const ARRAY_ELEMENT_TYPES = new Set(['DateTime64', 'DateTime', 'Date', 'Int', 'Integer', ...Object.keys(INT_BOUNDS), 'String', 'Symbol', 'Column']);
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "values.append(expression_wrapper(types[_type](t), str(t)))"
function arrayElement(et: string, t: TValue): TValue {
  if (t === null) throw new TemplateError(`Template Syntax Error: Error validating 'None' to type ${et}`);
  if (et === 'Symbol' || et === 'Column') return symbol(t);
  if (et === 'Int' || et === 'Integer' || INT_BOUNDS[et]) return toIntValue(t);
  return pyStr(t);
}

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def defined(x=None):"
function baseFunctions(mode: Mode): Record<string, TFunction> {
  return {
    defined: { call: (a) => !((a[0] ?? null) === null || a[0] instanceof Placeholder) },
    column: {
      call: (a) => columnFunction(a),
    },
    symbol: { call: (a) => symbol(a[0] ?? null) },
    split_to_array: {
      call: (a, k) => splitToArray(a, k),
    },
    // At publish the vendor swaps error/custom_error for a stub whose value renders as the literal
    // comment `-- {x} ` (its f-string lacks the `f`), so a guarded error never fails a push.
    error: { call: (a) => { if (mode.test) return new RawSql('-- {x} \n'); throw new TemplateError(pyStr(a[0] ?? '')); } },
    custom_error: {
      call: (a, k) => customError(mode, a, k),
    },
    ...vendorFunctions(mode),
    ...pythonBuiltins(),
  };
}

// ── the rest of the vendor's function table (`function_list` and `generate()`'s namespace) ───


/** `sqlescape` (the symbol form: `"` is dropped). */
const sqlEscape = sqlEscapeSymbol;

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def get_transform_types(placeholders=None):"
function vendorFunctions(mode: Mode): Record<string, TFunction> {
  const table: TFunction = { call: (a) => ((a[0] ?? null) instanceof Placeholder ? new RawSql('placeholder') : new RawSql(sqlEscape(pyStr(a[0] ?? null)))) };
  const diff = (unit: 'days' | 'hours' | 'minutes' | 'seconds', defFormat: string, label: string): TFunction => ({
    call: (a, k) => dateDiff(unit, defFormat, label, a, k),
  });
  return {
    // columns(x, default, fn): a comma list of identifiers → backquoted columns (or `fn(col) as col`).
    columns: {
      call: (a, k) => columnsFunction(a, k),
    },
    table,
    TABLE: table,
    // sql_and(a=1, b__in=Array(…), c__gt=…): `a = … and b in … and c > …`, skipping None values.
    sql_and: {
      call: (_a, k) => sqlAnd(_a, k),
    },
    enumerate_with_last: {
      call: (a) => enumerateWithLast(a),
    },
    date_diff_in_days: diff('days', '%Y-%m-%d', 'invalid date format in function `date_diff_in_days`, it must be ISO format date YYYY-MM-DD, e.g. 2018-09-26'),
    date_diff_in_hours: diff('hours', '%Y-%m-%d %H:%M:%S', 'invalid date_format in function `date_diff_in_hours`, defaults to YYYY-MM-DD hh:mm:ss. Or %Y-%m-%d %H:%M:%S [.ssssss]Z, e.g. ms: 2022-12-19T18:42:22.591Z s:2022-12-19T18:42:22Z'),
    date_diff_in_minutes: diff('minutes', '%Y-%m-%d %H:%M:%S', 'invalid date_format in function `date_diff_in_seconds`, defaults to YYYY-MM-DD hh:mm:ss. Or %Y-%m-%d %H:%M:%S [.ssssss]Z, e.g. ms: 2022-12-19T18:42:22.591Z s:2022-12-19T18:42:22Z'),
    date_diff_in_seconds: diff('seconds', '%Y-%m-%d %H:%M:%S', 'invalid date_format in function `date_diff_in_seconds`, defaults to YYYY-MM-DD hh:mm:ss. Or %Y-%m-%d %H:%M:%S [.ssssss]Z, e.g. ms: 2022-12-19T18:42:22.591Z s:2022-12-19T18:42:22Z'),
    // generate()'s namespace: query hints the vendor renders as SQL comments.
    backend_hint: { call: (a) => new RawSql(`-- backend_hint ${pyStr(a[0] ?? null)}\n`) },
  };
}


/** Python's `datetime.strptime` for the directives the date_diff helpers use (%Y %m %d %H %M %S %f),
 *  case-insensitive literals as `_strptime` compiles them. Returns epoch ms, or undefined. */
function strptimeAny(text: string, formats: string[]): number | undefined {
  for (const f of formats) {
    const t = strptime(text, f);
    if (t !== undefined) return t;
  }
  return undefined;
}
function strptime(text: string, format: string): number | undefined {
  const DIRECTIVES: Record<string, string> = { Y: '(\\d{4})', m: '(1[0-2]|0[1-9]|[1-9])', d: '(3[01]|[12]\\d|0[1-9]|[1-9]| [1-9])', H: '(2[0-3]|[0-1]\\d|\\d)', M: '([0-5]\\d|\\d)', S: '(6[0-1]|[0-5]\\d|\\d)', f: '(\\d{1,6})' };
  const order: string[] = [];
  let re = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i]!;
    if (c === '%' && i + 1 < format.length) {
      const d = format[++i]!;
      if (d === '%') { re += '%'; continue; }
      const pat = DIRECTIVES[d];
      if (!pat) return undefined;
      order.push(d);
      re += pat;
      continue;
    }
    re += /\s/.test(c) ? '\\s+' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const m = new RegExp(`^${re}$`, 'i').exec(text);
  if (!m) return undefined;
  const got: Record<string, number> = { Y: 1900, m: 1, d: 1, H: 0, M: 0, S: 0, f: 0 };
  order.forEach((d, i) => { const v = m[i + 1]!; got[d] = d === 'f' ? Number(v.padEnd(6, '0')) : Number(v.trim()); });
  const dim = new Date(Date.UTC(got.Y!, got.m!, 0)).getUTCDate();
  if (got.d! > dim) return undefined;
  return Date.UTC(got.Y!, got.m! - 1, got.d!, got.H!, got.M!, Math.min(got.S!, 59)) + Math.floor(got.f! / 1000);
}

// ── Python builtins ─────────────────────────────────────────────────────────────────────────
// The vendor's namespace never removes `__builtins__` (it sets the misspelled `__buildins__`), so a
// `{% %}` statement sees every Python builtin; `{{ }}` expressions are narrowed separately by the
// security check below. These are the builtins this twin evaluates; any other is refused by name.

const PY_BUILTINS = new Set([
  'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes', 'callable', 'chr', 'classmethod',
  'compile', 'complex', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset',
  'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list',
  'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'range', 'repr',
  'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip',
]);


// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "reserved_vars = {\"_tt_tmp\", \"_tt_append\", \"isinstance\", \"str\", \"error\", \"custom_error\", *list(vars(builtins))}"
function pythonBuiltins(): Record<string, TFunction> {
  return {
    str: { call: (a) => (a.length === 0 ? '' : pyStr(a[0]!)) },
    int: { call: (a) => (a.length === 0 ? 0 : toIntValue(a[0]!)) },
    bool: { call: (a) => (a.length === 0 ? false : truthy(a[0]!)) },
    dict: { call: (_a, k) => ({ ...k }) },
    abs: { call: (a) => { const v = a[0] ?? null; const i = pyInt(v); if (i !== undefined) return typeof i === 'bigint' ? (i < 0n ? -i : i) : Math.abs(i); const n = num(v); if (n === undefined) throw new TemplateError(`Template Syntax Error: bad operand type for abs(): a value`); return new PyFloat(Math.abs(n)); } },
  };
}

// ── the vendor's `{{ }}` security check (tornado_template.check_valid_expr) ────────────────

/** Functions a `{{ }}` expression may call (`VALID_FUNCTION_NAMES` + `VALID_CUSTOM_FUNCTION_NAMES`). */
const VALID_FUNCTION_NAMES = new Set([
  'Boolean', 'DateTime', 'DateTime64', 'Date', 'Float32', 'Float64', 'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'UInt8',
  'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'String', 'Array', 'symbol', 'cache_ttl', 'error', 'custom_error', 'backend_hint',
  'activate', 'disable', 'sql_unescape', 'max_threads', 'tb_secret', 'tb_var', 'Int', 'table', 'TABLE', 'len', 'list', 'min', 'max',
  'Integer', 'int', 'float', 'JSON',
  'defined', 'column', 'columns', 'day_diff', 'date_diff_in_seconds', 'date_diff_in_minutes', 'date_diff_in_hours', 'date_diff_in_days',
  'split_to_array', 'enumerate_with_last', 'sql_and',
]);
const VALID_METHOD_NAMES = new Set(['split', 'get', 'join', 'replace']);
const BINOP_NAMES: Record<string, string> = { '/': 'Div()', '//': 'FloorDiv()', '%': 'Mod()', '**': 'Pow()' };

/** Refuse what the vendor's `check_valid_expr` refuses inside `{{ }}`: calls to functions or
 *  methods outside its allow-lists, any binary operator but `+ - *`, and comparisons, boolean
 *  operators and bare attribute access (expression types it does not admit). */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/tornado_template.py "def check_valid_expr("
function checkValidExpression(node: PyNode): void {
  const fail = (m: string): never => { throw new TemplateError(`Template Syntax Error: ${m}`); };
  switch (node.t) {
    case 'lit': case 'name': return;
    case 'call':
      if (node.fn.t === 'name') { if (!VALID_FUNCTION_NAMES.has(node.fn.name)) fail(`Invalid function name: ${node.fn.name}`); }
      else if (node.fn.t === 'call') checkValidExpression(node.fn);
      else if (node.fn.t === 'attr') { if (!VALID_METHOD_NAMES.has(node.fn.name)) fail(`Invalid method name: ${node.fn.name}`); checkValidExpression(node.fn.obj); }
      else fail('Invalid function');
      node.args.forEach(checkValidExpression);
      return;
    case 'neg': case 'not': checkValidExpression(node.a); return;
    case 'bin':
      if (node.op === '+' || node.op === '-' || node.op === '*') { checkValidExpression(node.a); checkValidExpression(node.b); return; }
      if (BINOP_NAMES[node.op]) fail(`Invalid BinOp: ${BINOP_NAMES[node.op]}`);
      return fail('Invalid expression type: Compare');
    case 'and': case 'or': return fail('Invalid expression type: BoolOp');
    case 'attr': return fail(`Invalid expression type: Attribute(attr='${node.name}')`);
    case 'index': checkValidExpression(node.obj); checkValidExpression(node.index); return;
    case 'list': node.items.forEach(checkValidExpression); return;
    case 'dict': node.entries.forEach(([k, v]) => { checkValidExpression(k); checkValidExpression(v); }); return;
    case 'cond': checkValidExpression(node.test); checkValidExpression(node.a); checkValidExpression(node.b); return;
  }
}

function toJs(v: TValue): unknown {
  if (v instanceof PyFloat || v instanceof TypedNumber) return v.value;
  if (Array.isArray(v)) return v.map(toJs);
  if (isDict(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJs(x)]));
  if (v instanceof RawSql) return v.sql;
  if (v instanceof Placeholder) return '__no_value__';
  return v;
}


// ── Python expression parsing ───────────────────────────────────────────────────────────────

type PyTok = { k: 'name' | 'num' | 'str' | 'op' | 'end'; v: string; n?: number; float?: boolean };

function pyTokenize(src: string): PyTok[] {
  const out: PyTok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      out.push({ k: 'name', v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      const text = m[0];
      const float = /[.eE]/.test(text);
      out.push({ k: 'num', v: text, n: Number(text), float });
      i += text.length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const triple = src.startsWith(ch.repeat(3), i);
      const quote = triple ? ch.repeat(3) : ch;
      let j = i + quote.length;
      let s = '';
      while (j < src.length && !src.startsWith(quote, j)) {
        const c = src[j]!;
        if (c === '\\' && j + 1 < src.length) {
          const e = src[j + 1]!;
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"' };
          s += map[e] ?? `\\${e}`;
          j += 2;
          continue;
        }
        s += c;
        j++;
      }
      if (j >= src.length) throw new TemplateError('Template Syntax Error: unterminated string literal');
      out.push({ k: 'str', v: s });
      i = j + quote.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '**', '//'].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('()[]{},.:<>+-*/%='.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue; }
    throw new TemplateError(`Template Syntax Error: invalid syntax near '${src.slice(i, i + 10)}'`);
  }
  out.push({ k: 'end', v: '' });
  return out;
}

type PyNode =
  | { t: 'lit'; v: TValue }
  | { t: 'name'; name: string }
  | { t: 'list'; items: PyNode[] }
  | { t: 'dict'; entries: Array<[PyNode, PyNode]> }
  | { t: 'call'; fn: PyNode; args: PyNode[]; kwargs: Array<[string, PyNode]> }
  | { t: 'attr'; obj: PyNode; name: string }
  | { t: 'index'; obj: PyNode; index: PyNode }
  | { t: 'bin'; op: string; a: PyNode; b: PyNode }
  | { t: 'not'; a: PyNode }
  | { t: 'neg'; a: PyNode }
  | { t: 'and' | 'or'; a: PyNode; b: PyNode }
  | { t: 'cond'; test: PyNode; a: PyNode; b: PyNode };

class PyParser {
  private i = 0;
  constructor(private readonly toks: PyTok[], private readonly source: string) {}
  static parse(src: string): PyNode {
    const p = new PyParser(pyTokenize(src), src);
    const node = p.expr();
    if (p.peek().k !== 'end') throw new TemplateError('invalid syntax');
    return node;
  }
  private peek(o = 0): PyTok { return this.toks[this.i + o]!; }
  private next(): PyTok { return this.toks[this.i++]!; }
  private isOp(v: string): boolean { const t = this.peek(); return t.k === 'op' && t.v === v; }
  private isName(v: string): boolean { const t = this.peek(); return t.k === 'name' && t.v === v; }
  private expect(v: string): void {
    if (!this.isOp(v)) throw new TemplateError('invalid syntax');
    this.i++;
  }
  expr(): PyNode {
    if (this.isName('lambda')) throw new TemplateError('Template Syntax Error: lambda is not supported in templates');
    const a = this.or();
    if (this.isName('if')) {
      this.i++;
      const test = this.or();
      if (!this.isName('else')) throw new TemplateError('invalid syntax');
      this.i++;
      const b = this.expr();
      return { t: 'cond', test, a, b };
    }
    return a;
  }
  private or(): PyNode {
    let a = this.and();
    while (this.isName('or')) { this.i++; a = { t: 'or', a, b: this.and() }; }
    return a;
  }
  private and(): PyNode {
    let a = this.not();
    while (this.isName('and')) { this.i++; a = { t: 'and', a, b: this.not() }; }
    return a;
  }
  private not(): PyNode {
    if (this.isName('not')) { this.i++; return { t: 'not', a: this.not() }; }
    return this.comparison();
  }
  private comparison(): PyNode {
    // Python chains comparisons: `1 < x < 5` is `1 < x and x < 5`, never `(1 < x) < 5`.
    let left = this.additive();
    let chain: PyNode | undefined;
    for (;;) {
      const t = this.peek();
      let op: string | undefined;
      if (t.k === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) { op = t.v; this.i++; }
      else if (t.k === 'name' && t.v === 'in') { op = 'in'; this.i++; }
      else if (t.k === 'name' && t.v === 'not' && this.peek(1).k === 'name' && this.peek(1).v === 'in') { op = 'not in'; this.i += 2; }
      else if (t.k === 'name' && t.v === 'is') {
        this.i++;
        if (this.isName('not')) { this.i++; op = 'is not'; } else op = 'is';
      }
      if (!op) return chain ?? left;
      const right = this.additive();
      const cmp: PyNode = { t: 'bin', op, a: left, b: right };
      chain = chain ? { t: 'and', a: chain, b: cmp } : cmp;
      left = right;
    }
  }
  private additive(): PyNode {
    let a = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().v;
      a = { t: 'bin', op, a, b: this.term() };
    }
    return a;
  }
  private term(): PyNode {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%') || this.isOp('//')) {
      const op = this.next().v;
      a = { t: 'bin', op, a, b: this.unary() };
    }
    return a;
  }
  private unary(): PyNode {
    if (this.isOp('-')) { this.i++; return { t: 'neg', a: this.unary() }; }
    if (this.isOp('+')) { this.i++; return this.unary(); }
    return this.power();
  }
  private power(): PyNode {
    const a = this.postfix();
    if (!this.isOp('**')) return a;
    this.next();
    return { t: 'bin', op: '**', a, b: this.unary() };
  }
  private postfix(): PyNode {
    let node = this.atom();
    for (;;) {
      if (this.isOp('(')) {
        this.i++;
        const args: PyNode[] = [];
        const kwargs: Array<[string, PyNode]> = [];
        while (!this.isOp(')')) {
          if (this.peek().k === 'name' && this.peek(1).k === 'op' && this.peek(1).v === '=') {
            const name = this.next().v;
            this.i++;
            kwargs.push([name, this.expr()]);
          } else {
            args.push(this.expr());
          }
          if (this.isOp(',')) { this.i++; continue; }
          if (!this.isOp(')')) throw new TemplateError('invalid syntax');
        }
        this.i++;
        node = { t: 'call', fn: node, args, kwargs };
        continue;
      }
      if (this.isOp('.')) {
        this.i++;
        const t = this.next();
        if (t.k !== 'name') throw new TemplateError('invalid syntax');
        node = { t: 'attr', obj: node, name: t.v };
        continue;
      }
      if (this.isOp('[')) {
        this.i++;
        const index = this.expr();
        if (this.isOp(':')) throw new TemplateError('Template Syntax Error: slices are not supported in templates');
        this.expect(']');
        node = { t: 'index', obj: node, index };
        continue;
      }
      return node;
    }
  }
  private atom(): PyNode {
    const t = this.next();
    if (t.k === 'num') return { t: 'lit', v: t.float ? new PyFloat(t.n!) : t.n! };
    if (t.k === 'str') {
      let s = t.v;
      // Adjacent string literals concatenate.
      while (this.peek().k === 'str') s += this.next().v;
      return { t: 'lit', v: s };
    }
    if (t.k === 'name') {
      if (t.v === 'True') return { t: 'lit', v: true };
      if (t.v === 'False') return { t: 'lit', v: false };
      if (t.v === 'None') return { t: 'lit', v: null };
      if (['import', 'from', 'lambda', 'yield', 'await', 'def', 'class'].includes(t.v)) {
        throw new TemplateError(`Template Syntax Error: ${t.v} is forbidden`);
      }
      return { t: 'name', name: t.v };
    }
    if (t.k === 'op' && t.v === '(') {
      const e = this.expr();
      if (this.isOp(',')) throw new TemplateError('Template Syntax Error: tuples are not supported in templates');
      this.expect(')');
      return e;
    }
    if (t.k === 'op' && t.v === '[') {
      const items: PyNode[] = [];
      while (!this.isOp(']')) {
        items.push(this.expr());
        if (this.isOp(',')) { this.i++; continue; }
        if (!this.isOp(']')) throw new TemplateError('invalid syntax');
      }
      this.i++;
      return { t: 'list', items };
    }
    if (t.k === 'op' && t.v === '{') {
      const entries: Array<[PyNode, PyNode]> = [];
      while (!this.isOp('}')) {
        const k = this.expr();
        this.expect(':');
        entries.push([k, this.expr()]);
        if (this.isOp(',')) { this.i++; continue; }
        if (!this.isOp('}')) throw new TemplateError('invalid syntax');
      }
      this.i++;
      return { t: 'dict', entries };
    }
    throw new TemplateError('invalid syntax');
  }
}

/** Every bare name an expression reads (for the template's variable inventory). */
function pyNames(node: PyNode, out: Set<string>): void {
  switch (node.t) {
    case 'name': out.add(node.name); return;
    case 'lit': return;
    case 'list': node.items.forEach((x) => pyNames(x, out)); return;
    case 'dict': node.entries.forEach(([k, v]) => { pyNames(k, out); pyNames(v, out); }); return;
    case 'call': pyNames(node.fn, out); node.args.forEach((x) => pyNames(x, out)); node.kwargs.forEach(([, v]) => pyNames(v, out)); return;
    case 'attr': pyNames(node.obj, out); return;
    case 'index': pyNames(node.obj, out); pyNames(node.index, out); return;
    case 'bin': case 'and': case 'or': pyNames(node.a, out); pyNames(node.b, out); return;
    case 'not': case 'neg': pyNames(node.a, out); return;
    case 'cond': pyNames(node.test, out); pyNames(node.a, out); pyNames(node.b, out); return;
  }
}

// ── the template functions' bodies ─────────────────────────────────────────────────────────

/** `Array(x, 'Type', default)`: the vendor's `array_type`. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def array_type(types):"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "list_values = x if type(x) == list else x.split(\",\")"
function arrayCall(args: TValue[], kwargs: Record<string, TValue>): TValue {
  let x: TValue = args[0] ?? null;
  const elementType = (kwargs._type ?? args[1] ?? null) as TValue;
  const def: TValue = kwargs.default ?? args[2] ?? null;
  const definedFlag = kwargs.defined ?? args[3] ?? true;
  const et = typeof elementType === 'string' ? elementType : undefined;
  if (x instanceof Placeholder) {
    if (truthy(def)) x = def;
    else if (et && ARRAY_ELEMENT_TYPES.has(et)) x = et === 'String' ? '' : [0, 0].map(() => pyStr(arrayElement(et, CHECK_PLACEHOLDERS[et] ?? null))).join(',');
    else x = '';
  } else if (x === null) {
    x = def;
    if (x === null) {
      if (truthy(definedFlag)) throw new TemplateError(`Template Syntax Error: ${REQUIRED_PARAM_NOT_DEFINED}`);
      return null;
    }
  }
  const list: TValue[] = Array.isArray(x) ? x : pyStr(x).split(',');
  const values: string[] = [];
  list.forEach((t, i) => {
    const s = pyStr(t);
    if (et && TESTED_TYPES.has(et)) {
      if (!passesTester(et, s)) {
        throw new TemplateError(`Template Syntax Error: Error validating [${pyStr(x)}][${i}] (${s === '' ? 'empty string' : s}) to type ${et}`);
      }
    }
    const transformed = et && ARRAY_ELEMENT_TYPES.has(et) ? arrayElement(et, t) : t;
    values.push(renderExpression(transformed, s));
  });
  return new RawSql(`[${values.join(',')}]`);
}

/** `column(x, default)`: a backquoted column name. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def column(x, default=None):"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "escaped_slices = [quote + sqlescape(s) + quote for s in slices]"
function columnFunction(a: TValue[]): TValue {
  let x = a[0] ?? null;
  if (x === null || x instanceof Placeholder) {
    if ((a[1] ?? null) === null) throw new TemplateError("Template Syntax Error: Missing column() default value, use `column(column_name, 'default_column_name')`");
    x = a[1]!;
  }
  return new RawSql(pyStr(x).split('.').map((s) => `\`${sqlEscapeSymbol(s)}\``).join('.'));
}

/** `split_to_array(x, default, separator)`. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def split_to_array(x, default=\"\", separator: str = \",\"):"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "return [s.strip() for s in x.split(separator)]"
function splitToArray(a: TValue[], k: Record<string, TValue>): TValue {
  let x = a[0] ?? null;
  const sep = pyStr(k.separator ?? a[2] ?? ',');
  if (x === null || x instanceof Placeholder) x = k.default ?? a[1] ?? '';
  return pyStr(x).split(sep).map((s) => s.trim());
}

/** `custom_error(body, code)`: the request fails with that body and status. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def custom_error(s, code=400):"
function customError(mode: Mode, a: TValue[], k: Record<string, TValue>): TValue {
  if (mode.test) return new RawSql('-- {x} \n');
  const status = num(k.code ?? a[1] ?? 400) ?? 400;
  const body = a[0] ?? '';
  throw new TemplateError(isDict(body) ? JSON.stringify(toJs(body)) : pyStr(body), status, toJs(body));
}


/** `date_diff_in_days|hours|minutes|seconds(d0, d1, date_format, default, backup_date_format, none_if_error)`. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def __date_diff("
function dateDiff(unit: 'days' | 'hours' | 'minutes' | 'seconds', defFormat: string, label: string, a: TValue[], k: Record<string, TValue>): TValue {
  const d0 = a[0] ?? null;
  const d1 = a[1] ?? null;
  const fmt = pyStr(k.date_format ?? a[2] ?? defFormat);
  const def = k.default ?? a[3] ?? null;
  const backup = k.backup_date_format ?? a[4] ?? null;
  const noneIfError = truthy(k.none_if_error ?? a[5] ?? false);
  if (d0 instanceof Placeholder || d1 instanceof Placeholder) return truthy(def) ? def : 0;
  const formats = [fmt, ...(backup !== null ? [pyStr(backup)] : [])];
  const t0 = strptimeAny(pyStr(d0), formats);
  const t1 = strptimeAny(pyStr(d1), formats);
  if (t0 === undefined || t1 === undefined) {
    if (noneIfError) return null;
    throw new TemplateError(`Template Syntax Error: ${label}`);
  }
  const seconds = Math.abs(t1 - t0) / 1000;
  const per = unit === 'days' ? 86400 : unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1;
  return Math.trunc(seconds / per);
}

/** A dotted name as backquoted parts. */
function columnSql(x: TValue): string {
  return pyStr(x).split('.').map((c) => `\`${sqlEscape(c)}\``).join('.');
}

/** `columns(x, default, fn)`: a comma list of identifiers as backquoted columns (or `fn(col) as col`). */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def columns(x, default=None, fn=None):"
function columnsFunction(a: TValue[], k: Record<string, TValue>): TValue {
  let x = a[0] ?? null;
  const def = k.default ?? a[1] ?? null;
  const fn = k.fn ?? a[2] ?? null;
  if (x === null || x instanceof Placeholder) {
    if (def === null) throw new TemplateError("Template Syntax Error: Missing columns() default value, use `columns(column_names, 'default_column_name')`");
    x = def;
  }
  if (typeof x !== 'string') throw new TemplateError("Template Syntax Error: The 'columns' function expects a String not an Array");
  const cols = x.split(',').map((c) => c.trim());
  return new RawSql(cols.map((c) => (fn !== null && truthy(fn) ? `${pyStr(fn)}(${columnSql(c)}) as ${c}` : columnSql(c))).join(','));
}

/** `sql_and(a=1, b__in=Array(…), c__gt=…)`: `a = … and b in … and c > …`, skipping None values. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def _and(*args, **kwargs):"
function sqlAnd(_a: TValue[], k: Record<string, TValue>): TValue {
  const OPS: Record<string, string> = { in: 'in', not_in: 'not in', gt: '>', lt: '<', gte: '>=', lte: '<=' };
  const parts: string[] = [];
  for (const [key, v] of Object.entries(k)) {
    if (v === null) continue;
    const cut = key.lastIndexOf('__');
    const name = cut < 0 ? key : key.slice(0, cut);
    let op = '=';
    if (cut >= 0) {
      const suffix = key.slice(cut + 2);
      if (!OPS[suffix]) throw new TemplateError(`Template Syntax Error: operand ${suffix} not supported`);
      op = OPS[suffix]!;
    }
    parts.push(`${name} ${op} ${renderExpression(v, key)}`);
  }
  return new RawSql(parts.join(' and '));
}

/** `enumerate_with_last(x)`. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def enumerate_with_last(arr):"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "return [(arr_len == i + 1, x) for i, x in enumerate(arr)]"
function enumerateWithLast(a: TValue[]): TValue {
  const arr = a[0] ?? null;
  if (arr instanceof Placeholder || !(Array.isArray(arr) || typeof arr === 'string' || isDict(arr))) {
    throw new TemplateError(`Template Syntax Error: object of type a value has no len()`);
  }
  const items: TValue[] = Array.isArray(arr) ? arr : typeof arr === 'string' ? [...arr] : Object.keys(arr);
  return items.map((x, i) => [i + 1 === items.length, x]);
}















// ── Python expression evaluation ────────────────────────────────────────────────────────────

type Scope = Map<string, TValue>;

function methodOf(obj: TValue, name: string): TFunction {
  if (obj instanceof Placeholder) {
    // The vendor's Placeholder answers `split` and `startswith`; anything else is its error.
    if (name === 'split') return { call: () => [new Placeholder(), new Placeholder()] };
    if (name === 'startswith') return { call: () => false };
    throw new TemplateError(`Template Syntax Error: 'Placeholder' object has no attribute '${name}'`);
  }
  if (typeof obj === 'string') {
    const s = obj;
    const m: Record<string, TFunction> = {
      startswith: { call: (a) => s.startsWith(pyStr(a[0] ?? '')) },
      endswith: { call: (a) => s.endsWith(pyStr(a[0] ?? '')) },
      lower: { call: () => s.toLowerCase() },
      upper: { call: () => s.toUpperCase() },
      replace: { call: (a) => s.split(pyStr(a[0] ?? '')).join(pyStr(a[1] ?? '')) },
      join: { call: (a) => (Array.isArray(a[0]) ? (a[0] as TValue[]).map(pyStr).join(s) : pyStr(a[0] ?? '')) },
    };
    if (m[name]) return m[name]!;
  }
  if (isDict(obj)) {
    const dict = obj as { [k: string]: TValue };
    if (name === 'get') return { call: (a) => (Object.prototype.hasOwnProperty.call(dict, pyStr(a[0] ?? '')) ? dict[pyStr(a[0] ?? '')]! : (a[1] ?? null)) };
    if (name === 'keys') return { call: () => Object.keys(obj) };
    if (name === 'values') return { call: () => Object.values(obj) };
  }
  if (typeof obj === 'string' && name === 'get') {
    throw new TemplateError("Template Syntax Error: 'str' object has no attribute 'get'. Make sure you're using an object/dictionary where trying to use .get()");
  }
  throw new TemplateError(`Template Syntax Error: a value object has no attribute '${name}'`);
}

function evalPy(node: PyNode, scope: Scope): TValue {
  switch (node.t) {
    case 'lit': return node.v;
    case 'name': {
      if (scope.has(node.name)) return scope.get(node.name)!;
      if (PY_BUILTINS.has(node.name)) throw new TemplateError(`Template Syntax Error: the Python builtin '${node.name}' is not modeled by this twin (modeled: ${Object.keys(pythonBuiltins()).join(', ')})`);
      throw new TemplateError(`Template Syntax Error: name '${node.name}' is not defined`);
    }
    case 'list': return node.items.map((x) => evalPy(x, scope));
    case 'dict': return Object.fromEntries(node.entries.map(([k, v]) => [pyStr(evalPy(k, scope)), evalPy(v, scope)]));
    case 'call': {
      let fn: TFunction;
      if (node.fn.t === 'attr') {
        fn = methodOf(evalPy(node.fn.obj, scope), node.fn.name);
      } else {
        const f = evalPy(node.fn, scope);
        if (f instanceof Placeholder || !isFn(f)) {
          const name = node.fn.t === 'name' ? node.fn.name : 'expression';
          throw new TemplateError(`Template Syntax Error: '${name}' is not a valid function${f instanceof Placeholder ? `, line ${f.line}` : ''}`);
        }
        fn = f;
      }
      const args = node.args.map((a) => evalPy(a, scope));
      const kwargs = Object.fromEntries(node.kwargs.map(([k, v]) => [k, evalPy(v, scope)]));
      try {
        return fn.call(args, kwargs);
      } catch (e) {
        // The vendor names the missing parameter (`format_SQLTemplateException_message`).
        if (e instanceof TemplateError && e.message.endsWith(REQUIRED_PARAM_NOT_DEFINED) && node.args[0]?.t === 'name') {
          throw new TemplateError(`${e.message}. Check the parameters ${node.args[0].name}. Please provide a value or set a default value in the pipe code.`, e.status);
        }
        throw e;
      }
    }
    case 'attr': {
      const obj = evalPy(node.obj, scope);
      throw new TemplateError(`Template Syntax Error: attribute access '${node.name}' on a value is not supported outside a call`);
    }
    case 'index': {
      const obj = evalPy(node.obj, scope);
      const idx = evalPy(node.index, scope);
      if (obj instanceof Placeholder) return new Placeholder();
      if (Array.isArray(obj) || typeof obj === 'string') {
        let i = num(idx);
        if (i === undefined) throw new TemplateError('Template Syntax Error: indices must be integers');
        if (i < 0) i += obj.length;
        if (i < 0 || i >= obj.length) {
          throw new TemplateError(typeof obj === 'string'
            ? 'Template Syntax Error: String index out of range. Check that string parameters have values before accessing specific characters (e.g., param[0]). Provide default values or add length checks in your template.'
            : 'Template Syntax Error: list index out of range');
        }
        return obj[i]!;
      }
      if (isDict(obj)) {
        const k = pyStr(idx);
        const dict = obj as { [k: string]: TValue };
        if (!Object.prototype.hasOwnProperty.call(dict, k)) throw new TemplateError(`Template Syntax Error: KeyError '${k}'`);
        return dict[k]!;
      }
      throw new TemplateError(`Template Syntax Error: a value object is not subscriptable`);
    }
    case 'not': return !truthy(evalPy(node.a, scope));
    case 'neg': {
      const v = num(evalPy(node.a, scope));
      if (v === undefined) throw new TemplateError('Template Syntax Error: bad operand type for unary -');
      return -v;
    }
    case 'and': { const a = evalPy(node.a, scope); return truthy(a) ? evalPy(node.b, scope) : a; }
    case 'or': { const a = evalPy(node.a, scope); return truthy(a) ? a : evalPy(node.b, scope); }
    case 'cond': return truthy(evalPy(node.test, scope)) ? evalPy(node.a, scope) : evalPy(node.b, scope);
    case 'bin': return binaryPy(node.op, evalPy(node.a, scope), evalPy(node.b, scope));
  }
}

function binaryPy(op: string, a: TValue, b: TValue): TValue {
  switch (op) {
    case '==': return pyEquals(a, b);
    case '!=': return !pyEquals(a, b);
    case 'is': return a === b || (a === null && b === null);
    case 'is not': return !(a === b || (a === null && b === null));
    case 'in': case 'not in': {
      let r: boolean;
      if (Array.isArray(b)) r = b.some((x) => pyEquals(x, a));
      else if (typeof b === 'string') r = b.includes(pyStr(a));
      else if (isDict(b)) r = Object.prototype.hasOwnProperty.call(b, pyStr(a));
      else if (b instanceof Placeholder) r = false;
      else throw new TemplateError(`Template Syntax Error: argument of type a value is not iterable`);
      return op === 'in' ? r : !r;
    }
    case '<': case '<=': case '>': case '>=': {
      const na = num(a);
      const nb = num(b);
      let c: number;
      if (na !== undefined && nb !== undefined) c = na - nb;
      else if (typeof a === 'string' && typeof b === 'string') c = a < b ? -1 : a > b ? 1 : 0;
      else throw new TemplateError(`Template Syntax Error: '${op}' not supported between instances of a value and a value. If you are using a dynamic parameter, you need to wrap it around a valid Data Type (e.g. Int8(placeholder))`);
      return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
    }
    case '+': {
      if (a instanceof Placeholder || b instanceof Placeholder) return new Placeholder();
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      const na = num(a); const nb = num(b);
      if (na !== undefined && nb !== undefined) return floaty(a, b) ? new PyFloat(na + nb) : na + nb;
      throw new TemplateError(`Template Syntax Error: unsupported operand type(s) for +: a value and a value`);
    }
    case '-': case '*': case '/': case '//': case '%': {
      if (op === '%' && typeof a === 'string') throw new TemplateError('Template Syntax Error: string formatting is not supported in templates');
      const na = num(a); const nb = num(b);
      if (na === undefined || nb === undefined) throw new TemplateError(`Template Syntax Error: unsupported operand type(s) for ${op}: a value and a value`);
      if ((op === '/' || op === '//' || op === '%') && nb === 0) throw new TemplateError('Template Syntax Error: division by zero');
      if (op === '-') return floaty(a, b) ? new PyFloat(na - nb) : na - nb;
      if (op === '*') return floaty(a, b) ? new PyFloat(na * nb) : na * nb;
      if (op === '/') return new PyFloat(na / nb);
      if (op === '//') return Math.floor(na / nb);
      return ((na % nb) + nb) % nb;
    }
  }
  throw new TemplateError(`Template Syntax Error: unsupported operator ${op}`);
}
function floaty(a: TValue, b: TValue): boolean {
  return a instanceof PyFloat || b instanceof PyFloat || (a instanceof TypedNumber && a.float) || (b instanceof TypedNumber && b.float);
}

// ── template structure (Tornado) ────────────────────────────────────────────────────────────

type TNode =
  | { t: 'text'; s: string }
  | { t: 'expr'; src: string; e: PyNode; line: number }
  | { t: 'if'; branches: Array<{ cond: PyNode | undefined; body: TNode[]; line: number }> }
  | { t: 'for'; vars: string[]; iter: PyNode; body: TNode[]; line: number }
  | { t: 'set'; name: string; e: PyNode; line: number };

type Token = { kind: 'text' | 'expr' | 'stmt'; s: string; line?: number };

function lexTemplate(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let text = '';
  while (i < src.length) {
    if (src[i] === '{' && i + 1 < src.length && (src[i + 1] === '{' || src[i + 1] === '%' || src[i + 1] === '#')) {
      const kind = src[i + 1]!;
      // `{{!`, `{%!` and `{#!` are the documented escapes for a literal opener.
      if (src[i + 2] === '!') { text += `{${kind}`; i += 3; continue; }
      const close = kind === '{' ? '}}' : kind === '%' ? '%}' : '#}';
      const end = src.indexOf(close, i + 2);
      if (end < 0) throw new TemplateError(`Template Syntax Error: Missing end expression ${close}`);
      const inner = src.slice(i + 2, end);
      if (text) { out.push({ kind: 'text', s: text }); text = ''; }
      if (kind === '{') out.push({ kind: 'expr', s: inner, line: src.slice(0, i).split('\n').length });
      else if (kind === '%') out.push({ kind: 'stmt', s: inner.trim(), line: src.slice(0, i).split('\n').length });
      i = end + 2;
      continue;
    }
    text += src[i];
    i++;
  }
  if (text) out.push({ kind: 'text', s: text });
  return out;
}

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/tornado_template.py "import is forbidden"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/tornado_template.py "raise UnClosedIfError(node=reader.name, lineno=reader.line, sql=reader.text)"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/tornado_template.py "Missing {%% end %%} block for if in the node %s at line %d of the SQL: %s"
function parseTemplate(src: string, name = '<string>'): TNode[] {
  const toks = lexTemplate(src);
  let i = 0;
  function block(terminators: string[]): { body: TNode[]; ended: string; line?: number } {
    const body: TNode[] = [];
    while (i < toks.length) {
      const tok = toks[i++]!;
      if (tok.kind === 'text') { body.push({ t: 'text', s: tok.s }); continue; }
      if (tok.kind === 'expr') {
        if (!tok.s.trim()) throw new TemplateError('Template Syntax Error: Empty expression');
        const e = PyParser.parse(tok.s);
        checkValidExpression(e);
        body.push({ t: 'expr', src: tok.s.trim(), e, line: tok.line ?? 1 });
        continue;
      }
      const stmt = tok.s;
      const word = /^\w+/.exec(stmt)?.[0] ?? '';
      if (terminators.includes(word)) return { body, ended: stmt, line: tok.line };
      if (word === 'if') {
        const branches: Array<{ cond: PyNode | undefined; body: TNode[]; line: number }> = [];
        let cond: PyNode | undefined = PyParser.parse(stmt.slice(2));
        let condLine = tok.line ?? 1;
        for (;;) {
          const r = block(['elif', 'else', 'end']);
          branches.push({ cond, body: r.body, line: condLine });
          const w = /^\w+/.exec(r.ended)?.[0];
          if (w === 'end') break;
          if (w === 'elif') { cond = PyParser.parse(r.ended.slice(4)); condLine = r.line ?? condLine; continue; }
          if (w === 'else') {
            const last = block(['end']);
            if (!/^end\b/.test(last.ended)) throw new TemplateError('Template Syntax Error: Missing {% end %} block for if');
            branches.push({ cond: undefined, body: last.body, line: tok.line ?? 1 });
            break;
          }
          throw new TemplateError('Template Syntax Error: Missing {% end %} block for if');
        }
        body.push({ t: 'if', branches });
        continue;
      }
      if (word === 'for') {
        const m = /^for\s+([\w\s,]+?)\s+in\s+([\s\S]+)$/.exec(stmt);
        if (!m) throw new TemplateError(`Template Syntax Error: invalid for statement '${stmt}'`);
        const vars = m[1]!.split(',').map((v) => v.trim()).filter(Boolean);
        const iter = PyParser.parse(m[2]!);
        const r = block(['end']);
        if (!/^end\b/.test(r.ended)) throw new TemplateError('Template Syntax Error: Missing {% end %} block for for');
        body.push({ t: 'for', vars, iter, body: r.body, line: tok.line ?? 1 });
        continue;
      }
      if (word === 'set') {
        const m = /^set\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(stmt);
        if (!m) throw new TemplateError(`Template Syntax Error: invalid set statement '${stmt}'`);
        body.push({ t: 'set', name: m[1]!, e: PyParser.parse(m[2]!), line: tok.line ?? 1 });
        continue;
      }
      if (word === 'import' || word === 'from') throw new TemplateError(`import is forbidden at ${name}:${tok.line ?? 1}`);
      throw new TemplateError(`Template Syntax Error: unsupported template statement '{% ${stmt} %}'`);
    }
    if (terminators.length > 0) {
      const line = src.split('\n').length;
      throw new TemplateError(name === '<string>'
        ? `Missing {% end %} block for if at line ${line}`
        : `Missing {% end %} block for if in the node ${name} at line ${line} of the SQL: ${src}`);
    }
    return { body, ended: '' };
  }
  const r = block([]);
  return r.body;
}

// ── inventory: variable names and declared types ────────────────────────────────────────────

export type TemplateVariable = { name: string; type: string; default?: string; required: boolean; description?: string; line: number };

const TYPE_FUNCTION_NAMES = new Set([
  'String', 'Boolean', 'bool', 'DateTime64', 'DateTime', 'Date', 'Float32', 'Float64', 'Int', 'Integer',
  ...Object.keys(INT_BOUNDS), 'Array', 'JSON', 'Symbol', 'Column',
]);
// Not template variables: the vendor's function table, its namespace and Python's builtins
// (`reserved_vars`), except `id`, which the vendor deliberately keeps usable as a parameter.
const BUILTIN_NAMES = new Set([
  ...TYPE_FUNCTION_NAMES, 'defined', 'column', 'symbol', 'split_to_array', 'error', 'custom_error', 'len',
  'columns', 'table', 'TABLE', 'sql_and', 'enumerate_with_last', 'day_diff', 'date_diff_in_days', 'date_diff_in_hours',
  'date_diff_in_minutes', 'date_diff_in_seconds', 'sql_unescape', 'max_threads', 'backend_hint', 'cache_ttl', 'activate', 'disable',
  'tb_secret', 'tb_var', ...[...PY_BUILTINS].filter((n) => n !== 'id' && n !== 'format'),
]);

// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "line_number = x.line"
function visitTemplate(nodes: TNode[], fn: (e: PyNode, line: number) => void): void {
  for (const n of nodes) {
    if (n.t === 'expr' || n.t === 'set') fn(n.e, n.line);
    else if (n.t === 'if') n.branches.forEach((b) => { if (b.cond) fn(b.cond, b.line); visitTemplate(b.body, fn); });
    else if (n.t === 'for') { fn(n.iter, n.line); visitTemplate(n.body, fn); }
  }
}
function localNames(nodes: TNode[], out: Set<string>): void {
  for (const n of nodes) {
    if (n.t === 'set') out.add(n.name);
    else if (n.t === 'for') { n.vars.forEach((v) => out.add(v)); localNames(n.body, out); }
    else if (n.t === 'if') n.branches.forEach((b) => localNames(b.body, out));
  }
}

function templateOf(sql: string, name = '<string>'): TNode[] {
  return parseTemplate(stripMarker(sql), name);
}

/** Is this node SQL a template (`%` on its first line)? */
export function isTemplate(sql: string): boolean {
  return /^\s*%/.test(sql);
}
function stripMarker(sql: string): string {
  return sql.replace(/^\s*%/, '');
}

/** The request parameters a template reads, with the type its typed-function use declares. */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def get_var_names_and_types(t: Template, node_id: Optional[str] = None) -> List[Dict[str, Any]]:"
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def get_var_names_and_types("
export function templateVariables(sql: string, name = '<string>'): TemplateVariable[] {
  if (!isTemplate(sql)) return [];
  const nodes = templateOf(sql, name);
  const locals = new Set<string>();
  localNames(nodes, locals);
  const found = new Map<string, TemplateVariable>();
  const all = new Map<string, number>();
  visitTemplate(nodes, (e, line) => {
    const names = new Set<string>();
    pyNames(e, names);
    for (const name of names) if (!all.has(name)) all.set(name, line);
    const walk = (n: PyNode): void => {
      if (n.t === 'call' && n.fn.t === 'name' && TYPE_FUNCTION_NAMES.has(n.fn.name) && n.args[0]?.t === 'name') {
        const name = n.args[0].name;
        if (!locals.has(name) && !found.has(name)) {
          let type = n.fn.name === 'bool' ? 'Boolean' : n.fn.name === 'Int' || n.fn.name === 'Integer' ? 'Int32' : n.fn.name;
          if (type === 'Array') {
            const et = n.args[1]?.t === 'lit' && typeof n.args[1].v === 'string' ? n.args[1].v : 'String';
            type = `Array(${et})`;
          }
          const defNode = n.kwargs.find(([k]) => k === 'default')?.[1] ?? (n.fn.name === 'Array' ? n.args[2] : n.args[1]);
          const def = defNode?.t === 'lit' && defNode.v !== null ? pyStr(defNode.v) : undefined;
          const req = n.kwargs.find(([k]) => k === 'required')?.[1];
          const desc = n.kwargs.find(([k]) => k === 'description')?.[1];
          found.set(name, {
            name, type, line,
            ...(def !== undefined ? { default: def } : {}),
            required: req?.t === 'lit' ? truthy(req.v) : false,
            ...(desc?.t === 'lit' && typeof desc.v === 'string' ? { description: desc.v } : {}),
          });
        }
      }
      switch (n.t) {
        case 'call': walk(n.fn); n.args.forEach(walk); n.kwargs.forEach(([, v]) => walk(v)); break;
        case 'list': n.items.forEach(walk); break;
        case 'dict': n.entries.forEach(([k, v]) => { walk(k); walk(v); }); break;
        case 'attr': walk(n.obj); break;
        case 'index': walk(n.obj); walk(n.index); break;
        case 'bin': case 'and': case 'or': walk(n.a); walk(n.b); break;
        case 'not': case 'neg': walk(n.a); break;
        case 'cond': walk(n.test); walk(n.a); walk(n.b); break;
        default: break;
      }
    };
    walk(e);
  });
  for (const [name, line] of all) {
    if (BUILTIN_NAMES.has(name) || locals.has(name) || found.has(name)) continue;
    found.set(name, { name, type: 'String', required: false, line });
  }
  return [...found.values()].map(v => ({ ...v, line: all.get(v.name) ?? v.line }));
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────

/** Names the vendor refuses as template variables (`DEFAULT_PARAM_NAMES`). */
const FORBIDDEN_VARIABLES = new Set(['format', 'q']);

export type RenderOptions = {
  /** Publish-time validation uses the vendor's placeholders. */
  test?: boolean;
  /** The API's Pipe node name in parser errors. */
  name?: string;
};

/** An item of a parameter the template types `Array(T)`: a number for a numeric T, else the text. */
function arrayParamItem(et: string, p: string): TValue {
  if (!TESTED_TYPES.has(et) || et === 'DateTime' || et === 'DateTime64' || et === 'Date' || et === 'Bool') return p;
  return normBig(BigInt(p.trim()));
}

/**
 * Render a node's SQL for one request. Non-template SQL (no `%` marker) is returned as-is.
 * `params` are the request's query parameters, as strings.
 */
// source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "def render_sql_template("
export function renderTinybirdTemplate(sql: string, params: Record<string, string>, options: RenderOptions = {}): string {
  if (!isTemplate(sql)) return sql;
  const nodes = templateOf(sql, options.name);
  const vars = templateVariables(sql, options.name);
  for (const v of vars) {
    if (FORBIDDEN_VARIABLES.has(v.name)) throw new TemplateError(`"${v.name}" can not be used as a variable name, line ${v.line}`);
  }
  const mode: Mode = { test: options.test === true };
  const scope: Scope = new Map([['open', null], ['close', null], ['print', null], ['input', null]]);
  const typeFns = typeFunctions(mode);
  for (const v of vars) {
    if (mode.test) scope.set(v.name, new Placeholder(v.name, v.line));
    else scope.set(v.name, null);
  }
  // source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "variables.update(processed_variables)"
  // preprocess_variables runs before both ordinary and test-mode rendering.
  for (const [k, raw] of Object.entries(params)) {
    const declared = vars.find(v => v.name === k);
    let value: TValue = raw;
    if (declared && /^Array\(/.test(declared.type)) {
      const et = /^Array\((\w+)\)/.exec(declared.type)?.[1] ?? 'String';
      const parts = raw.split(',');
      if (parts && (!TESTED_TYPES.has(et) || parts.every(p => passesTester(et, p)))) value = parts.map(p => arrayParamItem(et, p));
    }
    scope.set(k, value);
  }
  for (const [k, fn] of Object.entries(typeFns)) scope.set(k, fn);
  for (const [k, fn] of Object.entries(baseFunctions(mode))) scope.set(k, fn);
  let out = '';
  const run = (body: TNode[]): void => {
    for (const n of body) {
      if (n.t === 'text') out += n.s;
      else if (n.t === 'expr') out += renderExpression(evalPy(n.e, scope), n.src);
      else if (n.t === 'set') scope.set(n.name, evalPy(n.e, scope));
      else if (n.t === 'if') {
        for (const b of n.branches) {
          if (b.cond === undefined || truthy(evalPy(b.cond, scope))) { run(b.body); break; }
        }
      } else if (n.t === 'for') {
        const it = evalPy(n.iter, scope);
        let items: TValue[];
        if (it instanceof Placeholder) items = [new Placeholder(), new Placeholder(), new Placeholder()];
        else if (Array.isArray(it)) items = it;
        else if (typeof it === 'string') items = [...it];
        else if (isDict(it)) items = Object.keys(it);
        else throw new TemplateError(`Template Syntax Error: a value object is not iterable`);
        for (const item of items) {
          if (n.vars.length === 1) scope.set(n.vars[0]!, item);
          else {
            const parts = Array.isArray(item) ? item : [];
            n.vars.forEach((v, idx) => scope.set(v, parts[idx] ?? null));
          }
          run(n.body);
        }
      }
    }
  };
  // source: archive:https://files.pythonhosted.org/packages/c3/60/ce9543ef4e645c2afb1884019176022f5a2ba19f0b1e7d797185694a762e/tinybird_cli-6.5.5-py3-none-any.whl#sha256=58333030758962f1ef9e74a9ba034f2e88800be68d7af13670fd588b253cdb39!/tinybird/sql_template.py "and item.get(\"used_in\", None) is None"
  try { run(nodes); } catch (error) {
    if (!(error instanceof TemplateError) || !error.message.includes(REQUIRED_PARAM_NOT_DEFINED)) throw error;
    const missing = vars.filter(v => v.default === undefined && TYPE_FUNCTION_NAMES.has(v.type)).map(v => v.name);
    const names = missing.length < 2 ? missing.join('') : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
    if (!names) throw error;
    throw new TemplateError(`Template Syntax Error: ${REQUIRED_PARAM_NOT_DEFINED}. Check the parameters ${names}. Please provide a value or set a default value in the pipe code.`, error.status);
  }
  return out;
}
