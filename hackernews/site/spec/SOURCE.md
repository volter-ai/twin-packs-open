# Hacker News's site (news.ycombinator.com): its forms

- **Why this document:** Hacker News has no posting API and publishes no document of its site's forms; it asks that
  posting be done by people (https://news.ycombinator.com/newsguidelines.html: "please don't automate posting"). This
  OpenAPI document, `openapi.json`, is written by hand from the site's pages: the forms a person uses (login and
  create account, POST /login, and the same forms where the submit page and a vote link draw them signed out, each
  posting to its own address, POST /submit, POST /vote and POST /reply, and on a signed-out comment POST /comment again; submit, POST /r; add comment
  and reply, POST /comment; the
  upvote arrow, GET /vote; the top bar's logout link, GET /logout), each with the fields and action it carries as a person sees it, and the answers it draws. The pages themselves are the
  site lane's workspace screens, not operations.
- **The pages read** (2026-10-02, signed out, each fetched once):
  - the documented rules: https://news.ycombinator.com/newsguidelines.html, https://news.ycombinator.com/newsfaq.html,
    https://news.ycombinator.com/showhn.html, https://news.ycombinator.com/security.html and
    https://news.ycombinator.com/formatdoc (formatting, linked from the FAQ);
  - the forms and answers as a person sees them: https://news.ycombinator.com/login?goto=news (the login form, acct and
    pw, "login"; the create-account form, creating=t, acct and pw, "create account"; both post to the page's own
    address, the return page in its query: login?goto=news), https://news.ycombinator.com/submit (signed out: "You have to be logged in to submit." over the login
    forms), https://news.ycombinator.com/vote?id=1&how=up&goto=news (signed out: "You have to be logged in to vote."),
    https://news.ycombinator.com/news (the front page: rank, upvote link `vote?id=&how=up&goto=news`, title and site,
    points, user, age, comments), an item page, https://news.ycombinator.com/item?id=49940219 (the add comment form:
    action comment, parent, goto, hmac, text, "add comment"; the reply links `reply?id=&goto=`),
    https://news.ycombinator.com/item?id=999999999999 ("No such item.", 200),
    https://news.ycombinator.com/user?id=nosuchuserzzq9 ("No such user.", 200) and
    https://news.ycombinator.com/nosuchpagezz ("Unknown.", 404, text/plain).
- **The site's published source:** Hacker News's own news.arc and the html.arc it loads, as the Arc distribution keeps
  them (arclanguage/anarki, branch official, commit `622704867effa642c99ecf6aefc6a5f5f698650a`,
  https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc and
  …/html.arc, read 2026-10-03): the rank (`frontpage-rank`), a repost counted as the submitter's vote (`process-story`),
  the submit form's refusals (a title over 80 characters, an invalid url, neither url nor text), the login page a
  signed-out comment draws. The live site was read again for the reply page signed out
  (https://news.ycombinator.com/reply?id=49940915&goto=item%3Fid%3D49940219%2349940915: "You have to be logged in to
  reply." over the login forms, posting to the page's own address).
- **Where the documentation stops** (each said again where the pack rules it, in `../src/semantics/` and the vendor's
  `../../src/semantics/shared.ts`): the signed-in submit form's page (its fields are news.arc's, its words the FAQ's and
  Show HN's), the comment form's `hmac`, the vote link's `auth`, the submit form's `fnid` and the logout link's `auth`
  as links only their person can use (the live site's are opaque tokens; news.arc's fnids), the show page's points
  threshold, a site's canonical url for a repost, the vote page's refusal of a direction it does not take, and the
  characters' escapes in an item's text.
- **Corrections:** none.
- **Read by:** the hackernews pack's author session, 2026-10-02.
- **Written bytes (sha256):** `openapi.json` `b02b2cb24169c8c533a199c91af90a41a1203c301c9f7a63ed0a19cacfac9860`.
