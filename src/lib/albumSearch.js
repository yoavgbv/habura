/* Live typeahead search for the nominate flow. Was MusicBrainz-backed, but
   its API proved unreliable in practice (timing out for 30-40s under real
   usage) -- iTunes Search API is far more consistently fast, and reliability
   matters more than exhaustive catalog coverage for an interactive search
   box (unlike the one-time cover-fetch script, which still uses MusicBrainz
   as a fallback for exactly the albums iTunes misses). */

const LOW_VALUE_HINTS = [
  /tribute/i, /karaoke/i, /made famous by/i, /in the style of/i,
  /string quartet/i, /lullaby/i, /instrumental versions?/i,
];

/* iTunes' own relevance ranking can surface tributes/karaoke covers above
   the real album. Re-rank client-side: favor results whose artist/title
   actually overlap with what was typed, penalize obvious covers/tributes. */
function rescore(c, qLower) {
  const artist = c.artistName || "?";
  const title = c.collectionName || "?";
  let score = 0;
  const aLower = artist.toLowerCase();
  const tLower = title.toLowerCase();
  if (qLower.includes(aLower) || aLower.includes(qLower)) score += 30;
  if (qLower.includes(tLower) || tLower.includes(qLower)) score += 20;
  if (LOW_VALUE_HINTS.some((re) => re.test(title))) score -= 60;
  return { artist, title, score };
}

export async function searchAlbums(term) {
  const q = (term || "").trim();
  if (q.length < 2) return [];
  const url = "https://itunes.apple.com/search?" + new URLSearchParams({
    term: q, media: "music", entity: "album", limit: "15", country: "us",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  let data;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error("search failed: " + res.status);
    data = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const qLower = q.toLowerCase();
  const scored = (data.results || []).map((c) => {
    const { artist, title, score } = rescore(c, qLower);
    const year = c.releaseDate ? Number(c.releaseDate.slice(0, 4)) || null : null;
    const coverUrl = c.artworkUrl100 ? c.artworkUrl100.replace(/\/\d+x\d+bb\./, "/300x300bb.") : null;
    return { id: String(c.collectionId), artist, album: title, year, score, coverUrl };
  });
  scored.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const out = [];
  for (const r of scored) {
    const key = (r.artist + "::" + r.album).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 8) break;
  }
  return out;
}
