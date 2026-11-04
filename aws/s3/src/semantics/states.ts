// S3's state machines, as data (architecture, "The states"). A bucket, an object, an upload and a part have no state the
// lane moves: an object stands until it is deleted; an upload is in progress until CompleteMultipartUpload or
// AbortMultipartUpload ends it, and then it is gone (ListMultipartUploads lists only uploads in progress), so its life is
// its presence, not a field. Versioning, Object Lock, restores and lifecycle transitions, which would move a field, are
// operations the lane does not serve (the manifest's `unmodeled`).
export const states = {
  // a storage class is chosen at the write (x-amz-storage-class); moving an object between classes is a lifecycle rule or
  // a CopyObject write; it is an attribute of that write, not a state machine; a checksum's algorithm and type are the write's, never moved
  Object: { notState: ['StorageClass', 'ChecksumAlgorithm', 'ChecksumType'] },
  // an upload's storage class and checksum algorithm are named when it begins and kept until it ends
  Upload: { notState: ['StorageClass', 'ChecksumAlgorithm', 'ChecksumType'] },
};
