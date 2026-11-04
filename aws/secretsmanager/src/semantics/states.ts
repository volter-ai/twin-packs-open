// Secrets Manager's state machines, as data. A secret is live, or scheduled for deletion (DeletedDate stamped) until its
// recovery window ends; restoring it removes the stamp. Anything but restoring or describing a scheduled secret is refused.
// Rotation is on once RotateSecret configures it and off once CancelRotateSecret turns it off.
import type { Transition } from '@volter/world-core';

const SM = '/shapes/com.amazonaws.secretsmanager#';
const doc = (shape: string, quote: string): string => `spec:${SM}${shape}/traits/smithy.api#documentation "${quote}"`;
const invalidRequest = (message: string) => ({ status: 400, code: 'InvalidRequestException', message });

const scheduled: Transition[] = [
  {
    operation: 'DeleteSecret', from: ['live'], to: 'scheduled',
    refusal: invalidRequest("You can't perform this operation on the secret because it was already scheduled for deletion."),
    source: doc('DeleteSecret', 'You can specify a recovery window during which you can restore the secret'),
  },
  { operation: 'RestoreSecret', from: ['scheduled'], to: 'live', source: doc('RestoreSecret', 'Cancels the scheduled deletion of a secret by removing the') },
  // a scheduled secret is refused; a live read or value write does not move DeletedDate
  { operation: 'PutSecretValue', from: ['scheduled'], refusal: invalidRequest("You can't perform this operation on the secret because it was marked for deletion."), source: doc('InvalidRequestException', 'The secret is scheduled for deletion.') },
  // a scheduled secret is refused; a live read or value write does not move DeletedDate
  { operation: 'GetSecretValue', from: ['scheduled'], refusal: invalidRequest("You can't perform this operation on the secret because it was marked for deletion."), source: doc('InvalidRequestException', 'The secret is scheduled for deletion.') },
  // a scheduled secret is refused; a live read or value write does not move DeletedDate
  { operation: 'UpdateSecret', from: ['scheduled'], refusal: invalidRequest("You can't perform this operation on the secret because it was marked for deletion."), source: doc('InvalidRequestException', 'The secret is scheduled for deletion.') },
];

const rotation: Transition[] = [
  { operation: 'RotateSecret', from: '*', to: 'true', source: doc('RotateSecret', 'Configures and starts the asynchronous process of rotating the secret') },
  { operation: 'CancelRotateSecret', from: '*', to: 'false', source: doc('CancelRotateSecret', 'Turns off automatic rotation') },
];

export const states = {
  Secret: {
    state: {
      DeletedDate: { initial: 'live', derive: [{ state: 'scheduled', when: { truthy: true } }], transitions: scheduled },
      RotationEnabled: { initial: false, transitions: rotation },
    },
  },
};
