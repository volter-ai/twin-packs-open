import { gunzip, type HandlerContext } from '@volter/world-core';
import { bearerToken, detail, EVENT, forbidden, grants, keyOf, makeProject, notFound, orgFor, PROJECT, projectFor, projectOf, projectView, type Row, wire } from './shared.ts';

// Releases, as sentry-cli makes, finalizes and associates commits with them (`releases new`, `releases finalize`,
// `releases set-commits`), for one project at its path or for the organization; and the organization's repositories the
// commits are read against. A release is the organization's, by its version, linked to the projects it was made for.

const RELEASE = 'release';
const releaseBody = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' ? ctx.body as Row : {});
const releaseOf = (ctx: HandlerContext, org: Row, version: string): Row | undefined =>
  ctx.rowsRaw(RELEASE).find((r) => r.deleted !== true && r._organization === org.id && r.version === version);

/** A release as the API answers it (the spec's release schema). */
function view(ctx: HandlerContext, r: Row): Row {
  const projects = (r._projects as string[]).map((id) => ctx.row(PROJECT, id)).filter((p): p is Row => !!p);
  const events = ctx.rowsRaw(EVENT).filter((e) => e.release === r.version && (r._projects as string[]).includes(String(e.project))).map((e) => String(e.dateCreated)).sort();
  return {
    id: Number(r.id), version: r.version, shortVersion: String(r.version).length > 12 && /^[0-9a-f]{40}$/.test(String(r.version)) ? String(r.version).slice(0, 12) : r.version,
    status: 'open', ref: r.ref ?? null, url: r.url ?? null, dateReleased: r.dateReleased ?? null, dateCreated: r.dateCreated, data: {}, newGroups: 0, owner: null,
    commitCount: Number(r.commitCount ?? 0), lastCommit: r.lastCommit ?? null, deployCount: 0, lastDeploy: null, authors: [], userAgent: r.userAgent ?? null, currentProjectMeta: {},
    firstEvent: events[0] ?? null, lastEvent: events.at(-1) ?? null, versionInfo: { package: null, version: { raw: r.version }, description: r.version, buildHash: null },
    projects: projects.map((p) => ({ id: Number(p.id), slug: p.slug, name: p.name, newGroups: 0, platform: p.platform ?? null, platforms: p.platform ? [p.platform] : [], hasHealthData: false })),
  };
}

/** A release made for projects of the organization, or the projects linked to one that exists: 201 when anything was
 *  made or linked, else 208 (the release as it was). */
async function makeRelease(ctx: HandlerContext, org: Row, projectIds: string[]): Promise<Response> {
  const b = releaseBody(ctx);
  const version = typeof b.version === 'string' ? b.version : '';
  // the release's version: not empty, no "/", not "." or ".." or "latest" (the spec's version field)
  if (!version || version.includes('/') || ['.', '..', 'latest'].includes(version) || version.length > 200) return Response.json({ version: ['Release with name "' + version + '" is not allowed.'] }, { status: 400 });
  const held = releaseOf(ctx, org, version);
  const fields = { ...(typeof b.ref === 'string' ? { ref: b.ref } : {}), ...(typeof b.url === 'string' ? { url: b.url } : {}), ...(typeof b.dateReleased === 'string' ? { dateReleased: b.dateReleased } : {}) };
  if (held) {
    const linked = [...new Set([...(held._projects as string[]), ...projectIds])];
    if (linked.length === (held._projects as string[]).length) return Response.json(view(ctx, held), { status: 208 });
    const kept = await ctx.write(RELEASE, String(held.id), { _projects: linked, ...fields }, 'release.update');
    const answer = view(ctx, ctx.row(RELEASE, String(kept.id))!);
    await ctx.write(RELEASE, String(kept.id), answer, 'release.update');
    return Response.json(answer, { status: 201 });
  }
  const id = ctx.mint(RELEASE);
  const made = await ctx.write(RELEASE, id, { id: Number(id), version, _organization: org.id, _projects: projectIds, projects: projectIds, dateCreated: ctx.occurredAt, userAgent: ctx.call.request.headers.get('user-agent'), ...fields }, 'release.create');
  const answer = view(ctx, ctx.row(RELEASE, id)!);
  await ctx.write(RELEASE, id, answer, 'release.update');
  return Response.json(answer, { status: 201 });
}

/** A release's changes: when it was released, its ref and URL, and the commits named by `refs` (each a repository the
 *  organization has). */
async function changeRelease(ctx: HandlerContext, org: Row, r: Row): Promise<Response> {
  const b = releaseBody(ctx);
  const refs = Array.isArray(b.refs) ? b.refs as Row[] : [];
  const repos = ctx.rowsRaw('repository').filter((x) => x.deleted !== true && x.organization === org.id).map((x) => String(x.name));
  const unknown = refs.map((x) => String(x.repository ?? '')).filter((n) => !repos.includes(n));
  if (unknown.length) return Response.json({ refs: [`Invalid repository names: ${unknown.join(',')}`] }, { status: 400 });
  const kept = await ctx.write(RELEASE, String(r.id), {
    ...(typeof b.dateReleased === 'string' || b.dateReleased === null ? { dateReleased: b.dateReleased } : {}),
    ...(typeof b.ref === 'string' ? { ref: b.ref } : {}), ...(typeof b.url === 'string' ? { url: b.url } : {}), ...(refs.length ? { _refs: refs } : {}), ...(Array.isArray(b.commits) ? { _commits: b.commits, commitCount: b.commits.length, lastCommit: (b.commits as Row[]).at(-1) ?? null } : {}),
  }, 'release.update');
  const answer = view(ctx, ctx.row(RELEASE, String(kept.id))!);
  await ctx.write(RELEASE, String(kept.id), answer, 'release.update');
  return Response.json(answer);
}

// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/releases/endpoints/project_releases.py "Create a new release and/or associate a project with a release."
export async function createProjectRelease(ctx: HandlerContext): Promise<Response> {
  const at = projectFor(ctx, 'project:releases');
  if (at instanceof Response) return at;
  return makeRelease(ctx, at.org, [String(at.project.id)]);
}



// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/releases/endpoints/project_release_details.py "def put("
export async function updateProjectRelease(ctx: HandlerContext): Promise<Response> {
  const at = projectFor(ctx, 'project:releases');
  if (at instanceof Response) return at;
  const r = releaseOf(ctx, at.org, String(ctx.call.params.version ?? ''));
  return r && (r._projects as string[]).includes(String(at.project.id)) ? changeRelease(ctx, at.org, r) : detail(404, 'The requested resource does not exist');
}

// source: spec:updateOrganizationRelease "Update a release. This can change some metadata associated with"
export async function updateOrganizationRelease(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'project:releases');
  if (org instanceof Response) return org;
  const r = releaseOf(ctx, org, String(ctx.call.params.version ?? ''));
  return r ? changeRelease(ctx, org, r) : detail(404, 'The requested resource does not exist');
}

// source: spec:listOrganizationRepos "Return a list of version control repositories for a given organization."
export async function listOrganizationRepos(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'org:read');
  if (org instanceof Response) return org;
  // Where the evidence stops: a repository comes from a source-code integration (GitHub's app, installed on
  // Settings > Integrations), which the World does not run yet; an organization has none
  return Response.json(ctx.rowsRaw('repository').filter((x) => x.deleted !== true && x.organization === org.id).map((x) => wire(ctx, x)));
}

// Source maps as sentry-cli uploads them (`sourcemaps upload`, and the bundler plugins through it): the server's chunk
// options, chunks of the artifact bundle posted by their SHA-1, and the bundle assembled from them for its projects and
// release (getsentry/sentry: api/endpoints/chunk.py and organization_artifactbundle_assemble.py).

const CHUNK = '_chunk';
const BUNDLE = '_artifact_bundle';
const error = (message: string): Response => Response.json({ error: message }, { status: 400 });
// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/api/endpoints/chunk.py "MAX_CHUNKS_PER_REQUEST = 64"
const MAX_CHUNKS_PER_REQUEST = 64;
// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/api/endpoints/chunk.py "MAX_REQUEST_SIZE = 32 * 1024 * 1024"
const MAX_REQUEST_SIZE = 32 * 1024 * 1024;
// Where the documentation stops: the chunk size is the server's setting (SENTRY_CHUNK_UPLOAD_BLOB_SIZE), a power of two
// for sentry-cli 2.39 and older; the twin's is 8 MiB. The largest file is the file store's limit, 2 GiB here.
const CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/api/endpoints/chunk.py "# The `assemble` endpoint will check for missing chunks"
const ACCEPT = ['debug_files', 'release_files', 'pdbs', 'sources', 'bcsymbolmaps', 'il2cpp', 'portablepdbs', 'artifact_bundles', 'artifact_bundles_v2', 'proguard', 'preprod_artifacts', 'dartsymbolmap'];
const SHA1 = /^[0-9a-f]{40}$/;

// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/api/endpoints/chunk.py "Return chunk upload parameters"
export async function getChunkUploadOptions(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'project:releases');
  if (org instanceof Response) return org;
  // sentry-cli 2.30 and later are sent an absolute URL at the region's host (chunk.py `requires_region_url`); the
  // compression offered is gzip alone, as the server may answer a narrower list than its own (an organization with
  // compression turned off is answered none)
  return Response.json({
    url: `https://us.sentry.io/api/0/organizations/${String(org.slug)}/chunk-upload/`, chunkSize: CHUNK_SIZE, chunksPerRequest: MAX_CHUNKS_PER_REQUEST,
    maxFileSize: MAX_FILE_SIZE, maxRequestSize: MAX_REQUEST_SIZE, concurrency: 8, hashAlgorithm: 'sha1', compression: ['gzip'], accept: ACCEPT,
  });
}

// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/api/endpoints/chunk.py "files_gzip_legacy = request.FILES.getlist("
export async function uploadChunks(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'project:releases');
  if (org instanceof Response) return org;
  const encoding = (ctx.call.request.headers.get('content-encoding') ?? '').toLowerCase();
  const parts = (await ctx.parts()).filter((p) => p.name === 'file' || p.name === 'file_gzip');
  if (encoding && parts.some((p) => p.name === 'file_gzip')) return error('Cannot combine Content-Encoding with file_gzip field');
  if (encoding && encoding !== 'gzip') return error('Unsupported Content-Encoding');
  if (parts.length > MAX_CHUNKS_PER_REQUEST) return error('Too many chunks');
  let total = 0;
  for (const part of parts) {
    let data: Uint8Array;
    try { data = part.name === 'file_gzip' || encoding === 'gzip' ? await gunzip(part.body) : part.body; } catch { return error('Invalid gzip payload'); }
    if (data.length > CHUNK_SIZE) return error('Chunk size too large');
    total += data.length;
    if (total > MAX_REQUEST_SIZE) return error('Request too large');
    const checksum = ctx.crypto.digest('sha1', data, 'hex');
    // Where the documentation stops: a part is named by its checksum; one whose content has another is refused
    if (String(part.filename ?? '') !== checksum) return error(`Checksum mismatch: ${String(part.filename)}`);
    await ctx.blobs.put(`chunk/${checksum}`, data);
    await ctx.record(CHUNK, { organization: org.id, size: data.length }, `${String(org.id)}:${checksum}`);
  }
  return new Response(null, { status: 200 });
}

// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/api/endpoints/organization_artifactbundle_assemble.py "AssembleTask.ARTIFACT_BUNDLE, organization.id, checksum, ChunkFileState.CREATED"
export async function assembleArtifactBundle(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'project:releases');
  if (org instanceof Response) return org;
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  if (typeof b.checksum !== 'string' || !SHA1.test(b.checksum)) return error('The checksum field is required and must be a 40-character hexadecimal string.');
  if (!Array.isArray(b.chunks) || b.chunks.some((c) => typeof c !== 'string' || !SHA1.test(c))) return error('The chunks field is required and must be provided as an array of 40-character hexadecimal strings.');
  if (!Array.isArray(b.projects)) return error('The projects field is required and must be provided as an array of strings.');
  if (b.version !== undefined && (typeof b.version !== 'string' || !b.version || b.version.includes('/'))) return error('The version field cannot be empty and cannot contain any "/" characters.');
  if (b.projects.length === 0) return error('You need to specify at least one project');
  const projects = (b.projects as unknown[]).map((p) => projectOf(ctx, org, String(p)));
  if (projects.some((p) => !p)) return error('One or more projects are invalid');
  const held = ctx.row(BUNDLE, `${String(org.id)}:${b.checksum}`);
  if (held && held.deleted !== true) return Response.json({ state: held.state, detail: held.detail ?? null, missingChunks: [] });
  const chunks = b.chunks as string[];
  const missing = chunks.filter((c) => !ctx.row(CHUNK, `${String(org.id)}:${c}`));
  if (missing.length) return Response.json({ state: 'not_found', missingChunks: missing });
  // the bundle is assembled from its chunks in order; its checksum must be theirs together
  const pieces = await Promise.all(chunks.map((c) => ctx.blobs.get(`chunk/${c}`)));
  const whole = new Uint8Array(pieces.reduce((n, p) => n + (p?.length ?? 0), 0));
  let at = 0;
  for (const p of pieces) { if (p) { whole.set(p, at); at += p.length; } }
  const ok = ctx.crypto.digest('sha1', whole, 'hex') === b.checksum;
  if (ok) await ctx.blobs.put(`bundle/${String(org.id)}/${b.checksum}`, whole);
  // the assembly is scheduled on the first request that names every chunk (answered `created`); later requests read
  // its outcome: `ok`, or `error` with why
  await ctx.record(BUNDLE, {
    organization: org.id, checksum: b.checksum, projects: projects.map((p) => p!.id), release: b.version ?? null, dist: b.dist ?? null, size: whole.length,
    state: ok ? 'ok' : 'error', detail: ok ? null : 'Reported checksum mismatch', dateCreated: ctx.occurredAt,
  }, `${String(org.id)}:${b.checksum}`);
  return Response.json({ state: 'created', missingChunks: [] });
}

// source: spec:createOrganizationProject "Create a new project for an organization."
export async function createOrganizationProject(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'project:write');
  if (org instanceof Response) return org;
  const b = (ctx.body ?? {}) as Row;
  if (typeof b.name !== 'string' || !b.name.trim()) return Response.json({ name: ['This field is required.'] }, { status: 400 });
  const slug = typeof b.slug === 'string' ? b.slug : b.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  // source: spec:/paths/~1api~10~1organizations~1{organization_id_or_slug}~1projects~1/post/requestBody "Uniquely identifies a project and is used for the interface."
  if (!/^(?![0-9]+$)[a-z0-9_-]+$/.test(slug)) return Response.json({ slug: ['Enter a valid slug.'] }, { status: 400 });
  if (projectOf(ctx, org, slug)) return Response.json({ slug: ['A project with this slug already exists.'] }, { status: 409 });
  const project = await makeProject(ctx, org, slug, typeof b.platform === 'string' ? b.platform : null);
  if (project instanceof Response) return project;
  await ctx.write(PROJECT, String(project.id), { name: b.name }, 'project.update');
  return Response.json(projectView(ctx, ctx.row(PROJECT, String(project.id))!, org), { status: 201 });
}

// source: spec:listProjectKeys "Return a list of client keys bound to a project."
export async function listProjectKeys(ctx: HandlerContext): Promise<Response> {
  const at = projectFor(ctx, 'project:read');
  if (at instanceof Response) return at;
  const key = keyOf(ctx, at.project);
  return Response.json(key ? [wire(ctx, key)] : []);
}

// source: spec:listOrganizations "List Your Organizations"
export async function listOrganizations(ctx: HandlerContext): Promise<Response> {
  const token = bearerToken(ctx)!;
  if (!grants(token, 'org:read')) return forbidden();
  return ctx.list('organization', ctx.rowsRaw('organization').filter((o) => o.deleted !== true && o.id === token.organization).map((o) => wire(ctx, o)));
}

// source: spec:listOrganizationReleases "List an Organization's Releases"
export async function listOrganizationReleases(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'project:releases');
  if (org instanceof Response) return org;
  return ctx.list('release', ctx.rowsRaw('release').filter((r) => r.deleted !== true && r._organization === org.id).map((r) => wire(ctx, r)));
}


// source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/issues/endpoints/organization_release_previous_commits.py "raise ResourceDoesNotExist"
export async function getPreviousReleaseWithCommits(ctx: HandlerContext): Promise<Response> {
  const org = orgFor(ctx, 'project:releases');
  if (org instanceof Response) return org;
  const current = releaseOf(ctx, org, String(ctx.call.params.version));
  if (!current) return notFound();
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/issues/endpoints/organization_release_previous_commits.py "start_date = release.date_released or release.date_added"
  const start = String(current.dateReleased ?? current.dateCreated);
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/issues/endpoints/organization_release_previous_commits.py "projects__id__in=project_ids"
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/issues/endpoints/organization_release_previous_commits.py "last_commit_id__isnull=False"
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/issues/endpoints/organization_release_previous_commits.py "COALESCE(date_released, date_added) <= %s"
  const candidates = ctx.rowsRaw('release').filter((r) => r.deleted !== true && r._organization === org.id && r.lastCommit != null
    && (r._projects as string[]).some((id) => (current._projects as string[]).includes(id)) && String(r.dateReleased ?? r.dateCreated) <= start);
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/issues/endpoints/organization_release_previous_commits.py "order_by"
  const previous = candidates.sort((a, b) => String(b.dateReleased ?? b.dateCreated).localeCompare(String(a.dateReleased ?? a.dateCreated)))[0];
  // source: https://raw.githubusercontent.com/getsentry/sentry/2efdd4760a75a3d395e3534b7f66a7fbb0c3f22e/src/sentry/issues/endpoints/organization_release_previous_commits.py "return Response({})"
  return Response.json(previous ? wire(ctx, previous) : {});
}
