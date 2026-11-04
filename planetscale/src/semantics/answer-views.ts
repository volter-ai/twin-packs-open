// psdb's answer as its client reads it (architecture, "Pack layout": answer-views.ts). A result's rows are wire-encoded:
// each row `{ lengths, values }`, its cells' bytes concatenated and base64'd, sliced by each cell's length (-1 a NULL).
// The `rows` view is the answer with `rows` the decoded cells, as @planetscale/database 1.19.0 decodes them (decodeRow):
// a binary column's cell (charset 63) its bytes, any other's its UTF-8 text (the cast's decodeUtf8), and no number cast,
// so a step reads each cell as the text MySQL sent. rowsAffected is decoded to its numeric value,
// defaulting to zero whether or not the proto serializer emitted a zero field.
// source: https://raw.githubusercontent.com/planetscale/database-js/v1.19.0/src/index.ts "const rowsAffected = result?.rowsAffected ? parseInt(result.rowsAffected, 10) : 0"
// source: https://raw.githubusercontent.com/planetscale/database-js/v1.19.0/src/index.ts "if (width < 0) return null"
// source: https://raw.githubusercontent.com/planetscale/database-js/v1.19.0/src/index.ts "values.substring(offset, offset + width)"
// source: https://raw.githubusercontent.com/planetscale/database-js/v1.19.0/src/cast.ts "const BinaryId = 63"
// source: https://raw.githubusercontent.com/planetscale/database-js/v1.19.0/src/cast.ts "return decodeUtf8(value)"

type Wire = { session?: unknown; result?: { rowsAffected?: string | null; fields?: Array<{ charset?: number }>; rows?: Array<{ lengths?: string[]; values?: string }> }; error?: unknown };

export const answerViews: Record<string, (body: unknown) => unknown> = {
  rows: (body) => {
    const b = (body ?? {}) as Wire;
    const fields = b.result?.fields ?? [];
    const rows = (b.result?.rows ?? []).map((row) => {
      const bytes = Buffer.from(row.values ?? '', 'base64');
      let offset = 0;
      return (row.lengths ?? []).map((size, i) => {
        const width = Number.parseInt(size, 10);
        if (width < 0) return null;
        const cell = bytes.subarray(offset, offset + width);
        offset += width;
        return cell.toString(fields[i]?.charset === 63 ? 'latin1' : 'utf8');
      });
    });
    return { ...b, rows, rowsAffected: b.result?.rowsAffected ? Number.parseInt(b.result.rowsAffected, 10) : 0 };
  },
};
