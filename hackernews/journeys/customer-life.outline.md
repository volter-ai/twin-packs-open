---
type: outline
domain: twin
---

# VideoGame AI's Show HN, and the two readers who meet it

**The customer.** VideoGame AI, launching its Model Editor on Hacker News as a Show HN on Monday 5 October 2026 at
09:00 in New York (13:00 UTC), from the launch's Hacker News channel `hn-aaron`, whose account is `yuerany`: Aaron, its
maker, submits it through the submit form by hand and posts the maker's first comment right after, as the campaign
(volter-ai/media, launch/dry-run) sends it. Hacker News has no posting API and asks that posting never be automated, so
every act on the site is a person on its pages; the only program is the launch's reviewer reading the public read API.
The World clock runs in UTC from Thursday 1 January 2026; times below are UTC.

**The actors and what each acts with.**

| Actor | Credential | What it allows |
|---|---|---|
| The World's runtime | none (the World's own door) | asks the credential door for the World's account: `yuerany` and its password (`HN_USERNAME`, `HN_PASSWORD`) |
| Aaron, the maker, at VideoGame AI | the `yuerany` password, then the `user` cookie the login answers | everything a signed-in member does: submit, comment, reply |
| Mira, a reader since January (`mira_k`) | her own password, then her cookie (a second cookie on her phone) | the same, as herself |
| Tobias, a reader since January (`tobiasw`) | his own password, then his cookie (a second on his work laptop, a third on his phone) | the same, as himself |
| Priya, Aaron's colleague at VideoGame AI, a reader (`priya_v`) | her own password, made on Aaron's laptop after he logs out, then her cookie | the same, as herself |
| The launch's reviewer, a script at VideoGame AI | none: the read API is public | reads items, users and the lists |

**The arc.**

1. **The World starts (Thursday 1 January, 00:00).** The runtime asks the credential door for the World's account,
   which makes `yuerany` as the login page's create-account form makes one.
2. **Mira joins and asks (Monday 12 January, 15:00).** From the front page she follows the login link and creates
   `mira_k` with the login page's create-account form, which posts to the page's own address; her first password is three
   letters and the page asks her to choose another, so she types a longer one and is signed in. She submits her question as a
   title alone; the site asks for a url or a text, her title kept, so she puts the question in the text field and asks
   the Ask HN with no url: what people use to model 3D assets for their games.
3. **Tobias answers her (Sunday 25 January, 18:00).** Reading newest signed out, he opens Mira's thread (13 days old,
   still open), writes his answer in the add comment box and posts it. Signed out, the site asks him to log in to
   comment, its forms keeping his answer; he first tries `tobias.w`, which the site refuses (letters, digits, dashes and
   underscores only), then creates `tobiasw` with that page's create-account form, and, signed in,
   the site answers the add comment page with his answer kept in its box. He posts it: Blender, then an exporter, its
   one line of code indented as code. He starts a follow-up about his exporter script in the add comment box, then leaves the tab.
4. **Tobias posts the follow-up (Tuesday 27 January, 18:00).** He comes back to the tab and submits: the thread is now
   15 days old, and threads close to new comments after two weeks, so the site refuses it. Nothing is posted.
5. **Blender's release notes reach Hacker News (Friday 2 October, 16:00).** Mira pastes the release notes' whole page
   title, and the submit page asks for a title under 80 characters, her url kept; she shortens it and submits the link.
   Tobias, reading newest signed out on his work laptop, follows its login link, mistypes his password once (Bad
   login.), signs in, finds her story first on newest and upvotes it.
6. **The launch, in the launch World (Monday 5 October, 13:00).** Aaron works at the World's place, where the hosted
   World shows news.ycombinator.com's pages under its own base: every link, form and redirect stays on that base, and
   the sign-in cookie names him there. He opens the submit page; signed out, it asks him to log in, and he logs in there
   as `yuerany` with the password the World issued. He submits the Show HN: its title, "Show HN: Model Editor – Blender
   in WebAssembly, driven by your coding agent", and the editor's home page as its url. The site sends him to newest,
   where the post is first, with 1 point. He opens its thread from its discuss link and posts the maker's first comment
   at once: who VideoGame AI is, what the editor is and how it works, its limits, its licence and source, and what he'd
   like to hear. He opens show from the top bar: the launch is not there yet, a point short of the threshold; the
   page's note links Hacker News's own rules and tips pages (the real site, in a tab of their own) and the newest Show
   HNs, where the launch is.
7. **The reviewer checks the post landed (13:05).** It reads the largest item id (the maker's comment, the last item
   made), the item (by `yuerany`, its title and url, 1 point, one comment, the maker's), the comment (its links escaped
   as the API writes them), newstories (the launch first) and showstories (the launch first), and `yuerany`'s user
   record, which the API now answers because the account has public activity.
8. **Mira finds it on her phone, in the launch World (13:20).** Signed out there, she opens newest, sees the launch
   first and taps its upvote arrow; the site asks her to log in to vote, the login forms on that page posting to the
   arrow's own address. She logs in there; the vote is made and the site sends her back to newest, where the launch has
   2 points. She opens its thread; her thumb taps add comment before she has typed, and the site asks her to try
   again. She asks whether it runs on Linux yet.
9. **Aaron answers, in the launch World (13:35).** He opens the thread, where Mira's question, newer on as many points,
   ranks above his comment; he follows its reply link and answers on the reply page: macOS on Apple Silicon only for
   now, with Node.js 24; Windows and Linux aren't supported yet; and the source's link, to follow along. The site sends him back to the thread.
10. **Tobias meets the editor elsewhere (14:10).** He comes to the editor from its own site, not from Hacker News, and,
   still signed in on his laptop from Friday, submits its home page under his own title to share it. The site counts it
   as his vote for the story already there and sends him to it: 3 points, his vote among them, no arrow left for him.
11. **Tobias on his phone (14:40).** Signed out on his phone, he opens the site's address, the front page, with the
   launch first, and its thread. He taps reply under Aaron's answer; the page asks him to log in to reply, its forms
   posting to the reply page itself. He logs in there; the site answers the reply page, and he replies that he will try it once
   Linux lands.
12. **The reviewer reads the launch's first three hours (16:00).** It asks the changes list what changed since 13:05:
   the launch among the items, `yuerany` among the profiles. So it reads those: the item has 3 points and 4 comments,
   Mira's and the maker's its kids, in ranked order; `yuerany` has 3 karma and has submitted the reply (under Mira's
   question, with Tobias's reply under it), the first comment and the story; topstories and beststories have the launch
   first. Aaron opens the launch World's Hacker News at its own address, the front page, signed in there (the launch
   first, 3 points, 3 hours ago), the show page, where the launch now
   stands past the points threshold, and `yuerany`'s user page. He hands the laptop to Priya, a colleague who reads Hacker News: he logs out from the top
   bar's logout link, the page shows no one signed in, and she follows its login link, makes her own account `priya_v`
   and, back on the launch thread as herself, upvotes Mira's question, the one the thread needed.

**What it reaches.** Every demanded form: login from the login page (and create account, with its username and
password rules), from the submit page, a vote link, a signed-out comment and the reply page; submit (a question, a link,
a Show HN, a title alone and a title over 80 characters sent back, a repost counted as a vote for its story); comment
(the maker's first comment, a question, a reply, an empty one sent back, one with code; refused on a closed thread);
upvote (from newest, from a thread, from a vote link's login when signed out, a repost's); logout and the account switch
it is for; every demanded page: login, submit, newest, shownew, show, the front page, item, reply and user; and the read
API's item, user, maxitem, newstories, showstories, topstories, beststories and updates; and the launch's acts at the
World's place. The story ends with the launch, its thread and four accounts still held.
