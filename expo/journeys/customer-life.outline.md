# RH2 mobile push: customer life

RH2 console reviewer Jonah installs the mobile app on his iPhone and Android tablet. Notifications are allowed,
both devices are online, and the project is @volter-ai/runhuman. Priya installs the same app on her iPhone.
Jonah and Priya grant native notification permission and act through their phones. RH2 posts public push requests;
the administrator and operator make public diagnostic sends and receipt reads. Enhanced push security is disabled,
so no push API credential is required. The World devices door represents native registration: its answer supplies
each captured token; none is invented. Expo offers no public server API for that native act.

1. **Away from the console.** RH2 posts its actual array payload to Jonah's two phones: a review waits in room 12.
   Tickets confirm queuing; Jonah reads the tablet's displayed notification after delivery and opens its data.url.
2. **A departing reviewer.** A day later Priya uninstalls. The next scheduled away notification still carries her
   old token. After fifteen minutes the simulated provider has reported unregistration. RH2's next scheduled
   notification draws a DeviceNotRegistered ticket, which RH2 uses to remove that token. An hour later the operator
   checks the original queued ticket's receipt for diagnosis; no send follows that discovery.
   Real providers may report unregistration later; the World chooses the next delivery deterministically.
3. **A delivery investigation.** The next day an administrator accidentally sends the full review transcript as
   a diagnostic notification. Expo accepts it, but its payload exceeds 4096 bytes. Fifteen minutes later the receipt
   reports MessageTooBig. The administrator corrects it to RH2's short body and data.url; Jonah receives the notice.
4. **Leaving.** After another day the operator's old receipt lookup is empty (receipts expire after 24 hours).
   Jonah uninstalls both apps and leaves the reviewing team.

Operations: pushSend throughout; pushGetReceipts for delivery diagnosis. Doors: devices, inbox, uninstall.
The reference's request-limit, malformed-body, mixed-project, single-object and multi-recipient examples run
separately as published examples; this customer has no reason to manufacture those failures.
