# twitch customer life: outline

Author: the twitch twin builder.

## The customer

**Aaron** streams on Twitch as **aaronvolter**. His streamer is not him: it is **Raiku**, an AI VTuber whose rig runs on
his desktop (agent-stream, ../journeys/demand.json): OBS sends the broadcast to Twitch's RTMP ingest with the channel's
stream key, and Raiku's ears read the channel's chat anonymously over Twitch's IRC on WebSocket, as a logged-out viewer
does, so Raiku can answer it on stream. Before Raiku goes live for real, Aaron rehearses whole streams against the twin
instead of Twitch: the broadcast, its chat, and the pages people see it on. The rehearsal's audience is a program of
his, the **simulated viewers**, which chats as each viewer's own account through the API once that viewer has
authorized it on Twitch.

The World clock starts Thursday 1 January 2026, 00:00 UTC. The life spans that day and the next morning: setup in the
early hours, the rehearsal stream from 18:00 to about 22:30 UTC, the sessions ended at 22:45, and a last read the next
morning.

OBS's broadcast is the encoder's act over RTMP, which no journey step speaks yet (the walk has no RTMP client). The life
walks every other act; where the story has OBS start and stop the stream, the walk sees the channel as it is without a
publish, offline, and its pages' player waits for the broadcast.

## People and programs

| who | holds | how |
|---|---|---|
| Aaron, the streamer | aaronvolter's password (aaron@volter.ai), from which his twitch.tv session comes; the developer console | www.twitch.tv's sign-in, the creator dashboard's stream manager and stream settings, the channel page |
| the rig's setup script | the app's client id and secret (the developer console's "Raiku Rig"), and the app access token it gets with them | the client credentials grant, Get Users, Get Channel Information, Get Streams |
| OBS on the rig | the channel's stream key, copied from the dashboard into stream-key.txt | RTMP to rtmp://live.twitch.tv/app/<stream key> |
| Raiku's ears (chat.js) | nothing: an anonymous justinfan login | IRC over WebSocket at irc-ws.chat.twitch.tv |
| the simulated viewers | the same app's client id and secret, and each viewer's access and refresh token after they authorize it (scope user:write:chat) | the authorization code grant, validate, refresh and revoke on id.twitch.tv; Get Users and Send Chat Message on api.twitch.tv |
| Mina, a viewer | pixelpilgrim's password (mina@pixelpilgrim.example) | id.twitch.tv's authorize page |
| Lena, a viewer | lurkerlena's password (lena@lurkerlena.example) | id.twitch.tv's authorize page, the channel page's chat popout |
| a visitor | no account | the channel page |
| the audience | how many people are watching | the World's audience door |

The accounts, the app and the audience's size are made through the World's doors: Twitch's sign-up page, its developer
console and its viewers are not part of its API.

## The arc

### 1. Setting up (Thu 1 Jan, 00:00)
Aaron signs up as aaronvolter and registers "Raiku Rig" in the developer console with the redirect URL
http://localhost:3000, a confidential client: the console shows its client id and makes its client secret. Mina
(pixelpilgrim) and Lena (lurkerlena) have Twitch accounts of their own.

### 2. The rig's first call (00:05)
The rig's setup script follows Twitch's Get Started: it trades the app's client id and secret for an app access token
(the client credentials grant: no user, a token that lasts weeks), validates it (no login, no user id), then reads the
channel it will stream to: Get Users by login aaronvolter (its id, its display name AaronVolter), Get Channel
Information by that id (no title, no category yet) and Get Streams for user_login aaronvolter (empty: the channel is
offline).

### 3. Preparing the stream (17:30)
Aaron signs in at www.twitch.tv/login and opens the creator dashboard's stream manager, which shows the channel offline.
In Edit Stream Info he types the title "Raiku builds a cozy farming game, day 1", searches the categories for
"software", picks Software and Game Development, and saves. Then in Settings, Stream he copies the Primary Stream key
into the rig's stream-key.txt.

### 4. Raiku starts listening (17:45)
Raiku's ears open the chat socket and log in anonymously (tags capability, PASS SCHMOOPIIE, a justinfan nick): Twitch
welcomes the nick, and joining #aaronvolter is answered with the join, the names list and its end.

### 5. Going live (18:00)
OBS first runs a bandwidth test (the stream key with ?bandwidthtest=true): Twitch takes the broadcast but shows it to
nobody, and the channel stays offline. Aaron stops the test and goes live: OBS publishes to the channel's stream key, the
first segments are cut, and the channel is live, its stream carrying the title and category Aaron set, and the audience
arrives. (Both publishes are the encoder's, outside the walk.) Aaron opens twitch.tv, which moves him to www.twitch.tv,
whose front page sends him, logged in, to his channel. A visitor first mistypes the channel's name (aaronvoltre) and gets Twitch's page for content that
is unavailable, then types twitch.tv/aaronvolter, is moved to
www.twitch.tv/aaronvolter, and sees the title and category, an empty chat with Log In to Chat, and the player, which asks
Twitch's playback host for the channel's next broadcast and waits (nothing the walk published answers it).

### 6. The first viewer chats (18:10)
The simulated viewers start with Mina. The program sends her to Twitch's authorize page for "Raiku Rig" with the scope
user:write:chat; she is not signed in, so the page asks her to log in first, then shows what the app may do, and she
clicks Authorize. Twitch sends her browser to http://localhost:3000 with a code, which the program trades for her access
and refresh token and validates as it starts using them (pixelpilgrim, her user id, user:write:chat). It looks up the
broadcaster's id by the channel's login, then sends "hi Raiku! what are we building today?" to aaronvolter's chat as
Mina, the sender the validation named. Twitch answers that it was sent; Raiku's ears receive it as a tagged PRIVMSG from
PixelPilgrim, and the visitor's open channel page, asking for the chat's new messages, shows it.

### 7. A second viewer, twice (18:20 and 19:20)
The program sends Lena to the same page. She is not ready to let a program chat as her, and clicks Cancel: Twitch sends
her browser back with access_denied, and the program leaves her out. At 19:10, an hour after it started with Mina's
token, the program validates that token again, as it does hourly: it is still valid, with 10524 seconds left. At 19:20,
having watched for an hour, Lena opens the link again; still signed in at Twitch, she goes straight to the consent and
clicks Authorize. The program trades and validates her code as it did Mina's, and sends her first line through the API,
as her: "first time here, love the avatar". Raiku's ears hear it as LurkerLena's first message in the channel.

### 8. The stream's conversation (19:30)
Aaron answers chat from the stream manager's chat as the broadcaster: "welcome Mina! a cozy farming game in Godot".
Raiku's ears receive it with the broadcaster's badge. Lena, signed in at twitch.tv since she authorized, opens the
channel's chat in its popout, where her line from the program shows, and types a second one herself: "the chickens are
adorable", which Raiku's ears hear as no longer her first. Mina, logged in at twitch.tv too, asks in the channel page's
chat "is it Godot or Unity?".

### 9. Ending the stream (22:10 and 22:30)
At 22:10, four hours after Mina authorized, the program's hourly validation finds her token is no longer valid (it lapsed
at 22:05); it trades her refresh token for a new access token (Twitch gives the same refresh token back) and carries on.
At 22:30 Mina says "gg, see you tomorrow", which Raiku's ears hear as her third message. Aaron stops the stream in OBS
(the encoder's act, outside the walk); Raiku's ears leave #aaronvolter and hang up.

### 10. Leaving (22:45, and Friday 2 January, 09:00)
The rehearsal is over. The simulated viewers end both viewers' sessions by revoking their access tokens (Lena's, made at
19:20, is still within its four hours), and check that Mina's revoked token no longer validates before the program exits.
The next morning the setup script, which still holds its app token (it lasts weeks), reads what the stream left on the
channel: its title and category.

## Operations, screens and doors by act

| act | reached |
|---|---|
| 1 | doors `console` (account and app, the credential door) and `accounts` |
| 2 | id `oauth2Token` (client_credentials), `oauth2Validate`; `getUsers`, `getChannelInformation`, `getStreams` |
| 3 | screens `login`, `stream-manager` (`getStreams`, `getChannelInformation`, `searchCategories`, `modifyChannelInformation`), `stream-key` (`getStreamKey`) |
| 4 | socket `chat`: CAP, PASS, NICK, JOIN |
| 5 | the RTMP ingest `ingest` (a bandwidth test, then the broadcast) and door `audience`: the encoder's and the audience's, outside the walk; screen `web` (twitch.tv's moves, the root); screen `channel`; screen `video` (the next broadcast's playlist: none) |
| 6 | screen `authorize` (sign-in, Authorize); `oauth2Token` (authorization_code), `oauth2Validate`; `getUsers` (by login); `sendChatMessage`; socket `chat` PRIVMSG; screen `channel` (the chat region's held read) |
| 7 | screen `authorize` (Cancel, then Authorize); `oauth2Validate` (Mina's, hourly); `oauth2Token`, `oauth2Validate` (Lena's); `sendChatMessage` as Lena through the API; socket `chat` PRIVMSG (first-msg) |
| 8 | screen `stream-manager` (`sendChatMessage` as the broadcaster); socket `chat` PRIVMSG with the broadcaster badge; screen `popout-chat` (`sendChatMessage` as Lena, her second line); screen `channel` (`sendChatMessage` as Mina) |
| 9 | `oauth2Validate` (401), `oauth2Token` (refresh_token), `sendChatMessage`; socket `chat` PRIVMSG and PART, then closed; the ingest's end (outside the walk) |
| 10 | `oauth2Revoke` (both), `oauth2Validate` (401); `getChannelInformation` |
