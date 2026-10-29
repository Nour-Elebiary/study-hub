# Study Hub — guide for leaders

Everything you need to run your courses on Study Hub, in plain language.
No technical knowledge needed. If something here does not match what you
see, ask your admin — the site may have been updated.

## Signing in

1. Your admin creates your account and gives you an email and a temporary
   password (in person or by message — never post it publicly).
2. Open the site address the admin gave you, sign in, and the site asks you
   to choose your own password (at least 10 characters).
3. A short 3-step tour shows you around on the first visit.
4. You can change your password any time from your account menu.
5. On a phone, the site may offer "Add to Home screen" — accept it and
   Study Hub opens like an app.

## Courses and content

Your admin puts you in courses with a role:

- **Owner** — runs the course: everything an editor can do, plus join codes
  and the member list.
- **Editor** — writes and publishes content in the areas they are given.
- **Contributor** — writes drafts in their areas; a reviewer or editor
  approves them.
- **Reviewer** — reads everything, approves or sends back drafts, and
  comments, but does not write content.

Content is a tree: the course home, sections, and notes inside them. Six
areas hold everything: Official materials, Student notes, Quiz & exam prep,
External resources, Glossary, and Open questions.

Writing a note:

1. Open the course, pick a section, and create a note (templates give you a
   head start for common formats).
2. The editor saves your work as a draft automatically while you type.
3. Press **Save version** to keep a permanent copy — you can always compare
   or go back to an older version.
4. When it is ready, send it for review (or publish directly if you are
   allowed to). Published notes are what students see.
5. Deleting a note is soft: it can be restored for 30 days, then it is gone.

Files: you can upload images, PDFs, audio, video and documents (up to the
site's size limit), or add a Google Drive link or a web link instead. Files
can be OCR'd (text read from pictures) or transcribed (speech to text) —
see "Heavy jobs" below. Each file has two switches students care about:
**visible to students** and **downloadable**. Turn downloads off for
material the professor does not want copied.

## Students and join codes

Students do not have accounts. They open the student site and enter a join
code you give them — the device remembers them for 90 days.

1. Open your course and tap **Student access (join codes)**.
2. Create a code, optionally with a label ("Section 1, morning class"), an
   expiry, or a use limit.
3. The code is shown **once** — write it down or copy it immediately. The
   site only stores a scrambled version, so it cannot show it again.
4. Share it by text, or let students scan the **QR code** or open the
   **share link** — the code is filled in for them.
5. The list shows how many students used each code. **Expire** stops new
   students joining but keeps the count; **Revoke** removes the code
   completely (use this if a code leaks).

Students see published content only, read-only, and can send you a
"correction suggestion" if they spot a mistake — you approve or dismiss it.

## The AI assistant

If you add your own Google AI key (the admin's guide explains how), a side
panel can help you draft, summarise and rewrite while you edit. Rules to
know:

- Your key is yours alone — it is stored scrambled, used only for your
  requests, and never shown to anyone.
- Free-tier keys must not receive personal or sensitive information.
- Files must be marked "allow AI" before the assistant can read them.
- There is a daily limit per leader; when the key hits Google's limits, the
  assistant switches to another available key or tells you to wait.

## Heavy jobs and the Home Worker

Long recordings and scanned PDFs are processed by a small program on a
leader's own PC (the "Home Worker"), not on the website. Open **Jobs** in
the menu to start one and watch its progress. If the badge says the worker
is offline, ask your admin which leader's PC is supposed to be running it.

## When something goes wrong

- **Forgot your password?** Ask an admin for a new temporary password.
- **A student cannot join?** Check the code's expiry and use limit on the
  Student access screen, then create a fresh one.
- **Something looks broken?** Note what you did and what you saw, and tell
  your admin — every change is recorded in the audit log, so problems can
  be traced.
- **Your account is locked or disabled?** Only an admin can fix that.

## For course owners: the admin area

Owners (and admins) also get a few extra screens under the admin menu:

- **Team** — who is in your course, with which role and areas.
- **Health** — drafts nobody finished, notes with no owner, and how much of
  the free storage and database the school is using.

Admins additionally manage leader accounts, courses, backups, settings and
the audit log — see `docs/restore.md` and the admin guides if you are
curious, but you do not need them for daily teaching.
