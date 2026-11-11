// The api lane's state rulings (architecture, "State"): what looks like a state and is not.
export const states = {
  // source: spec:events_list "Filter list by event. For example `user sign up` or `$pageview`."
  // An event's name classifies what was captured; nothing moves it.
  event: { notState: ['event'] },
  // source: https://posthog.com/docs/product-analytics/identify "merges the anonymous person into the identified person"
  // Whether a person is identified is set by the identify and alias merges that link its distinct ids; no operation
  // moves it back, and the merge decides it, not a lifecycle.
  person: { notState: ['is_identified'] },
};
