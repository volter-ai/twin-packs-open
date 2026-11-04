// news.ycombinator.com/user?id=: an account's page (news.ycombinator.com/user?id=nosuchuserzzq9 answers "No such user."
// as text, read 2026-10-02).
import type { HandlerContext } from '@volter/world-core';
import { userOf } from '../semantics/shared.ts';
import { noSuchUserPage, page, query } from './shared.tsx';

const created = (time: unknown): string => new Date(Number(time) * 1000).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export async function screen(ctx: HandlerContext): Promise<Response> {
  const user = userOf(ctx, query(ctx, 'id'));
  if (!user) return noSuchUserPage();
  return page(ctx, `Profile: ${String(user.id)} | Hacker News`, (
    <table>
      <tbody>
        <tr><td>user:</td><td><a className="hnuser" href={`user?id=${String(user.id)}`}>{String(user.id)}</a></td></tr>
        <tr><td>created:</td><td>{created(user.created)}</td></tr>
        <tr><td>karma:</td><td>{String(user.karma ?? 1)}</td></tr>
        <tr><td>about:</td><td dangerouslySetInnerHTML={{ __html: String(user.about ?? '') }} /></tr>
      </tbody>
    </table>
  ));
}
