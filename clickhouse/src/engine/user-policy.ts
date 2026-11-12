import { SqlError } from './ddl.ts';
import type { ReadonlyMode } from './configuration.ts';
import reading from '../../spec/recordings/readonly-setting-defaults-24.12.json' with { type: 'json' };

/** Process-local capability marks verified original-user installation, never a public configuration field. */
export const SOURCE_POLICY_HEADER = 'X-Volter-ClickHouse-Source-Policy';

// source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Core/Settings.cpp "except for the 'readonly' setting"
// source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Server/HTTP/setReadOnlyIfHTTPMethodIdempotent.cpp "Anything else beside HTTP POST should be readonly queries"
export function parseReadonly(value: unknown): ReadonlyMode {
  if (!((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && /^\d+$/.test(value))))
    throw new SqlError(36, 'Invalid readonly setting');
  const decimal = String(value).replace(/^0+/, '') || '0';
  if (decimal.length > 20 || BigInt(decimal) > 0xffffffffffffffffn) throw new SqlError(36, 'Invalid readonly setting');
  return BigInt(decimal) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(decimal) : decimal;
}
// source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Access/SettingsConstraints.cpp "Cannot modify '{}' setting in readonly mode"
/** Source profiles currently serve only readonly; inherited settings/constraints remain input gaps. */
export function servedReadonly(value: unknown): ReadonlyMode {
  return parseReadonly(value);
}
export type ClientSetting = { name: string; value: string; flags?: number };
type SettingDefault = { type: string; comparison?: string; value?: unknown };
const defaults = reading.settings as Record<string, SettingDefault>;
function unchanged(setting: ClientSetting): boolean {
  // source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Access/SettingsConstraints.cpp "Setting isn't checked if value has not changed."
  // source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Core/SettingsFields.cpp "Cannot parse bool from string '{}'"
  const definition = Object.hasOwn(defaults, setting.name) ? defaults[setting.name] : undefined;
  const gap = (): never => { throw new SqlError(48, `Readonly setting comparison is not implemented for '${setting.name}'`); };
  if (!definition?.comparison) return gap();
  if (definition.comparison === 'string') return setting.value === definition.value;
  if (definition.comparison === 'boolean') {
    if (!/^(0|1|true|false)$/i.test(setting.value)) return gap();
    return /^(1|true)$/i.test(setting.value) === definition.value;
  }
  if (definition.comparison === 'integer') {
    if (!/^[+-]?\d+$/.test(setting.value)) return gap();
    const decimal = setting.value.replace(/^[+]/, '').replace(/^(-?)0+(?=\d)/, '$1');
    if (decimal.length > 21) return gap();
    const value = BigInt(decimal), signed = definition.type.startsWith('Int'), width = BigInt(definition.type.endsWith('32') ? 32 : 64);
    if (value < (signed ? -(1n << (width - 1n)) : 0n) || value >= (1n << (signed ? width - 1n : width))) return gap();
    return value === BigInt(String(definition.value));
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(setting.value)) return gap();
  const value = Number(setting.value);
  if (!Number.isFinite(value) || (definition.comparison === 'float32' && !Number.isFinite(Math.fround(value)))) return gap();
  return definition.comparison === 'float32' ? Math.fround(value) === Math.fround(Number(definition.value)) : value === definition.value;
}
/** Constraints use the profile/method state before the whole settings batch is applied. */
export function effectiveReadonly(profile: ReadonlyMode, requested: unknown, nonPost: boolean, settings: ClientSetting[] = []): ReadonlyMode {
  const initial = servedReadonly(profile);
  const current = initial === 0 && nonPost ? 2 : initial;
  let next = requested === undefined ? current : parseReadonly(requested);
  for (const setting of settings) {
    if (setting.name === 'readonly') {
      next = parseReadonly(setting.value);
      if (current !== 0 && String(next) !== String(current)) throw new SqlError(164, "Cannot modify 'readonly' setting in readonly mode");
    } else if (!unchanged(setting)) {
      if (current === 1) throw new SqlError(164, `Cannot modify '${setting.name}' setting in readonly mode`);
      // The vendor applies allowed changes after checking the whole batch.
      // This engine serves readonly only; no other changed setting can be
      // acknowledged unless its effect is implemented before query execution.
      throw new SqlError(48, `Applying client setting '${setting.name}' is not implemented`);
    }
  }
  if (current !== 0 && String(next) !== String(current)) throw new SqlError(164, "Cannot modify 'readonly' setting in readonly mode");
  return next;
}
