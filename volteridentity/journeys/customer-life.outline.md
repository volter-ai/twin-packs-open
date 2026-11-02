# Volter Identity customer life

Author: Contributor 91. The World starts on 1 January 2026.

Volter operates one identity service for its products. Priya Shah owns Orbit Apps, and Kenji Mori is her engineer.
The operator holds a signed-in Volter browser session and the separately issued service admin token. Product servers
hold their own confidential client ids and secrets, use PKCE when signing a person in, and verify the issuer before
reading userinfo. Twin alone has the organizations grant for the identity service. Its server manages the product's
organizations on behalf of its people; Priya's personal token grants no server administration.

On Monday 5 January the operator registers Twin, Open Autonomy, RH2 and Substrate. Each first-party client skips
consent. The gateway is linked to its own resource. The Volter Harness uses the shared public client published in
@volter/identity: the operator cannot ask the registration API to choose that id, so its World door installs it, and
the operator links it to Orbit Apps' Teams server. The operator and admin setting use World doors. The World also holds Volter's GitHub OAuth app and Google console client, configured through the identity provider door; GitHub and Google run as companion twins. Kenji has a GitHub account and Priya a Google account. Kenji initially declines sharing email until he checks the requested scopes, reads the error page, then signs in with GitHub; its callback creates his linked identity. Their identities are not preloaded with provider claims. Provider calls are the hosted UI's worker/ui/identity.ts:126 at daa98e9.

On Tuesday 6 January Priya signs in to Twin. Discovery sends the platform to authorize, then to the login page. Priya selects Google, chooses her account and returns through the Google callback; the identity service creates her identity from the provider's verified token.
The platform exchanges her code with its secret and verifier, and userinfo gives it her name and email. It gets its
own organizations token and finds her by email. Priya creates Orbit Apps as its owner, adds Kenji and promotes him to
admin. Kenji opens the organization dashboard and members list, which he did not create. Priya invites Lena; the
platform shows her the pending invitations so she can manage outstanding invitations.

On Thursday 8 January Lena has accepted a role elsewhere. The platform renews its expired server token, cancels her
invitation, and shows Priya that none remain pending. Priya changes the business name. The platform reads Kenji's
organizations for his organization selector and his profile for the selected membership.

On Friday 9 January Kenji signs Volter Harness in on his laptop. Its public client opens authorize with PKCE and a
loopback callback on a port the operating system picked. Kenji signs in through his existing GitHub session; the client exchanges its code with its
verifier, userinfo identifies him, and the Teams server reads the signing keys. At 11:00 the token expires, so the
client refreshes for Orbit Apps' Teams server using the resource the operator linked to it.

On Saturday 10 January Kenji configures a build machine without a browser. The client requests a device code,
receives authorization_pending while Kenji opens the returned verification link on another device, and gets tokens
after he approves. The server polls on the documented interval rather than spinning.

On Monday 12 January Priya opens a Substrate share of Kenji's work. Her existing session answers the page's
PKCE request. The gateway exchanges the code for its own audience and verifies the issuer's keys. After an hour of
work it refreshes. Later Priya follows a shared app's visitor link: the distinct visitor callback exchanges the code
and reads her name and email for the app.

On Tuesday 13 January Kenji gives to a project on Open Autonomy. The giving page reads discovery and uses his still
current identity-service session. It exchanges the PKCE code with its secret. The verified ID token's linked GitHub
account names the funder (apps/platform/src/give-auth.ts:95); the platform reads GitHub's current login by that numeric id with its own credential (:103), and asserts it is Kenji; email and name remain userinfo's fields.

On Wednesday 14 January Priya signs in to RH2's console as a different user. prompt=login asks her to sign in again through Google,
then the console trades the code and reads the keys and userinfo. In the afternoon its desktop widget requests a
device code using its confidential client. Priya chooses Apple's Hide My Email for her native account, as
[Apple documents](https://support.apple.com/en-us/102609); the relay address is distinct from her Google work address.
Her iOS app sends Apple's ID token, nonce and first-sign-in name as apps/rh2-mobile/apple.ts:41 does.
The World runs no Apple twin, so `ctx.vendorFetch` refuses `appleid.apple.com/auth/keys`. Better Auth's
provider verifier catches that failure and returns false (`@better-auth/core@1.7.5:dist/oauth2/verify-id-token.mjs`);
its social sign-in answers 401 `INVALID_TOKEN` (`better-auth@1.7.5:dist/api/routes/sign-in.mjs:159-161`). The
app throws at :46 and never claims or approves the widget's code (:49,:51); no browser fallback is assumed.
The verified-token sign-in path is recorded as vendor-backed: only a World backed by the real Apple reaches it.

On Monday 2 February Kenji leaves. Twin renews its expired organizations token before removing him. His organization
selector is now empty. Priya then opens a separate Spring Pilot organization for a proposed client project: its
access must stay apart from the ongoing Orbit Apps team until the client decides whether to proceed. She is its
owner; Kenji, who has left, is not added. On Monday 2 March the client declines the pilot. The platform renews its
organizations token and Priya deletes that second organization. Orbit Apps Inc. and Priya's ownership remain for
the team's ongoing account.

Published rules replay documented client authentication and native redirect metadata without contrived customer mistakes. A consent-dependent authorization is a separate flow none of these first-party products requests; it remains outside the served set. Provider/error branches no real call or published replay reaches remain missing. Introspection, revocation, end-session, POST userinfo and Better Auth's organization UI are outside the demand recorded in demand.json.

Twin reads its organization with the same signed resource token, and the platform reads the same Google-linked person's userinfo through the World's 127.0.0.1 and localhost aliases; a route does not change the issuer or invalidate the token.

Open Autonomy also runs a local identity installation in its World: its operator sets the permanent `ISSUER` before client registration. Discovery names that installation's configured issuer and token endpoint even through localhost or the vendor host (`openidConfiguration`), as `auth-source.txt:70-74` configures `ISSUER`.

The shared-client laptop/device act also reaches the issuer's existing zero-grace reuse rule:
replaying a retained rotated predecessor invalidates only that client's person family; its successor
and the person's second shared-client device grant refuse. Kenji then approves an ordinary new device
code and refreshes its genuinely issued grant for the linked Teams resource. The new device flow restores eventual usability; it introduces no restore endpoint and models no bounded response replay.
