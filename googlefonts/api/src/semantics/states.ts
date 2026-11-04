// The catalog and its immutable representations have no status transition.
// Keys are issued once and stored as hashes; this scope has no key revocation API.
export const states = {
  webfont: { notState: ['family', 'variants', 'subsets', 'category', 'version', 'lastModified'] },
  _api_key: { notState: ['sha256'] },
};
