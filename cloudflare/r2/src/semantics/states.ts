// R2 state decisions, written from the current compatibility table and public-domain schemas.

export const states = {
  // Bucket presence, its jurisdiction/location and configured storage class are values, not lifecycle states.
  Bucket: { notState: ['LocationConstraint', 'storage_class', 'jurisdiction'] },
  // R2 has no versioning, object-lock or ACL state. Storage class changes are a lifecycle action over a value.
  Object: { notState: ['StorageClass', 'storage_class'] },
  // Multipart completion/abort deletes the upload's live subject; it is not an invented public status field.
  Multipart: { notState: ['StorageClass'] },
};
