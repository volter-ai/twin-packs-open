// source: https://cwe.mitre.org/data/definitions/1000.html "Research Concepts"
// Frozen reference data; reproduced from spec/cwes.txt.gz by spec/derive-cwes.ts.
import names from './cwes.json' with { type: 'json' };
export const cweNames: Readonly<Record<string, string>> = names;
