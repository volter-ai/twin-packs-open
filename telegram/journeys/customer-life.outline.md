# Tide Labs on Telegram: the outline

**The customer.** Tide Labs, a two-person software studio in Lisbon. Ana Ribeiro, its founder, runs an agent on Volter
Harness that she and the team talk to on Telegram, and publishes the studio's news to its Telegram channel with
Scheduler. Bruno Costa, its engineer, is on the team chat. The story runs from Monday 5 January to Friday 27 February
2026: two bots made, the agent at work in a private chat and a group, a news channel connected to Scheduler and posted to
for six weeks, the agent's group retired and, at the end, the agent's token revoked. The channel and its bot stay.

## Who acts, and with what

- **Ana** and **Bruno**: Telegram accounts, acting in the Telegram app (the World's doors stand in for the app: an
  account, a chat made, a member added or removed, a message posted). An account holds no API credential.
- **BotFather**, Telegram's bot for making bots (https://core.telegram.org/bots/features#botfather): Ana makes each
  bot there and is given its token; at the end she makes one again there, which revokes the one before (the World's
  bot doors stand in for /newbot and /token).
- **The agent bot**, @tidelabs_agent_bot, token A: Volter Harness's Telegram channel (the Chat SDK's adapter, polling).
  Its grant is the bot's: it reads the updates sent to it and writes in chats it is in. Privacy mode is on, as every
  bot's is by default, so in a group where it is a plain member it receives only commands meant for it, replies to it
  and service messages (https://core.telegram.org/bots/features#privacy-mode); an administrator bot is sent every
  message, which is why Ana, once the agent misses the team's messages, makes it an administrator of the team group.
  Harness's board, where the agent files work as cards, tells a chat subscribed to a card when it is done, the card's
  files attached; the Chat SDK sends a message with files as MarkdownV2 (supercode board/dispatch.mjs notifyChats,
  @chat-adapter/telegram's resolveParseMode).
- **The news bot**, @tidelabs_news_bot, token N: the bot Scheduler posts with. Scheduler's Telegram integration calls with
  the one bot its deployment configures, its TELEGRAM_TOKEN, so Ana runs Scheduler
  herself (docker compose, local storage) and sets its TELEGRAM_TOKEN to token N. She makes the bot an administrator of
  the channel allowed to post and to delete messages.

A bot can write to a person in private only after the person has started it, and to a group or channel only while it
is a member; a bot deletes another's message in a channel only with the right to delete messages.

## Acts

1. **Monday 5 January, 10:00. Two people, one bot.** Ana and Bruno have Telegram accounts. Ana makes the agent bot
   with BotFather and is given token A. In Telegram she opens the bot, presses Start (/start) and writes: "Hi! I'm Ana
   from Tide Labs. Can you keep notes of our standups?" (doors: people, bots, a private message twice).
2. **10:05. The agent comes up.** Ana puts token A in her Harness profile and starts Harness. Its adapter reads the
   bot itself (getMe), removes any webhook so it can poll (deleteWebhook, keeping pending updates), and polls
   (getUpdates, timeout 30): Ana's /start and her message come back at once. For her message it shows the bot typing in
   her private chat (sendChatAction) and posts the agent's answer there (sendMessage, plain text).
3. **11:00. The team chat.** Ana makes the group "Tide Labs team" with Bruno and the agent bot, which the app adds as
   a plain member (door). Harness's poll, from the update after the last it read (offset), receives the bot's own
   membership change (my_chat_member) and the service message that the group was created, which privacy mode lets
   through. At 11:10 Bruno tells the team standups are at 9:00 on Tuesdays from tomorrow, items posted in the group, and
   asks "@tidelabs_agent_bot what did Ana ask you to track?"; privacy mode sends a plain member neither (a plain
   mention is no command and no reply to it), so no answer comes. At 11:25 Ana reads why and makes the agent an
   administrator of the group (door), and Bruno asks again with the standup time. Harness's next poll receives the
   bot's promotion and Bruno's second question, and nothing of his first two messages; the agent answers in the group
   that it will post the digest at 9:15 (no typing indicator outside a private chat). Ana makes the group the
   profile's home chat in Harness (no Telegram call).
4. **Tuesday 6 January, 09:00. The first standup and its digest.** Ana posts her items in the group, and Harness's poll,
   held open, returns with them as she posts; at 09:02 Bruno posts his (blocked on staging credentials) and Harness's
   next poll, from the update after hers, returns with them. At 09:15 Harness's scheduled job posts the digest of
   exactly those items to the home chat (sendMessage to the group).
5. **Wednesday 7 January, 14:00. The news channel.** Ana makes the public channel "Tide Labs News" (@tidelabs_news)
   with the studio's logo as its photo (door). She makes the news bot with BotFather (token N) and adds it to the
   channel as an administrator that may post and delete messages (door). In the Scheduler she runs herself (docker compose,
   local storage) she sets TELEGRAM_TOKEN to token N, and then chooses to add Telegram; Scheduler
   shows the command to post, "/connect" and a word, and she posts it in the channel (door). Scheduler's connect screen
   polls (getUpdates, its library sending allowed_updates as the fields allowed_updates[0]=message and
   allowed_updates[1]=channel_post, which the Bot API does not read as its JSON-serialized list, so every update type
   comes back): the bot's own membership change and her post come back. Scheduler reads its bot (getMe), checks the bot
   may delete messages there (getChatMember: an administrator with can_delete_messages), deletes her /connect post
   (deleteMessage), posts "Connection Successful. Message will be deleted in 10 seconds." (sendMessage) and, ten
   seconds later, deletes that too (deleteMessage). It then reads the channel (getChat), the photo's file (getFile), and copies the photo into its
   storage from the file's link (the file download).
6. **Thursday 8 January, 10:00. The launch post, and the release notes.** Scheduler publishes Ana's announcement, bold title and two paragraphs
   (sendMessage, parse_mode HTML).
   At 11:00 Ana asks the agent in her private chat for the 0.9 release notes by Friday; Harness's poll receives it,
   it shows the bot typing, and the agent answers that the work is card t_7c1e9a04 on its board and that this chat
   will get the notes when it is done (it subscribes the chat to the card on the board; no Telegram call). **Friday 9
   January, 15:00**: the card is done with its notes file, and Harness's board tells the chat: the notice "card … done
   — Draft the 0.9 release notes" and its summary as the caption of the file (sendDocument, the file uploaded, the
   caption in MarkdownV2 as the Chat SDK escapes it).
7. **Monday 12 January, 10:00. A release with screenshots.** Scheduler publishes the release post with three screenshots
   as one album, the text on the first (sendMediaGroup, the images uploaded). At 11:00 it publishes the post's comment,
   the changelog, as a reply to the album's first message (sendMessage with reply_parameters naming it).
8. **Monday 12 January, 18:00. The standups move.** The team moves its standups to a video call and Ana removes the
   agent bot from "Tide Labs team" (door), but leaves the digest job on. Tuesday 13 January at 09:15 the job posts its
   digest to the home chat, which says no standup items were posted this week (that morning's standup was on the
   call), and Telegram refuses: "Forbidden: bot was kicked from the group chat". Ana deletes the job in Harness (no
   Telegram call).
9. **Wednesday 14 January, 16:00. A caption too long.** Ana's next post is one product photo with a 1,091-character
   story. Scheduler sends it (sendPhoto) and Telegram refuses it: a photo's caption holds at most 1,024 characters
   ("Bad Request: message caption is too long"); Scheduler shows "Telegram rejected the post". At 16:20 she cuts the story
   to a paragraph and Scheduler sends it again, which posts.
10. **Monday 19 January, 11:00. A demo and a paper.** Scheduler publishes the product demo video (sendVideo, uploaded) and,
   at 15:00, the white paper as a PDF (sendDocument, uploaded).
11. **Friday 27 February, 17:00. The agent retired.** Ana stops using the agent on Telegram and, in BotFather, makes a new
    token for it (/token), which revokes token A. Harness, still running on her laptop, polls with it and is refused ("Unauthorized"); she stops it. The
    news channel, its posts and the news bot stay with Scheduler.

## What the story reaches

getMe (both bots), deleteWebhook, getUpdates (held, a long poll; with allowed_updates sent as form fields the Bot API does not read; with offset),
privacy mode (a plain member bot sent a service message and not a plain mention; an administrator bot sent every
message), sendChatAction, sendMessage (plain, HTML, a reply; refused for a removed bot), getChatMember, deleteMessage
(twice), getChat, getFile, the file download, sendPhoto (refused for its caption, then sent), sendVideo, sendDocument
(Scheduler's PDF; Harness's notes with a MarkdownV2 caption), sendMediaGroup; and a revoked token's refusal.
