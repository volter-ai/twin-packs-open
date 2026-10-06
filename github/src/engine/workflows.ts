// A GitHub Actions workflow file as GitHub reads it (https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions):
// its name, the events that run it with their branch and tag filters, the permissions its GITHUB_TOKEN holds, and its
// jobs.
import { parseYaml } from './yaml.ts';

type Row = Record<string, unknown>;

export type Workflow = {
  /** `.github/workflows/<file>` */
  path: string;
  /** "The name of the workflow. GitHub displays the names of your workflows under your repository's Actions tab. If you
   *  omit name, GitHub displays the workflow file path relative to the root of the repository." */
  name: string;
  on: Record<string, Row | null>;
  permissions: Record<string, string>;
  /** each job's name: its `name`, else its id */
  jobs: string[];
};

/** The permissions a GITHUB_TOKEN holds when a workflow names none: a repository's default, "Read repository contents
 *  and packages permissions" (https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#permissions-for-the-github_token). */
const DEFAULT_PERMISSIONS = { contents: 'read', metadata: 'read', packages: 'read' };

/** A workflow file, or undefined for one GitHub would not run (no `on`, no `jobs`). */
export function readWorkflow(path: string, text: string): Workflow | undefined {
  let doc: unknown;
  try { doc = parseYaml(text); } catch { return undefined; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return undefined;
  const d = doc as Row;
  const rawOn = d.on ?? d.true; // YAML 1.1 readers take `on` as true; this reader keeps it, and takes either
  const on: Record<string, Row | null> = typeof rawOn === 'string' ? { [rawOn]: null }
    : Array.isArray(rawOn) ? Object.fromEntries(rawOn.map((e) => [String(e), null]))
    : rawOn && typeof rawOn === 'object' ? Object.fromEntries(Object.entries(rawOn as Row).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null])) : {};
  const jobsRaw = d.jobs && typeof d.jobs === 'object' ? (d.jobs as Record<string, Row>) : {};
  if (!Object.keys(on).length || !Object.keys(jobsRaw).length) return undefined;
  // "If you specify the access for any of these permissions, all of those that are not specified are set to none",
  // metadata excepted, which is always read
  const declared = d.permissions;
  const permissions: Record<string, string> = declared === 'read-all' ? { ...DEFAULT_PERMISSIONS, actions: 'read', checks: 'read', 'pull-requests': 'read', issues: 'read', pages: 'read' }
    : declared === 'write-all' ? { contents: 'write', metadata: 'read', packages: 'write', actions: 'write', checks: 'write', 'pull-requests': 'write', issues: 'write', pages: 'write', 'security-events': 'write', 'id-token': 'write' }
    : declared && typeof declared === 'object' ? { metadata: 'read', ...Object.fromEntries(Object.entries(declared as Row).map(([k, v]) => [k, String(v)])) } : { ...DEFAULT_PERMISSIONS };
  return {
    path, name: typeof d.name === 'string' ? d.name : path, on, permissions,
    jobs: Object.entries(jobsRaw).map(([id, job]) => (typeof job?.name === 'string' ? job.name : id)),
  };
}

/** A branch or tag filter's pattern as a regular expression: `*` any run of characters but `/`, `**` any run at all,
 *  `?` one character (https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#filter-pattern-cheat-sheet). */
function glob(pattern: string): RegExp {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`);
}

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []);

/** Whether a name passes an event's filters: `branches`/`tags` (any match) and their `-ignore` forms. */
function passes(filters: Row | null, key: 'branches' | 'tags', name: string, other: 'branches' | 'tags'): boolean {
  if (!filters) return true;
  const only = listOf(filters[key]);
  const ignore = listOf(filters[`${key}-ignore`]);
  // a push filtered only by the other kind of ref does not run for this one ("If you define only tags … the workflow
  // won't run for events affecting branches")
  const otherOnly = (filters[other] !== undefined || filters[`${other}-ignore`] !== undefined) && filters[key] === undefined && filters[`${key}-ignore`] === undefined;
  if (otherOnly) return false;
  if (only.length && !only.some((p) => glob(p).test(name))) return false;
  if (ignore.some((p) => glob(p).test(name))) return false;
  return true;
}

/** An event a workflow may run on. */
export type Trigger = { event: 'push'; ref: string } | { event: 'pull_request' | 'pull_request_target'; base: string };

/** Whether a workflow runs on an event: a push to a branch or tag its `push` filters take, a pull request into a base
 *  branch its `pull_request` (or `pull_request_target`) filters take. */
export function runsOn(w: Workflow, t: Trigger): boolean {
  if (!(t.event in w.on)) return false;
  const filters = w.on[t.event] ?? null;
  if (t.event === 'push') {
    const tag = t.ref.startsWith('refs/tags/');
    const name = t.ref.replace(/^refs\/(heads|tags)\//, '');
    return tag ? passes(filters, 'tags', name, 'branches') : passes(filters, 'branches', name, 'tags');
  }
  return passes(filters, 'branches', t.base, 'tags');
}
