// Pure rendering of the incoming message the World supplies: body alternatives and attachment bytes.
// source: https://resend.com/docs/api-reference/emails/retrieve-received-email "download_url"
type Row = Record<string, unknown>;
export function rawMessage(headers: Row, text: string | null, html: string | null, files: Array<{ metadata: Row; bytes: Uint8Array }>, boundary: string): string {
  const part = (type: string, value: string): string => `content-type: ${type}; charset=utf-8\r\n\r\n${value}`;
  const alternative = `${boundary}-alternative`;
  const body = text !== null && html !== null
    ? `content-type: multipart/alternative; boundary="${alternative}"\r\n\r\n--${alternative}\r\n${part('text/plain', text)}\r\n--${alternative}\r\n${part('text/html', html)}\r\n--${alternative}--`
    : part(html !== null ? 'text/html' : 'text/plain', html ?? text ?? '');
  const mixed = files.length ? `content-type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\n${body}\r\n${files.map(({ metadata: m, bytes }) => `--${boundary}\r\ncontent-type: ${String(m.content_type)}\r\ncontent-disposition: ${String(m.content_disposition)}; filename="${String(m.filename).replace(/["\r\n]/g, '')}"\r\n${m.content_id ? `content-id: <${String(m.content_id)}>\r\n` : ''}content-transfer-encoding: base64\r\n\r\n${Buffer.from(bytes).toString('base64')}`).join('\r\n')}\r\n--${boundary}--` : body;
  return `${Object.entries(headers).map(([k, v]) => `${k}: ${String(v)}`).join('\r\n')}\r\n${mixed}`;
}
