# A shared Harness demo

Ada runs Harness on her laptop. Her relay account's token grants her connector
the right to register her demo tunnel. Bob first visits its public URL without a
relay credential: Ada deliberately shares an unauthenticated remote-access demo.
Later Bob creates his own account, whose token can register his own tunnel but
cannot take Ada's reserved name. The story takes place in one sitting; it uses
neither metered quotas nor a credential with a limited grant.

1. Ada signs up and gives Harness the account token she was shown. Harness
   connects its named tunnel and shares the visitor URL returned by the relay.
2. Bob mistypes the tunnel name from Ada's invitation and cannot reach a
   connector there. He follows the actual shared URL to correct the mistake. Harness receives the page request and answers it with
   the page from Ada's local server. Bob's remote viewer asks permission to send its command headers and runs a demo command;
   Harness streams progress and completion, and Bob receives the complete output.
3. While setting up a second Harness connector for the demo, Ada first uses a
   separate diagnostic client speaking the relay's documented control protocol.
   It registers the existing name without requesting replacement and is refused.
   She then starts the actual Harness connector, whose SDK requests replacement
   automatically; the previous connector closes, the URL stays stable, and Bob
   checks that the restarted local server answers.
4. Bob creates his own relay account. He copied Ada's tunnel name and discovers
   that his account cannot claim it. He corrects the name but pastes an incomplete
   token. After that is rejected, he reconnects using the token actually returned
   by his account and receives his own demo URL.
5. Bob requests a final command just as Ada closes the connector at the end of
   the demonstration. The pending command reports the disconnect. Bob uses the local relay's direct
   addressing diagnostic to check his separate connector still answers, then
   closes his own connector.

The account act uses the World account door. Registration and reconnection use
the control socket. A visitor's request is started while the local client answers
its control frame, then its completed HTTP response is checked. Both buffered
and streamed replies therefore occur in the executable story.
