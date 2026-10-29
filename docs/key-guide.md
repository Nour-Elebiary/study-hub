# Add your AI key — a plain guide

The Study Hub's AI assistant uses **your own** Gemini key. You create it in
your own Google account, and the hub uses it only for your requests. Nothing
is shared between leaders, and the hub never sees or stores the key in a
readable form.

This guide takes about five minutes. You need a Google account and a laptop
or phone browser.

## Step 1 — Open Google AI Studio

Go to **aistudio.google.com** and sign in with the Google account you use for
your course work.

## Step 2 — Create an API key

1. Click **Get API key** (you may see it in the left menu or on the home
   page).
2. Click **Create API key**.
3. If it asks for a project, choose **create a new project** and give it a
   name you will recognise, for example `my-study-hub-project`.

**One key per project.** Google counts the free limits per project, not per
key, so a second key on the same project does not give you more room. The
hub refuses a second key for the same project for exactly this reason.

## Step 3 — Copy the key and paste it in the hub

1. Click **Copy** next to the new key.
2. In the Study Hub, open **Your AI key** from the menu.
3. Fill in the three fields:
   - **Name** — anything for you, for example "My laptop key".
   - **Google Cloud project name** — the project name from step 2.
   - **API key** — paste the key you copied.
4. Click **Save key**.

The key is encrypted before it is stored. After saving you will only ever see
its **last 4 characters** — that is normal, and it is how you recognise which
key is which.

## Step 4 — Press Test

Next to your key there is a **Test** button. It makes one tiny request to
Google and tells you straight away:

- **Key works** — you are ready to use the AI assistant.
- **Out of free quota** — the key is correct but the project's free allowance
  is used up for now. Try again later.
- **Google rejected this key** — check that you copied the whole key, and
  that the _Generative Language API_ is enabled for the project in
  [Google Cloud Console](https://console.cloud.google.com). The AI Studio
  key page has a link.

## How the free limits work

- The hub counts what it sends so it can slow down before Google refuses.
  The counters are a guide; when Google actually refuses (a "429"), the key
  rests — for a minute, or until midnight US Pacific time if the day's
  allowance is gone.
- The admin sets a **fair-use daily allowance** per leader, so one person
  cannot use up everything. When it is 0, the AI assistant is off.
- If your work is interrupted by a switch to another of your keys, the
  assistant carries the conversation over automatically — you do not repeat
  yourself.

## Deleting a key

Press **Delete** next to the key. This removes the key and its encrypted
copy from the hub completely. If a key was ever pasted somewhere by mistake,
delete it here **and** remove it in AI Studio.

## Privacy in one paragraph

On the free tier, what you send to Gemini may be used by Google to improve
its services. The hub shows a reminder the first time you open the
assistant. **Never paste student personal data** — names, grades, or private
notes about a person. Study material only. Files must be marked "allowed for
AI" before the assistant can read them; anything not marked is refused.
