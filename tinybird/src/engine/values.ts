// ClickHouse® values, as the kernel's ClickHouse engine carries them (the root's `clickhouse`): Tinybird's engine is
// the kernel's, and its query error is the engine's (a refusal with the status and message Tinybird answers).
import { clickhouse } from '@volter/world-core';

export const { baseType, compareValues, defaultOf, fromStored, isWideIntegerType, stringifyJson, toStored, typeHead, valueKey } = clickhouse;
export const TinybirdQueryError = clickhouse.ClickHouseError;
export type TinybirdQueryError = InstanceType<typeof clickhouse.ClickHouseError>;
