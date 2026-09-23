# DeductCheck backend — deployment

One file, `api/submit-report.js`. When the site sends it a completed report, it emails the
client their report and evidence pack, bcc's your practice inbox on the same email (that bcc
**is** the secure copy — it lands in your normal inbox, under whatever retention practice you
already use there), and the email itself doubles as the confirmation the client sees.

## Why this exists as a separate piece

The site itself (the DeductCheck questionnaire) is currently published through Claude as a
preview link. Pages published that way can't call outside services directly — that's a
platform restriction, not something this code works around. This backend has to run
somewhere with normal internet access, and the site has to be hosted somewhere normal
too before it can talk to it. Wix, or any standard host, works fine for that once you're
ready to move off the preview link.

## Step 1 — Resend (sends the email)

1. Create a free account at **resend.com**. Free tier covers a trial's worth of sends many
   times over.
2. Add and verify a sending domain — a subdomain of your own is cleanest, e.g.
   `mail.clearlinetax.com.au`. A subdomain, not the bare domain, so DeductCheck's sending
   volume and reputation stay separate from your normal Clearline Tax & Accounting email.
   Resend gives you three DNS records to add; do that wherever `clearlinetax.com.au`'s DNS
   is managed. Verification is usually quick, occasionally takes a few hours.
3. Create an API key (Dashboard → API Keys). Keep it secret — it goes in Vercel's environment
   variables in step 2, **never** in the site's own code, since that code is visible to anyone.

## Step 2 — Vercel (runs the code)

1. Create an account at **vercel.com** — sign in with GitHub is easiest. Vercel's free Hobby
   plan explicitly excludes commercial use, and DeductCheck charges for reports, so you'll need
   the **Pro plan ($20/month)**, not the free tier — set that when you create the project.
2. Put this `backend` folder in its own GitHub repository (drag-and-drop upload on
   github.com works, no command line needed) and import it in Vercel as a new project.
   Vercel detects the `api/` folder automatically — no build configuration needed.
3. In the Vercel project's Settings → Environment Variables, add:

   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | the key from step 1 |
   | `FROM_EMAIL` | `DeductCheck <reports@mail.clearlinetax.com.au>` (must match your verified domain) |
   | `PRACTICE_EMAIL` | `deductcheck@clearlinetax.com.au` — confirmed live, an alias that routes to nathan@clearlinetax.com.au |
   | `ALLOWED_ORIGIN` | wherever DeductCheck ends up hosted (a page on clearlinetax.com.au, or its own domain); leave as `*` only while testing |

   Note: `PRACTICE_EMAIL` is just a receiving address — an alias is fine, and everything lands in your normal inbox. `FROM_EMAIL` is different: it's the address the system sends *as*, which is why it needs its own verified sending domain in step 1, separate from this alias.

4. Deploy. Vercel gives you a URL like `https://deductcheck-backend.vercel.app`.

## Step 3 — connect the site

Send me that URL and I'll set `BACKEND_URL` in the site to it. Until then, the site keeps
working exactly as it does now — the client downloads their pack and emails it to you
manually. Nothing breaks in the meantime; this is a pure upgrade once it's wired in.

## Testing before real clients see it

Once deployed, you can test the endpoint directly:

```bash
curl -X POST https://deductcheck-backend.vercel.app/api/submit-report \
  -H "Content-Type: application/json" \
  -d '{"clientEmail":"you@yourpersonaladdress.com","reportText":"test report","consent":true}'
```

You should get `{"ok":true}` and an email a few seconds later, bcc'd to your practice inbox.
If you get `server_not_configured`, an environment variable is missing or misspelled.

## What this does and doesn't do

- Sends one email per submission: to the client, bcc to you, report as a text attachment,
  evidence pack attached if one was built.
- Does **not** keep its own database — "storage" is simply that bcc'd email arriving in your
  inbox. If you later want a proper searchable record of every submission, that's a separate,
  larger piece (a real database), worth doing once the trial shows this is worth scaling.
- Rejects anything without the consent flag, an invalid email, or an oversized attachment
  (8 MB cap — a pack with many photos could exceed this; if that turns out to matter, the fix
  is a larger request body limit and a Vercel plan that supports it).
