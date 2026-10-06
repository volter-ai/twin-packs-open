// A hosted page is read as its rendered text, after HTML character references are decoded.
const select = (row: Record<string, unknown>, fields: string[]): Record<string, unknown> => Object.fromEntries(fields.filter((field) => field in row).map((field) => [field, row[field]]));
export const answerViews = {
  base64: (body: unknown) => ({ ...(body as Record<string, unknown>), content: String((body as Record<string, unknown>).content).replace(/\s/g, '') }),
  changes: (body: unknown) => ({ ...(body as Record<string, unknown>), files: ((body as { files: Record<string, unknown>[] }).files).map((file) => select(file, ['filename', 'status', 'additions', 'deletions', 'changes'])) }),
  tree: (body: unknown) => ({ ...(body as Record<string, unknown>), tree: ((body as { tree: Record<string, unknown>[] }).tree).map((entry) => select(entry, ['path', 'mode', 'type', 'size'])) }),
  policies: (body: unknown) => ({ ...(body as Record<string, unknown>), branch_policies: ((body as { branch_policies: Record<string, unknown>[] }).branch_policies).map((entry) => select(entry, ['name', 'type'])) }),
  text: (body: unknown): string => String(body).replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|lt|gt|quot|apos);/gi, (_whole: string, number: string | undefined, name: string | undefined) => number ? String.fromCodePoint(number.charAt(0).toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number)) : (({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name!.toLowerCase()] ?? _whole)),
};
