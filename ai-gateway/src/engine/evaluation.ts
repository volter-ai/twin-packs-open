// Native EvaluationModelV4 answers, never inferred from a chat response or a model.
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};

// source: https://unpkg.com/@ai-sdk/gateway@4.0.87/dist/index.js "gatewayEvaluationAnswerSchema"
export function evaluationResponseError(value: unknown): string | null {
  const response = obj(value);
  if (!response.answers || typeof response.answers !== 'object' || Array.isArray(response.answers)) return malformedEvaluationResponse();
  const valid = Object.values(response.answers).every(answer => {
    const a = obj(answer);
    return a.type === 'boolean' && typeof a.probability === 'number' && Number.isFinite(a.probability)
      || a.type === 'choice' && typeof a.choice === 'string'
      || a.type === 'score' && typeof a.score === 'number' && Number.isFinite(a.score);
  });
  return valid ? null : unsupportedEvaluationAnswer();
}

// source: https://unpkg.com/@ai-sdk/provider@4.0.18/dist/index.d.ts "EvaluationModelV4Question"
export function evaluationQuestionsError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length) return 'questions must be a nonempty object';
  for (const question of Object.values(value)) {
    const q = obj(question);
    if (!['boolean', 'choice', 'score'].includes(String(q.type)) || q.instructions === undefined) return 'questions need a supported type and instructions';
  }
  return null;
}

export function evaluationStub(questions: Row): Row {
  const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const q = obj(question);
    const answer = q.type === 'boolean' ? { type: 'boolean', probability: 0.5 }
      : q.type === 'choice' ? { type: 'choice', choice: Object.keys(obj(q.criteria))[0] ?? '' }
        : { type: 'score', score: 0 };
    return [name, answer];
  }));
  return { answers, warnings: [{ type: 'other', message: 'Vercel AI Gateway twin: deterministic evaluation stub; no model judgment.' }] };
}

// Invalid scenario authoring is refused before any vendor request runs.
export function unsupportedEvaluationAnswer(): string {
  return 'answers use boolean/probability, choice/choice or score/score';
}

export function malformedEvaluationResponse(): string {
  return 'respond.answers is an object of native evaluation answers';
}
