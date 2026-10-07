# Trellis's sign-in with Clerk: the outline

**Author.** codex-clerk-coverage.

**Frame.** Trellis is a four-person product in Lisbon: design agencies use it to collect their clients' feedback
on screens. Every agency is a Clerk organization; its people sign in to trellis.app with an email code. Trellis's web app uses Clerk's prebuilt sign-in and sign-up and selects organizations through the app; its API server
(Node, the official `@clerk/backend`) keeps each agency's organization, members, roles and invitations in step
with the app, and verifies every request's session token locally with the instance's public keys. Its realtime
board runs on Convex, which reads a session token minted from a `convex` template. The World clock starts
2026-01-05; the life spans the year of one production instance, from launch to the day the first agency leaves.

**People, programs and their credentials.** Each act is made with the credential named here, and each
credential's grant covers the acts made with it (a secret key reads and writes everything in its instance; a
signed-in person acts for themself, and in an organization only as far as their role's permissions go).

- Inês, the founder and developer: the Clerk dashboard, where she made the application and its production
  instance, and the instance's first secret key.
- The API server: its own secret key, made by Inês in the dashboard for the server.
- The metrics script Inês runs from her laptop on the first Monday of the month: a second secret key, kept on
  her laptop only.
- The webhook receiver, an endpoint of the API server that Clerk posts events to (through Svix), verifying each
  delivery with the endpoint's signing secret.
- The agencies' people, each in their own browser on trellis.app through Clerk's Frontend API and the
  publishable key: Marta (runs Oak & Ash, a Porto agency), Rui and Beatriz (her designers), and Daniel (runs
  Northlight, a Madrid agency, from March).

1. **January: the instance.** Inês first previews the empty development instance: Clerk establishes a development browser, reports her localhost origin and serves its frontend verification keys.  Inês makes the application and selects its production environment in the dashboard (password and email code sign-in,
   organizations on with the B2B add-on Trellis pays for, and sign-up asking people to accept Trellis's terms) and
   the API server's key. With that key the server's setup script declares Trellis's
   permissions (manage projects, edit projects, request reviews, manage billing) and two roles beside Clerk's
   admin: contributor (edit projects, request reviews) and viewer (none), both in the instance's initial role set so
   an agency can assign them, and gives admin all four. Trellis keeps its
   Clerk setup in that script under version control, so with her own key Inês's part of it makes the `convex` JWT
   template (audience `convex`, and the active agency's plan from its public metadata as a claim), and in the dashboard she points the webhook endpoint for `user.deleted` at the receiver. The API server boots and fetches the instance's public keys. Inês registers the account worker as a public OAuth application with PKCE required, a registered callback and explicit consent, through `CreateOAuthApplication`; the setup reads it back (`GetOAuthApplication`).
2. **January: the first agency.** Marta's browser establishes its client. She signs up with her work email and a password; called away, she returns after her first code expired, requests a fresh one and corrects a mistyped code. Clerk completes her signup. Her browser reloads its client. Trellis's API nonce handshake returns the app-domain cookies, exchanged once by the server, and the account worker uses its SDK's default signed handshake before Editor authorization. Trellis's
   onboarding asks for her agency's name; the API server creates the "Oak & Ash" organization with Marta as its
   creator, so she is its admin, and records the agency's plan (`trial`) in its public metadata, and marks Marta's
   onboarding done in her own public metadata so the app skips its tour. Marta's
   browser switches to the organization; her board connects to Convex with a `convex` token.
2b. **January: Marta opens Volter Editor.** The account worker sends its real authorize request through the Clerk frontend proxy, with its own provider state, S256 challenge and `openid profile email user:org:read` scopes. Clerk directs the signed-out request to sign-in; the page loads the pinned clerk-js browser bundle through that proxy and the life fetches its bytes. Her signed-in browser continues to Clerk's consent screen, selects Oak & Ash and grants access (`submitOAuthConsent`). Clerk returns a code, the unchanged state and issuer to the registered worker callback. The worker exchanges the code with its original verifier at `clerk.auth.videogame.ai/oauth/token` (`getOAuthToken`), receiving signed access and ID tokens and a refresh token. When she reopens Editor in February, the worker refreshes the grant with that token; its identity and organization persist after the browser session has expired. The editor's shipped client-id mismatch is recorded in demand; this act walks the accepted worker-to-Clerk calls.
3. **February: the team.** Marta invites Rui and Beatriz as contributors from Trellis's settings; the API
   server creates both invitations with Trellis's accept page as the redirect. She typed Beatriz's address
   wrong: she sees it in the pending list, revokes it and invites the right address. Rui and Beatriz each open
   the link in their invitation email and sign up through it (their names, and Trellis's terms accepted); each
   lands in Oak & Ash. Rui messages Marta that he cannot find his invitation;
   he then finds it in his promotions folder and joins, but before Marta sees that she clicks Resend on it in
   Trellis's settings. Clerk has no resend for an organization invitation, so Trellis resends by revoking the invitation
   and inviting again; Clerk refuses the revoke, since the invitation is already accepted, and Trellis shows Rui as a
   member.
4. **March: a second agency, and a request refused by Trellis's rules.** Daniel resumes a signup after closing its tab, corrects his displayed name, verifies his email and then supplies the missing password and accepts the terms. Rui signs in on a new device with his password after correcting a typo; an earlier email-code form submitted after completion is already verified. Daniel creates
   "Northlight" the same way. In Oak & Ash, Rui asks to change the agency's billing; the API server reads his
   memberships, finds his role holds no billing permission, and Trellis refuses him. In mid-March Marta makes
   Beatriz an admin from Trellis's settings, through the API server, so she can manage billing while Marta is away.
5. **April: Oak & Ash subscribes.** Oak & Ash pays for the team plan (Trellis bills through its payment
   provider); the API server merges `plan: team` into the organization's public metadata, so its members'
   next `convex` tokens carry it: Beatriz's board, reopened that afternoon, reads the team plan. That evening
   Beatriz leaves her laptop on the train. She signs in to Trellis on her phone's browser with an emailed code, and
   Trellis's security page there, through the API server, lists her two sessions, the phone's and the laptop's; she
   signs the laptop's out. Her phone SDK reloads its session and obtains its standard API bearer token. The next morning an old security tab offers the same laptop from its stale list; Clerk refuses the second revocation.
5b. **May: settings.** The setup script gives the viewer role "request reviews"; boards reconnected every minute as
   their tokens ran out, so Inês's part of the script sends the `convex` template again, whole, with an hour's lifetime; Beatriz,
   married in April, has her last name changed through Trellis's profile page and the API server.
6. **Each month from February: the metrics script.** On the first Monday Inês's script takes from Trellis's database
   the emails of the agency admins who signed up the month before, looks each up in Clerk, and reads their sessions
   to count the devices they came back on, and counts everyone who signed up that month; the life shows February's
   run (Marta; it also lists the agencies with their sizes) and April's (Daniel).
7. **June: a designer leaves.** Rui leaves Oak & Ash; Beatriz removes him from the organization in Trellis's settings, through the
   API server. Between agencies he helps Northlight and Daniel adds him there. In July he asks
   Trellis to delete his account; the API server deletes his user, his remaining Northlight membership is removed, Clerk posts `user.deleted`, and the receiver
   removes his comments' author name from Trellis's records.
8. **September: Oak & Ash grows.** The agency renames itself "Oak & Ash Studio" and its plan now allows ten
   members; the API server updates the organization's name and its membership limit. Its new IT lead wants its
   people to sign in with their Okta: the API server makes an enterprise connection (SAML, Okta) for the agency's
   domain, and turns it on once the IT lead has pasted Okta's details (issuer, sign-on URL, signing certificate) into
   Trellis's SSO settings.
8b. **Late September and October: the iPhone app.** Before the app ships, Inês enables the Native API on the
   dashboard's Native applications page, as Clerk requires of a native app, and registers the iPhone app there (its
   App ID prefix and bundle ID). In October Trellis ships it and emails each agency's people a link that opens it
   signed in: the native SDK first establishes its client; for Beatriz's link the API server makes a sign-in token that opens Oak & Ash Studio; the app, a native
   client, signs her in with it (its requests carry `_is_native=true` and the client token Clerk hands it in the
   Authorization header, not a cookie), and her board in the app connects to Convex with a `convex` token.
9. **November: Northlight leaves.** Daniel tells Trellis Northlight is closing. The API server deletes the
   Northlight organization, and Daniel, who has no other agency, asks Trellis to delete his account; the API
   server deletes his user, and the receiver removes his records.

**Documented settings and read-backs in those acts.** In February the settings script selects admin as creator and contributors as domain enrollment default. Trellis renames contributors to designers while their invitations are pending; the default and invitations follow that key, and the members page offers the documented sort choices. Marta reads the typoed invitation individually before revoking it. Her account worker also shares a board with an outside reviewer using its one-day application invitation; unread, it is expired at February's read-back. The monthly export uses creation cursors and signed user/agency filters as well as email/name ordering. September enables agency URL slugs before Oak & Ash chooses oak-ash-studio. The IT lead hosts the exported Okta metadata in Trellis: an unavailable upload server and an incomplete certificate export are refused before the full file activates the connection. The application's life replies stand only for those hosted files. The prerelease iPhone SDK is refused before the Native API is enabled. Rui's old board asks for an Oak & Ash token after he leaves and is refused. Daniel's progressive form update uses clerk-js's documented POST method tunnel.

**Identity options and recovery.** The anonymous API handshake clears stale cookies before Marta signs up; her account header loads the exact image URL Clerk returns. She shares the board with two outside reviewers, and the administrative invitation script refuses its duplicate without the force flag. Both one-day links expire unread. The typoed organization recipient follows a link after revocation and is refused. Rui first chooses signup on his new device and is told the existing email is taken. April’s four-person CSV asserts alphabetical and creation ordering. Beatriz delays the lost-device phone code past expiry, requests another and corrects a typo. After revoking the laptop she resets her password, correcting short and email-identical entries, and the saved password ends the remaining active phone session. In May her profile adopts her married username, retains its verified primary address. Inês’s existing JWT setup also registers a shared-key reports audience, used when Marta opens the private report.

**Editor’s Google guest.** In October Nuno follows Marta’s Editor shared-session link, whose shipped landing page offers Google or email (Editor share-session-gateway.ts:590). He declines Google consent once, then lets another attempt expire while interrupted, and finally chooses his Google account. Clerk exchanges the provider’s code with the Google OAuth companion and the callback transfers his verified identity into signup; he accepts the terms. On the shared laptop he signs out through SignIn’s account chooser. Reopening the link, he signs into the same account with Google again.
