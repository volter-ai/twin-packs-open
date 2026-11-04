# Discord: the customer life, outline

Author: Contributor 87

Tidewater Yoga runs its community on a Discord server. Maya Chen owns the studio and the server; Jonah Park teaches
there and Priya Shah takes classes. Maya posts the week's schedule from Scheduler, which she hosts for the studio, and her
Cal.com booking page announces each booking in the server through a Discord webhook. Maya also runs a small bot of her
own, Tidewater Helper, which set the server up and answers schedule questions on the Gateway. In the same weeks Volter
sets up the Discord server of its project Open Autonomy, where the project's agent answers on the Gateway: first
Hermes, the agent the Open Autonomy kit runs, then Volter Harness, when the project picks another harness.

The life runs from Thursday 1 January 2026 to Tuesday 17 November 2026.

**Who acts, with what.**

- Maya, Jonah and Priya: their Discord accounts (username and password), in the Discord client and on Discord's pages
  (the authorize page). Maya owns the server, so she holds every permission in it.
- The Developer Portal (Maya, signed in): it makes her applications and gives each its client id and secret, its bot's
  token and its public key, and turns on a privileged intent when she asks.
- Tidewater Helper, Maya's own program: its bot token (`Bot`). Maya adds it with the portal's install link with the
  Administrator permission, so it may make roles, channels, webhooks and invites and read them back.
- Scheduler, Maya's self-hosted copy: its own application "Tidewater Scheduler" (its client id and secret, sent as HTTP Basic
  at the token URL; its bot token, `DISCORD_BOT_TOKEN_ID`, for every channel, message and member call) and Maya's grant
  (`bot identify guilds`), whose bearer token Scheduler uses only to name the connection. Its bot joins with the
  permissions Scheduler asks: send messages, create public and private threads, send messages in threads; what @everyone
  holds (view, read history, attach files, change nickname) it holds too.
- Cal.com: the webhook URL Maya pastes into its webhook settings (the token is in the URL).
- Aaron, who maintains Open Autonomy at Volter: his Discord account, the portal, and the project's server, which he
  owns. The kit's setup and the project's agent use the project application's bot token (`Bot`), which setup saves:
  Hermes speaks to Discord through discord.py, Volter Harness through the Chat SDK's Discord adapter (discord.js).

**Acts.**

1. **Accounts and a server** (Thursday 1 January). Maya, Jonah and Priya each have a Discord account (the people door).
   Maya creates the server "Tidewater Yoga" in the client: @everyone, a "Text Channels" category with #general and a
   "Voice Channels" category with General.
2. **The helper sets the server up** (the same morning). In the Developer Portal Maya makes the application "Tidewater
   Helper" and adds its bot to her server with the portal's install link (scope `bot`, Administrator): she logs in on
   the authorize page, picks her server and authorizes. Her setup script then runs as the bot: it reads its own
   application and its servers (one, with its member count), makes the roles Teachers (shown apart, mentionable) and
   Students, the channels #classes, #bookings, #announcements (@everyone may not send there, Teachers may) and a private
   #teachers (@everyone cannot see it, Teachers can), a webhook named "Cal.com" in #bookings, and an invite to #general
   that never expires, for the studio's website. Maya pastes the webhook's URL into Cal.com.
3. **People join** (Friday 2 January). Jonah and Priya follow the website's invite and join the server.
4. **Scheduler connects** (Monday 5 January). When she installed Scheduler, Maya made its application in the portal with
   Scheduler's redirect URL. In Scheduler she adds a Discord channel: Scheduler sends her to the authorize page
   with `bot identify guilds`, its permissions and `integration_type=0`; she logs in, picks Tidewater Yoga and
   authorizes. The redirect carries the code, the state Scheduler sent, the guild and the permissions. Scheduler trades the code
   at `/api/oauth2/token` (HTTP Basic): the answer carries the guild. It names the connection from `/api/oauth2/@me` (the
   application and its bot), lists the server's channels for its channel picker and, when Maya names the channel
   "Tidewater Schedule" in its preferences, sets its bot's nickname to that.
5. **The week's schedule** (the same day). Maya schedules the week's post in Scheduler, with the schedule as a picture, to
   #announcements. Scheduler's bot is refused (Missing Permissions): Maya made #announcements a channel only Teachers post
   in, and Scheduler shows the failure. She moves the post to #classes, where it goes out with the picture. She then adds a
   comment: typing "@jo" makes Scheduler look the name up (the server's roles, then a member search for "jo", which finds
   Jonah), and the comment names Jonah as Tuesday's teacher. Scheduler opens a thread on the post for its comments and posts
   the comment in it.
6. **A booking** (Tuesday 6 January). Priya books a private session on Maya's Cal.com page; Cal.com sends its Discord
   template to the webhook URL, and the booking appears in #bookings (Discord answers 204).
7. **The helper on the Gateway** (Wednesday 7 January). Maya starts the helper's listener so it can answer schedule
   questions: it finds the Gateway (`/gateway/bot`), opens it, is sent HELLO, heartbeats and identifies asking for
   guilds, guild messages and message content. Discord closes the connection with 4014 (disallowed intents): Maya never
   turned on the Message Content intent in the portal. She turns it on and restarts the helper: it finds the Gateway (no
   session started yet today), identifies and is sent READY and its server, and sets its status to watching the
   schedule. On every start it asks for the website's invite, and Discord answers the one it made on day one. Priya asks
   the helper in #general when yin is this week; it hears the question with its content, answers her with a reply and
   hears its own reply. Jonah books a class on Cal.com; the helper hears the booking arrive in #bookings. Maya then
   opens a second server, "Tidewater Teacher Training", for the spring course and adds the helper with the same install
   link; the running helper is sent the new server and posts the course's start date in its #general.
8. **A night off** (Wednesday night to Thursday 8 January). Maya quits the helper for the night, and its library closes
   the Gateway connection (code 1000), which ends the session. In the morning she starts it again, as every start
   goes: it finds the Gateway, opens a new connection and identifies afresh (no resume), sets its status and asks for the
   website's invite, which Discord answers with the same one.
9. **The weekly audit** (Sunday 11 January). The helper reads back what the week left: #bookings's messages, newest
   first (two bookings), the server's webhooks (Cal.com's, with its token) and its invites (the website's, used twice).
10. **Scheduler's token** (Monday 12 January). Before Maya's week-old grant expires, Scheduler refreshes it (HTTP Basic) and
    names the connection again with the new token.
11. **Open Autonomy's agent on Discord** (Tuesday 13 and Wednesday 14 January). Aaron creates the project's server "Open
    Autonomy" in the client. In the portal he makes the application under the project's branding, "Open Autonomy",
    turning on the Message Content intent, and adds its bot to the server with the install link (view, send, read
    history, react, open threads and send in them). Before the kit, he tries the application from a scratch script, as
    Discord's application-commands page shows: it registers two global slash commands, /ping and /status ("Is the bot
    up?"). He runs the kit's setup with its discord door: setup reads the bot's application (`oauth2/applications/@me`)
    and checks its name against the branding, then reads the home channel he gave it. He copied the server's id instead
    of #general's: Discord answers Unknown Channel (10003) and setup stops; with #general's id it finds a server
    channel. The kit starts Hermes: discord.py reads the bot's own user (`users/@me`) and its application with its
    owner, opens the Gateway at Discord's own host (gateway.discord.gg), identifies and is sent READY and the server.
    Then, as on every start (its command sync is on by default), Hermes reconciles its slash commands with the
    application's: it lists the global commands and finds Aaron's two, deletes /ping, which is none of its own, creates
    each of its commands the application lacks (68 of its 69: its 29 own, the 39 of its command registry a gateway
    offers, and /skill for the kit's skill), and edits /status, its own name described otherwise, to its description;
    4.5 seconds apart, about five minutes. Aaron asks the agent in #general, naming it, when 0.6 ships. Hermes hears the
    question, marks it 👀 (and hears its own reaction), shows it is typing, opens a thread named from the question (and
    is sent it), posts a progress message there and edits it into the answer (and hears the edit), then takes back its 👀
    and marks the question ✅. Aaron then uses Hermes's slash commands, each delivered as INTERACTION_CREATE on the
    Gateway and deferred privately (discord.py asks every callback `with_response`): Hermes posts the session status in
    #general and edits /status's deferred response into "Status sent~", posts its usage report there and deletes /usage's
    deferred response; only the private acknowledgements stay out of #general's history. /reload-mcp would invalidate the prompt cache, so Hermes asks first in #general: its prompt as
    text and an embed, with Approve Once, Always Approve and Cancel. Aaron clicks Approve Once; Hermes answers the click
    by editing the prompt (the embed green, footed with who approved, the buttons disabled), reloads and sends the
    result as a followup. The next day the project picks Codex for its agent: the kit stops Hermes's gateway and
    Volter Harness's orchestrator takes the home. Its Discord platform reads the application (`applications/@me`) for
    the id and public key Hermes's env lacks, finds the Gateway (`gateway/bot`) and identifies, asking for reactions
    too. Aaron asks what changed in the valve: Harness hears the mention, its adapter opens a thread on it and the reply
    goes there; Aaron reacts 👍 to the reply in the client, and Harness hears the reaction on its own message. The
    project's hourly pm job posts its report to the home channel by its bare id.
12. **Discord's channel visibility change** (Tuesday 17 November). Maya schedules a new post; Scheduler lists the server's
    channels for its picker, and since 16 November Discord leaves out the channels its bot cannot see: #teachers is not
    among them.

