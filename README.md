# החבורה

Album-ranking site for six friends. Vite + React, Supabase backend, deployed to
GitHub Pages via GitHub Actions on push to `main`.

Live: https://yoavgbv.github.io/habura/

## Local dev

```bash
npm install
cp .env.example .env   # fill in your Supabase URL/key
npm run dev
```

## Deploy

Push to `main`. Requires repo secrets `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_ADMIN_PIN`, and Settings → Pages → Source: GitHub Actions.

Supabase schema: `supabase/schema.sql` (run once in the SQL editor).

See `reference/CLAUDE_CODE_HANDOFF.md` for the full spec and design rationale.
