// Twitch's state machines and state rulings (docs/contributing/architecture.md, "State"), for the Helix API's resources.
// The authentication service's (a token's, an authorization code's) are its lane's (../../id/src/semantics/states.ts).
//
// A stream has no state field: it is present while its channel is live and gone once it is offline (Get Streams
// "Returns only the streams of those users that are broadcasting"), made and removed by the broadcast's own start and
// end (./live.ts). Twitch moves a stream that the twin does not: a stream Twitch ends itself (a terms-of-service
// enforcement) is the vendor's, not modelled.
export const states = {
  GetChannelInformationResponseData: {
    // whether the channel carries branded content is a setting the broadcaster declares, not a lifecycle
    notState: ['is_branded_content'],
  },
  GetStreamsResponseData: {
    // whether the stream is for mature audiences is a property of the broadcast, set by the broadcaster, not a lifecycle
    notState: ['is_mature'],
  },
};
