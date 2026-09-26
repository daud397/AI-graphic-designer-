# MUHSQ — AI Creative Agent

Generates on-brand Instagram post designs + captions from a one-line brief, lets you
refine any design by typing a plain-English edit, and tracks what you approve/reject
as brand memory that feeds future generations.

## How the API key works
At login, MUHSQ enters their own OpenAI API key alongside the PIN. That key is held
**only in server memory** for that session (never written to the database, disk, or
logs) and is used to call OpenAI on the client's behalf. It's discarded on sign-out
or server restart — they re-enter it next time. Revero never sees or stores this key.

## What's built (v1)
- Real OpenAI calls: `gpt-image-1` for designs, `gpt-4o-mini` for captions
- Prompt-based editing: type what to change, it regenerates with that instruction
- Approve / Reject / Mark-as-Posted flow, with a gallery of past work
- Brand memory: approved captions bias future generations; rejections are noted to avoid
- Brand settings page (name, tone, colours, do's/don'ts notes)
- Security: session tokens, rate limiting, security headers, file-access blocking

## What's NOT built yet (be upfront with the client)
- **Auto-posting to Instagram/Facebook** — needs Meta Business API access and app review;
  wire this in once MUHSQ's Meta access (requested in the onboarding doc) is ready.
- **Real product-photo compositing** — v1 designs backgrounds/layouts/badges with space
  left for their garment photo; true pixel-level photo editing (via OpenAI's image edit
  endpoint with their actual product images) is the natural Phase 2 upgrade.

## Run locally
```
npm install
npm start
```
Open http://localhost:3000 — PIN **1234** (change in db.js before real use) + their OpenAI key.

## Deploy
Push to GitHub → Railway → Deploy. Attach a Volume at `/data` and set:
- `DB_PATH=/data/muhsq.db`
- `IMAGES_DIR=/data/images`
so brand memory and generated designs survive restarts.
