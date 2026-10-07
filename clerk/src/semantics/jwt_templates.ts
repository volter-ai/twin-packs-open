// JWT templates, the `/jwt_templates` family (https://clerk.com/docs/guides/sessions/jwt-templates): made and changed by
// these handlers, read, listed and deleted by the derived core. A template's own signing key is kept as bookkeeping
// (`_signing_key`), never answered. Clerk's refusals are those of
// https://clerk.com/docs/guides/development/errors/backend-api (ERRORS), by code.
import { type HandlerContext, SIGNING_ALGORITHMS, type SigningKey } from '@volter/world-core';
import { body, clerkError, invalid, missing, ms, notFound, outOfRange, own } from './shared.ts';

type Row = Record<string, unknown>;
/** "Clerk automatically includes the following default claims" and they "cannot be overridden by templates" (the
 *  jwt-templates page): naming one is ERRORS' 400 `jwt_template_reserved_claim`. */
const RESERVED = ['azp', 'exp', 'iat', 'iss', 'jti', 'nbf', 'sub'];
function claimsError(claims: unknown): Response | undefined {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return missing('claims');
  const reserved = Object.keys(claims as Row).find((k) => RESERVED.includes(k));
  return reserved ? clerkError(400, 'jwt_template_reserved_claim', 'reserved claim used', `You can't use the reserved claim: '${reserved}'`) : undefined;
}

/** The template's settings a create or an update gives: its name, claims, lifetime and skew (defaults "60 seconds" and
 *  "5 seconds", the jwt-templates page), and its own signing key when it brings one. */
function settings(b: Row, current: Row = {}): Row | Response {
  const custom = b.custom_signing_key === undefined ? current.custom_signing_key === true : b.custom_signing_key === true;
  if (custom && typeof b.signing_key !== 'string' && typeof current._signing_key !== 'string') return missing('signing_key');
  // source: spec:CreateJWTTemplate "The custom signing algorithm to use when minting JWTs. Required if `custom_signing_key` is `true`."
  const algorithm = typeof b.signing_algorithm === 'string' ? b.signing_algorithm : current.custom_signing_key === true ? current.signing_algorithm : undefined;
  if (custom && typeof algorithm !== 'string') return missing('signing_algorithm');
  // The documentation names no list of algorithms: the twin signs the deterministic ones (RSA and HMAC, SHA-256 to 512) and
  // refuses any other (`none`, ECDSA's random signatures) as a value the parameter does not take.
  // (the kernel also signs EdDSA, with an Ed25519 key; a custom key here is an RSA PEM or a secret, so it is not one of these)
  const signs = SIGNING_ALGORITHMS.filter((a) => a !== 'EdDSA');
  if (custom && !signs.includes(algorithm as (typeof signs)[number])) return invalid('signing_algorithm', `signing_algorithm must be one of ${signs.join(', ')}.`);
  // spec: `lifetime` "minimum: 30", "maximum: 315360000"; `allowed_clock_skew` "minimum: 0", "maximum: 300"
  const bad = outOfRange('lifetime', b.lifetime, 30, 315_360_000) ?? outOfRange('allowed_clock_skew', b.allowed_clock_skew, 0, 300);
  if (bad) return bad;
  return {
    ...(typeof b.name === 'string' ? { name: b.name } : {}),
    ...(b.claims !== undefined ? { claims: b.claims } : {}),
    lifetime: typeof b.lifetime === 'number' ? b.lifetime : (current.lifetime ?? 60),
    allowed_clock_skew: typeof b.allowed_clock_skew === 'number' ? b.allowed_clock_skew : (current.allowed_clock_skew ?? 5),
    custom_signing_key: custom,
    signing_algorithm: custom ? algorithm : 'RS256',
    ...(custom && typeof b.signing_key === 'string' ? { _signing_key: b.signing_key } : {}),
    ...(!custom ? { _signing_key: null } : {}),
  };
}

/** `POST /jwt_templates`: a template's claims, signed with the instance's key unless it brings its own
 *  (spec:/components/schemas/JWTTemplate). */
export async function CreateJWTTemplate(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  if (typeof b.name !== 'string' || !b.name) return missing('name');
  const bad = claimsError(b.claims);
  if (bad) return bad;
  const taken = ctx.conflict('JWTTemplate', { name: b.name });
  if (taken) return taken;
  const fields = settings(b);
  if (fields instanceof Response) return fields;
  const id = ctx.mint('JWTTemplate');
  const at = ms(ctx);
  await ctx.write('JWTTemplate', id, { object: 'jwt_template', ...fields, created_at: at, updated_at: at }, 'jwt_template.create');
  return ctx.reply(own(ctx, ctx.row('JWTTemplate', id)!));
}

/** `PATCH /jwt_templates/{template_id}`: the template sent whole (its name and claims required), a new signing key kept
 *  as the old one was. */
export async function UpdateJWTTemplate(ctx: HandlerContext): Promise<Response> {
  const current = ctx.row('JWTTemplate', String(ctx.call.params.template_id));
  if (!current) return notFound(`No JWT template exists with id: ${String(ctx.call.params.template_id)}`);
  const b = body(ctx);
  // source: https://clerk.com/docs/guides/development/errors/backend-api "must be included."
  // spec: UpdateJWTTemplate's body requires `name` and `claims` (the template is sent whole); ERRORS'
  // FormMissingParameter, 422 `form_param_missing`
  if (typeof b.name !== 'string' || !b.name) return missing('name');
  const bad = claimsError(b.claims);
  if (bad) return bad;
  const taken = ctx.conflict('JWTTemplate', { name: b.name }, String(current.id));
  if (taken) return taken;
  const fields = settings(b, current);
  if (fields instanceof Response) return fields;
  await ctx.write('JWTTemplate', String(current.id), { ...fields, updated_at: ms(ctx) }, 'jwt_template.update');
  return ctx.reply(own(ctx, ctx.row('JWTTemplate', String(current.id))!));
}
