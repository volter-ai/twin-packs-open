// Absence/presence is the stored state. Engine, type and sorting key are schema, not states.
const present = (source: string) => ({
  state: { _present: { initial: false, transitions: [
    { operation: 'query_post', actor: 'api' as const, from: ['false'], to: 'true', source },
  ] } },
});
export const states = {
  database: present('https://clickhouse.com/docs/sql-reference/statements/create/database "CREATE DATABASE"'),
  table: present('https://clickhouse.com/docs/sql-reference/statements/create/table "CREATE TABLE"'),
  row: present('https://clickhouse.com/docs/sql-reference/statements/insert-into "INSERT INTO"'),
};
