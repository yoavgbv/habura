# HANDOFF — "החבורה" Album Ranking Site

## Context
You are picking up a project that was designed in claude.ai and is now moving to
Claude Code for the actual build. Read this whole file before writing any code.

The user is Yoav. Output language for the UI is **Hebrew, RTL**. Talk to Yoav in
Hebrew or English (he switches fluidly). He wants **minimum intervention points** —
do as much yourself as possible, including QA. Do not hand him a task you could do.

## What we're building
A small public website where six friends ("החבורה") each pick the **10 most
important albums** in the group's history from a seed list of 83, then see a
ranked result.

Voters (identified, no passwords — they pick who they are from a list):
ג׳וב · בומרה · דן · בנצי · בואב · פואד

Three phases, controlled by an admin (Yoav only, via a PIN):
1. `nominate` — members add missing albums to the list
2. `vote` — members each pick exactly 10
3. `results` — ranked view

Ranking: by number of votes. Tie-break: earlier year, then artist name A→Z.
The results view must visibly flag ties **around position 5**, because the
headline output is "the five most important albums."

## Stack (already decided — do not relitigate)
- **Front end:** the existing React single-component app, ported to a real Vite
  build. Keep the design exactly (see below).
- **Data:** **Supabase** (free tier). Replaces the artifact's `window.storage`.
- **Hosting:** **GitHub Pages**, public repo, on Yoav's existing GitHub account.
  URL will be `https://<username>.github.io/haburah`. No custom domain.
- **Deploy:** GitHub Actions on push to `main`.

Note for the Vite config: `base` must be set to `'/haburah/'` (or whatever the
repo is named) or Pages will 404 on all assets. This is the single most common
failure in this setup — get it right the first time.

## Files you are given
- `haburah.jsx` — the complete, working app (~1080 lines). Single React
  component, all 83 albums embedded, all CSS inline. **This is the design
  source of truth. Preserve it.** It currently uses artifact `window.storage`;
  that is the main thing to replace.
- `fetch_covers.py` — zero-dependency Python 3 script that fetches album covers
  from the iTunes Search API and emits `covers.json`. Already tested end to end.
- `album_collection_83.xlsx` — original source data. Reference only; the albums
  are already embedded in the jsx.

## Design — preserve exactly
Fanzine / riso-print aesthetic:
- paper `#e7e3d6`, ink `#17130f`, pink `#fa4d3c`, blue `#2b41c4`
- fonts: Suez One (display) + Heebo (body), both Hebrew-capable
- grain overlay, rank numbers with a "double-print" offset effect
- fully responsive, RTL throughout, honors `prefers-reduced-motion`

## The port: what actually changes
1. **Replace `window.storage`** with Supabase. Suggested schema:
   - `albums` — id (text, pk), artist, album, year, source ('seed'|'added'),
     added_by, cover_url
   - `votes` — voter (text), album_id (text), created_at; pk (voter, album_id)
   - `app_state` — single row: phase ('nominate'|'vote'|'results')
2. **Covers.** On Pages there is no CSP blocking images, so covers can be plain
   URLs — *do not* base64-embed them like the artifact did. Run `fetch_covers.py`
   yourself, then either commit the images to `public/covers/<id>.jpg` (simplest,
   version-controlled) or upload to Supabase Storage. Prefer committing them.
   Keep the existing graceful fallback: a typographic tile shows when an image
   is missing or fails to load.
3. **Multi-user sync.** Six people may be on at once. Use Supabase realtime
   subscriptions, or poll every few seconds. Votes must never silently clobber.
4. **Restore the native dialogs.** The artifact banned `window.confirm` because
   the iframe blocked it. On a real site it works — but the in-card confirm
   pattern that's already there is nicer, so keep it. Just know why it exists.
5. **`ADMIN_PIN` is currently `"1990"` — hardcoded.** Ask Yoav for a new one.
   Note honestly that a client-side PIN is theatre, not security; with six
   friends that's an acceptable tradeoff, but say so rather than implying it's
   secure. If you want it real, put phase changes behind a Supabase row-level
   policy.
6. **Deletion rule:** only manually-added albums can be deleted, never the
   original 83, and only during the nominate phase. Preserve this.

## Security — do not get this wrong
The Supabase **anon/public key is safe to commit**; it is designed to be public.
The **service_role key must never** appear in the front end or the repo. Enable
Row Level Security on every table and write explicit policies. Without RLS the
anon key lets anyone read and write everything.

## Your QA responsibilities (do these before showing Yoav anything)
- `npm run build` passes clean
- Test the full flow: nominate → add an album → open voting → six voters each
  pick 10 → results render correctly
- Enforce exactly 10 picks; verify the UI blocks 9 and 11
- Verify tie handling at position 5 specifically
- Two browsers at once: confirm votes sync and don't overwrite
- Mobile viewport — most of them will vote on a phone
- Hebrew RTL renders correctly, including mixed Hebrew/Latin album titles
- Missing-cover fallback tiles look right
- Verify the deployed Pages URL actually loads assets (the `base` trap above)

## Known gotchas
- Israeli albums (נושאי המגבעת, זקני צפת, הפה והטלפיים, רוקפור,
  כרמלה גרוס ואגנר, ברי סחרוף) will **miss** on iTunes or match the wrong
  release. The script writes `covers_missing.txt`; supply those by hand into
  `covers_manual/<id>.jpg` and re-run. Expect to ask Yoav for a handful of images
  — that is a legitimate intervention, batch it into ONE request.
- iTunes rate-limits at ~20 searches/min; the script already throttles at 3.2s.
- Album ids are `s0`–`s82` and are consistent across the jsx and the script.
  Do not renumber them.

## Open product questions (ask Yoav, don't guess)
- New admin PIN
- Should the 10 picks be *ranked* internally (weighted) or flat? Currently flat.
  A ranked ballot would reduce ties, which matters for the top-5 cutoff.
- Show a live count of added albums during the nominate phase?
- Should voters be able to change their ballot after submitting?

## Suggested order of work
1. Scaffold Vite + React, get `haburah.jsx` building and rendering unchanged
2. Set up Supabase: tables, RLS policies, seed the 83 albums
3. Port state from `window.storage` to Supabase, add realtime sync
4. Run `fetch_covers.py`, commit covers, wire up the URLs
5. GitHub Actions → Pages, verify the live URL
6. Full QA pass
7. Hand Yoav the link plus the one batched list of missing covers

Start by confirming the plan and asking only for: the Supabase URL and anon key,
his GitHub username, and the new admin PIN.


---

## Using the QA subagent

This package includes `.claude/agents/qa-reviewer.md`. Copy the whole `.claude`
directory into the repo root; Claude Code picks it up automatically.

Invoke it after each meaningful chunk of work:

    > use the qa-reviewer agent to check the voting logic

Or let it trigger on its own — its description says to use it proactively before
showing the user anything.

**Why only one agent.** A manager/coder/QA trio was considered and rejected:
this codebase is one component, one schema, one deploy, so coordination overhead
would exceed the benefit and each handoff loses detail. The QA agent earns its
place for one specific reason — it runs in a separate context and did not write
the code, so it cannot rationalize its own bugs. Yoav is the manager.

The main session implements. The QA agent only reports. Keep that separation;
it is the entire point.
