// SLACK'S SIGN-UP — slack.com/get-started, where a person creates a workspace (a hosted flow,
// docs/contributing/architecture.md, "Screens"): their work email and name, and the workspace is made with them as its
// primary owner ("The person who creates a workspace is its Primary Owner",
// https://slack.com/help/articles/360018112273-Types-of-roles-in-Slack), with its #general channel ("Every workspace
// has a default channel", https://slack.com/help/articles/360047512554).
//
// Where the documentation stops and the twin decides: the World's first workspace is `T0VOLTER01`;
// it is named for the email's domain (`kiln.studio` → Kiln, domain `kiln`); the person's id is the one their client
// token names. Each workspace has a unique URL.
import type { HandlerContext } from '@volter/world-core';
import { HOME_TEAM } from '../engine/wire.ts';
import { makeWorkspace } from '../semantics/shared.ts';
import { field, page, refused, visitor } from './shared.tsx';

const form = (ctx: HandlerContext, error?: string): Response => page('Create a workspace', (
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
  if (!who) return refused(401, 'Sign in to Slack first', `${ctx.publicBase}/signin`);
  if (method === 'GET') return form(ctx);
  const email = field(ctx, 'email').trim().toLowerCase();
  const name = field(ctx, 'name').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) return form(ctx, 'Enter your work email and your full name.');
  const label = email.split('@')[1]!.split('.')[0]!;
  const made = await makeWorkspace(ctx, ctx.get('team', HOME_TEAM) ? undefined : HOME_TEAM, { id: who.id, email, name }, { name: label[0]!.toUpperCase() + label.slice(1), domain: label });
  if (!made) return refused(409, 'This workspace URL is already in use.');
  return page('Your workspace is ready', <><h1>Your workspace is ready</h1><p className="sk-lead">Welcome to Slack, {name}.</p><p><a href={`${ctx.publicBase}/client/${made.team}/${made.general}`}>Open Slack</a></p></>, 201);
}
