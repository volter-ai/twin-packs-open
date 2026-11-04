// The catalog and its immutable representations have no status transition.
// Keys are issued once and stored as hashes; this scope has no key revocation API.
export const states = {};
export const notState = { webfont: ['family', 'variants', 'subsets', 'category', 'version', 'lastModified'],
  _api_key: ['sha256'], _font_catalog: ['families'], _stylesheet: ['family', 'subset', 'query', 'userAgent', 'blob'], _font_file: ['url', 'contentType', 'blob'] };
