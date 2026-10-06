// R2 expiry, storage-class transitions and external-domain validation are vendor moves over the World clock.
import type { HandlerContext } from '@volter/world-core';
import { ofBucket, BUCKET, OBJECT, UPLOAD, DOMAIN, PART, s3, domainManifest, type Row, lifecycleDue } from './shared.ts';

export async function clock(ctx: HandlerContext): Promise<void> {
  const now = Date.parse(ctx.occurredAt);
  for (const bucket of ctx.rowsRaw(BUCKET)) {
    const rules = (bucket.lifecycle ?? []) as s3.LifecycleRule[];
    for (const object of ctx.rowsRaw(OBJECT).filter(row => ofBucket(ctx, row._bucket, bucket))) {
      const created = Date.parse(String(object.LastModified));
      const applied = rules.filter(rule => rule.enabled && String(object.Key).startsWith(rule.prefix));
      const expirations = applied.flatMap(rule => rule.expireDate ? [Date.parse(rule.expireDate)] : rule.expireDays !== undefined ? [lifecycleDue(created, rule.expireDays)] : []);
      const expires = Math.min(...expirations);
      if (expires <= now) { await (await ctx.at(new Date(expires).toISOString())).remove(OBJECT, String(object.id), 'r2.lifecycle.expire'); continue; }
      const transitions = applied.flatMap(rule => (rule.transitions ?? []).map(move => ({ due: move.date ? Date.parse(move.date) : lifecycleDue(created, move.days), storageClass: move.storageClass })))
        .filter(move => Number.isFinite(move.due) && move.due <= now).sort((a, b) => a.due - b.due);
      const transition = transitions.at(-1);
      if (transition && object.StorageClass !== transition.storageClass) await (await ctx.at(new Date(transition.due).toISOString())).write(OBJECT, String(object.id), { StorageClass: transition.storageClass }, 'r2.lifecycle.transition');
    }
    for (const upload of ctx.rowsRaw(UPLOAD).filter(row => ofBucket(ctx, row._bucket, bucket))) {
      const aborts = rules.filter(rule => rule.enabled && rule.abortMultipartDays !== undefined && String(upload.Key).startsWith(rule.prefix))
        .map(rule => lifecycleDue(Date.parse(String(upload.Initiated)), rule.abortMultipartDays));
      const due = Math.min(...aborts); if (due > now) continue;
      const at = await ctx.at(new Date(due).toISOString());
      for (const part of ctx.rowsRaw(PART).filter(row => row._upload === upload.id)) await at.remove(PART, String(part.id), 'r2.lifecycle.abort');
      await at.remove(UPLOAD, String(upload.id), 'r2.lifecycle.abort');
    }
  }
  const domains = await ctx.over(domainManifest);
  for (const domain of domains.rowsRaw(DOMAIN)) {
    // source: https://developers.cloudflare.com/r2/buckets/public-buckets/ "Active"
    // No elapsed-time assumption supplies DNS: only the separately published external record is proof.
    const proof = ctx.rowsRaw('_external_dns').find(row => row.name === domain.domain && row.value === domain._target);
    if (!proof) continue;
    const status = domain.status as Row;
    const next = { ...status };
    for (const field of ['ownership', 'ssl']) if (next[field] !== 'active') {
      const refusal = domains.legal('CustomDomain', `status.${field}`, 'clock', next[field], 'active', String(domain.id), 'vendor');
      if (refusal) throw new Error('Declared R2 domain transition refused a verified external proof');
      next[field] = 'active';
    }
    if (next.ownership !== status.ownership || next.ssl !== status.ssl) await domains.write(DOMAIN, String(domain.id), { status: next }, 'r2.domain.validate');
  }
}
