// SLACK'S SIGN-UP — slack.com/get-started, where a person creates a workspace (a hosted flow,
// docs/contributing/architecture.md, "Screens"): their work email and name, and the workspace is made with them as its
// primary owner ("The person who creates a workspace is its Primary Owner",
// https://slack.com/help/articles/360018112273-Types-of-roles-in-Slack), with its #general channel ("Every workspace
// has a default channel", https://slack.com/help/articles/360047512554).
//
// Where the documentation stops and the twin decides: the World's first workspace is `T0VOLTER01`;
// it is named for the email's domain (`kiln.studio` → Kiln, domain `kiln`); the person's id is the one their client
// token names; a second sign-up makes no second workspace (409).
import type { HandlerContext } from '@volter/world-core';
import { HOME_TEAM } from '../engine/wire.ts';
import { addMember, addToTeam } from '../semantics/shared.ts';
import { field, page, refused, visitor } from './shared.tsx';

const form = (error?: string): Response => page('Create a workspace', (
  <>
    <h1>Create a new Slack workspace</h1>
    <p className="sk-lead">Slack gives your team a home: a place where they can talk and work together.</p>
    {error ? <p className="sk-notice" role="alert">{error}</p> : null}
    <form className="sk-card" method="post" action={`${ctx.publicBase}/get-started`}>
      <label htmlFor="email">Your work email</label>
      <input id="email" name="email" type="email" required placeholder="name@work-email.com" />
      <label htmlFor="name">Your full name</label>
      <input id="name" name="name" required />
      <div className="sk-actions"><button type="submit">Create workspace</button></div>
    </form>
  </>
), error ? 400 : 200);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const method = ctx.call.request.method;
  if (method !== 'GET' && method !== 'POST') return refused(405, 'Method not allowed');
  const who = visitor(ctx);
  if (!who) return refused(401, 'Sign in to Slack first');
  if (method === 'GET') return form();
  const email = field(ctx, 'email').trim().toLowerCase();
  const name = field(ctx, 'name').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return form('Enter your work email and your full name.');
  if (ctx.get('team', HOME_TEAM)) return refused(409, 'This World already has its workspace');
  const label = email.split('@')[1]!.split('.')[0]!;
  const at = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  await ctx.write('team', HOME_TEAM, { name: label[0]!.toUpperCase() + label.slice(1), domain: label, email_domain: email.split('@')[1], created: at, created_by: who.id }, 'team.create');
  const [first, ...rest] = name.split(/\s+/);
  await ctx.write('user', who.id, {
    name: email.split('@')[0], team_id: HOME_TEAM, deleted: false, is_primary_owner: true, is_owner: true, is_admin: true, created: at, updated: at,
    profile: { real_name: name, display_name: '', email, first_name: first, last_name: rest.join(' '), title: '' },
  }, 'user.join');
  await addToTeam(ctx, HOME_TEAM, who.id);
  // the purpose is Slack's own, set by no one
  // source: spec:/paths/~1conversations.list/get/responses/200/examples/application~1json/channels/0/purpose "creator"
  const general = ctx.mint('channel');
  await ctx.write('channel', general, {
    name: 'general', context_team_id: HOME_TEAM, is_private: false, is_general: true, created: at, updated: at * 1000, creator: who.id, is_archived: false,
    topic: { value: '', creator: '', last_set: 0 }, purpose: { value: 'This is the one channel that will always include everyone.', creator: '', last_set: 0 },
  }, 'channel.create');
  await addMember(ctx, general, who.id);
  return page('Your workspace is ready', <><h1>Your workspace is ready</h1><p className="sk-lead">Welcome to Slack, {name}.</p></>, 201);
}
