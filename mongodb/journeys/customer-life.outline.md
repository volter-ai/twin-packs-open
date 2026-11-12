# One application keeps everything it knows in a World's MongoDB

Author: worker-1

The application is LibreChat, through mongoose over MongoDB's Node driver 6.20.0, in its own database `LibreChat`.
What it sends is `journeys/demand.json`, read from the server's own profile in two readings; its documents and
indexes are its models' (packages/data-schemas/src/schema at the commit the demand names). Every step's expected
answer is the one MongoDB Community 7.0.16 gave to that command in that order (`spec/recordings/librechat-story.json`),
placed in the life by twin-world's `scripts/recording-steps.mjs`.

1. **It connects.** The driver's first question is its handshake, `ismaster` with `helloOk`, and the server answers as
   a standalone does: writable, wire version 21, the sizes it may send.
2. **It makes its collections and their indexes.** Each model the story uses makes its collection, then its indexes:
   plain, unique, compound, partial, and ones that expire (users, sessions, roles, agent categories, balances,
   conversations, messages, transactions, access entries, the queued-turn queue). The queue lists its indexes after
   making them, as the demand shows.
3. **It writes its first documents.** The default roles and the default agent category, each value the BSON kind it
   was written as.
4. **A person signs up and signs in.** Registration looks for an account with Aya's email, counts the users with an
   aggregate (the first becomes the admin), writes her account and starts her balance with an upsert. A second
   sign-up with the same email is refused by the unique email index, which the refusal names. Sign-in finds the
   account by email, reads the role it holds and opens a session; the first page finds the account by id without
   its password.
5. **It keeps what changes.** The profile records the last sign-in; sign-out deletes the session; the second sign-in
   opens a new one, and recording the same last sign-in again changes nothing.
6. **A person chats.** The person's message, the conversation and the model's reply are each saved by a
   findAndModify that upserts and asks for the document after; the conversation collects each message's id. The
   turn's spend is its two transactions and a charge to the balance. The conversation list and the conversation
   reopened are finds; what the person may see is the distinct resources their grants name.
7. **The application closes** and ends its driver session, the last thing it sends.

Act mapping: each act's steps are `Recorded librechat-story: …` in the life, in this order.

Not in this life, and the gap: everything the application does only when an integration is switched on (the MCP
authority read, which starts a snapshot transaction), a document past the date of an expiring index (expiry is not
implemented yet), and every command and field no reading sent.
