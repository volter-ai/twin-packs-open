# Kiln's workspace and its Runhuman apps

Maya owns Kiln, a design studio. Theo and Lena are its designers.
The story runs from January 2026, when Maya opens the workspace, to June 2028, when another studio acquires Kiln. People
act in their own Slack sessions; the apps Kiln builds or installs act with the grants Kiln gave them. Runhuman and RH2
are built and distributed outside Kiln, by their own vendor.

1. **January: a workspace.** Maya signs up for Kiln and invites Theo, who joins from his invitation email the next day.
   As a member, Theo can only ask for invitations: Maya approves his request for Lena and turns down the one for his
   cousin, since Kiln is for client work. Maya opens a channel for the studio, with its purpose and the current topic,
   and one for reviews, which she renames for the review process; Theo joins the studio and Maya adds him to reviews.
   Lena joins the studio for the first client brief, and Maya adds her to reviews when they come to cover production
   estimates; Theo leaves reviews to focus on design. Lena sets her title, and Theo marks himself away for a client
   call, which Maya sees. Maya posts the
   first brief; Theo asks about the deadline in its thread and corrects his own question, Lena adds her estimate. Maya
   reads the thread, copies its link, and pins the brief; Theo announces he is sketching, marks the brief read and
   acknowledges Lena's estimate with a reaction. A week later the brief is approved: Maya unpins it and Theo takes his
   reaction back. A retried delivery notice posts twice, and Maya deletes the duplicate. Theo's client loads the
   workspace's custom emoji.
2. **February: Kiln Bot.** Maya builds the studio's own notification app. Her first two manifest drafts are incomplete (the
   second asks for bot scopes without a bot user), and Slack's validator says so; she creates
   Kiln Bot from the corrected one, exports it to keep editing, and installs it in Kiln, its callback exchanging the
   code. The bot checks who it is, and Maya invites it to the studio. Her app configuration token lasts 12 hours and
   expires overnight, so the morning's export with the old pair is refused; her deploy script rotates the pair, and she
   updates the app's description to name its brief previews. On Thursday the bot schedules a reminder for Friday's
   client review; on Friday morning the client cancels, so it deletes that one, and the internal review held in the
   slot keeps its own, which Slack posts at its time. Theo snoozes notifications to prepare a deck and ends the snooze
   early when he finishes; Lena takes a shorter focus interval, which runs out by itself. Maya makes a Designers group
   with Theo and Lena and describes its review duty.
3. **Spring: Runhuman.** Kiln adds Runhuman's notifications for its client reviews. Maya opens a private channel for
   the client, installs Runhuman with the scopes its client asks for, and Runhuman's channel picker pages through the
   channels it can see. Maya adds Runhuman to the studio, where it posts a completed review and, after the reviewers
   flag a follow-up, the issue. Production goes quiet for a month and Maya disables the Designers group; when new briefs
   arrive she enables it again.
   Kiln buys priority support through Dub. Its support bot creates a shared support channel and invites the client
   by email through Slack Connect; Maya reads the pending invitation and its channel back. It stays pending until
   the receiving workspace acts, which this story does not model. The bot cannot invite two recipients at once,
   share a direct conversation, share an archived channel or act in a channel it has not joined.
4. **Summer: RH2, Home and Socket Mode.** Kiln moves its task discussion to RH2. Its vendor states the app with its
   command and event URLs, and RH2's server answers Slack's verification. Maya installs it; Theo first asks `/runhuman help`, and
   RH2 answers him alone in its acknowledgement, then runs `/runhuman` on the client brief; RH2 receives the signed
   command and acknowledges it empty while the task starts. Its first post fails because it is not in the channel yet, so it
   joins the studio and posts again, answers the command in the channel, adds the assigned reviewer in a thread, updates
   the task's status and tells Theo alone a status hint. Theo answers with the small-size context, which reaches RH2 as a
   message event. A channel bridge, installed the same way, reads the studio channel it was added to and forwards a task
   update there. A month later the studio starts using Kiln Bot's Home tab: Theo opens it and the bot publishes his
   summary. The bot
   posts a button for the next brief; Theo presses it, and the bot answers through the interaction's response URL, first
   to Theo alone, then replacing the button with who opened the brief, then removing the prompt once the brief is filed.
   Theo shares the brief's link and the bot attaches a preview. Theo asks Kiln Bot what is due this week and Lena reacts
   that she is watching; the bot's server receives the mention and answers in the question's thread, and Maya pins the
   question. That week Maya opens a channel for a press kit the client is
   shipping, renames it two days later when the client settles the kit's name, and archives it when the kit ships at
   the end of the week; Kiln Bot's server receives each of these events. Kiln's uptime monitor posts an alert with a GET,
   its token in the Authorization header, and the release script posts its note as a form. Theo builds a render bot to
   run behind the office firewall, hearing its mentions: he installs it, telling its install page where its incoming
   webhook posts, and creates the app-level token it opens Socket Mode with, and the bot connects. He opens a renders
   channel and invites the bot, which posts its first output. Theo asks the bot in the output's thread which settings it
   used; the question arrives on the bot's connection as an Events API envelope, which the bot acknowledges. The render
   farm posts the finished frames to the studio through the webhook, and the bot's agent answers Theo in the output's
   thread with the render's settings, written as markdown. Kiln's press team connects Dub from Dub's
   integrations, its link notices going to the studio: Theo shortens the press kit's link with `/shorten`, Dub matches
   him to its own account by his profile's email and answers him in its acknowledgement with the new link, and posts the
   link's notice to the studio through its incoming webhook.
5. **Autumn through 2027: files and a returning colleague.** Lena shares a private client proposal: Maya adds her to
   the private project, and she uploads the proposal and completes it into the channel. When the signed agreement
   supersedes the proposal, Lena deletes it. Lena leaves for a
   temporary placement; Maya makes Theo a workspace admin for her own leave, and Theo deactivates Lena's account, after
   which her old session is refused. Months later Theo reactivates her: her session identifies her retained account,
   her old channels are not restored, so she joins the studio again, and her contribution is still in the brief's
   thread. She opens a direct conversation with Theo and sends him the revised schedule, and Theo reads her message
   there.
6. **June 2028: the acquisition.** The acquiring studio retires Kiln's integrations. Maya, the workspace's owner,
   removes RH2 on Manage apps, and RH2 receives its uninstall notice. She uninstalls
   Kiln Bot with its own credentials, the bot receiving its uninstall event, rotates her long-held configuration pair
   and deletes the app. She removes the Slack integration in Dub, which uninstalls Dub's app with its token and
   client credentials. Runhuman's still-active grant sends its final notification. Maya archives the studio at the
   handover, and a Runhuman notification someone forgot to turn off cannot post into it, which shows her Runhuman is
   still connected: she disconnects Slack in Runhuman, whose server revokes its grant. She archives the private client
   project too. A month later the acquiring team wants the handover posted in the studio channel, so she unarchives it,
   and Lena posts the handover note there with her retained account.
