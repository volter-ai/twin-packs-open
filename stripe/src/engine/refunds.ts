// The published refund reasons; expired_uncaptured_charge is Stripe's own, not a request reason.
// source: spec:/paths/~1v1~1refunds/post/requestBody/content/application~1x-www-form-urlencoded/schema/properties/reason "String indicating the reason for the refund."
export const REFUND_REASONS = new Set(['duplicate', 'fraudulent', 'requested_by_customer']);
