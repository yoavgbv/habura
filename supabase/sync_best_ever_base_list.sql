-- One-time catch-up: "best_ever" was seeded from the original 83, but "main"
-- has since grown to 133 with real nominations. Copies everything currently
-- in main into best_ever too (same id, artist, album, source, added_by,
-- cover_url), skipping the 83 already there. Safe to re-run.

insert into albums (poll, id, artist, album, year, source, added_by, cover_url)
select 'best_ever', id, artist, album, year, source, added_by, cover_url
from albums
where poll = 'main'
on conflict (poll, id) do nothing;
