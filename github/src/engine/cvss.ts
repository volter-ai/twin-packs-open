// A CVSS 3.x vector's base score and its severity, as the CVSS v3.1 specification computes them
// (https://www.first.org/cvss/v3.1/specification-document, 7.1 "Base Metrics Equations" and 5 "Qualitative Severity
// Rating Scale"): GitHub scores a repository advisory from the vector its author gives.

const WEIGHTS: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 }, I: { H: 0.56, L: 0.22, N: 0 }, A: { H: 0.56, L: 0.22, N: 0 },
};
/** Privileges Required weighs more when the scope changes. */
const PR: Record<string, [number, number]> = { N: [0.85, 0.85], L: [0.62, 0.68], H: [0.27, 0.5] };

/** The smallest number, to one decimal place, equal to or higher than its input (the specification's Roundup, Appendix A). */
function roundup(x: number): number {
  const n = Math.round(x * 100000);
  return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10;
}

/** A CVSS 3.0 or 3.1 vector's base score, or undefined for a vector it cannot read. */
export function cvssScore(vector: string): number | undefined {
  const m = /^CVSS:3\.[01]\/(.+)$/.exec(vector);
  if (!m) return undefined;
  const v: Record<string, string> = {};
  for (const part of m[1]!.split('/')) { const [k, x] = part.split(':'); if (k && x) v[k] = x; }
  const changed = v.S === 'C';
  const w = (k: string): number | undefined => WEIGHTS[k]?.[v[k] ?? ''];
  const [av, ac, ui, c, i, a] = [w('AV'), w('AC'), w('UI'), w('C'), w('I'), w('A')];
  const pr = PR[v.PR ?? '']?.[changed ? 1 : 0];
  if ([av, ac, ui, c, i, a, pr].some((x) => x === undefined) || (v.S !== 'U' && !changed)) return undefined;
  const iss = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploitability = 8.22 * av! * ac! * pr! * ui!;
  if (impact <= 0) return 0;
  return roundup(Math.min((changed ? 1.08 : 1) * (impact + exploitability), 10));
}

/** A score's qualitative rating: low, medium, high or critical (none for 0.0, which an advisory has no severity for). */
export function cvssSeverity(score: number): 'low' | 'medium' | 'high' | 'critical' | null {
  return score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : score > 0 ? 'low' : null;
}
