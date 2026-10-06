// The account's frames on the World's board (architecture, "The board"): each repository at its page on github.com,
// grouped by the user or organization that owns it. A repository's changes are its own. Frames are named by the
// repository's id, which a rename or a transfer keeps.
import type { BoardFrame, HandlerContext } from '@volter/world-core';
import { ownerOf, type Row } from './shared.ts';

export function board(ctx: HandlerContext): BoardFrame[] {
  const section = (repo: Row): BoardFrame['section'] => ({ id: `owner:${ownerOf(repo).toLowerCase()}`, title: ownerOf(repo) });
  const repos = ctx.rowsRaw('repository').filter((r) => r.deleted !== true).sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  return repos.map((repo): BoardFrame => ({
    id: `repo:${String(repo.id)}`, kind: 'repository', title: String(repo.full_name),
    section: section(repo), url: `https://github.com/${String(repo.full_name)}`,
    covers: [{ type: 'repository', id: String(repo.id) }],
  }));
}
