const LOW_VALUE_TYPES = new Set([
  "Compilation", "Live", "Remix", "DJ-mix", "Mixtape/Street", "Demo", "Interview", "Spokenword",
]);

/* MusicBrainz's own relevance score often ranks tribute albums / soundtracks
   above the real thing (e.g. "nirvana nevermind" ranks a string-quartet
   tribute above Nirvana's actual Nevermind). Re-rank client-side: favor
   plain studio albums and results whose artist/title actually overlap
   with what the user typed. */
function rescore(rg, qLower) {
  const artist = rg["artist-credit"]?.[0]?.name || "?";
  const title = rg.title || "?";
  const secondary = rg["secondary-types"] || [];
  let score = rg.score || 0;
  if (secondary.length === 0) score += 40;
  if (secondary.some((t) => LOW_VALUE_TYPES.has(t))) score -= 60;
  const aLower = artist.toLowerCase();
  const tLower = title.toLowerCase();
  if (qLower.includes(aLower) || aLower.includes(qLower)) score += 30;
  if (qLower.includes(tLower) || tLower.includes(qLower)) score += 20;
  return { artist, title, score };
}

export async function searchAlbums(term) {
  const q = (term || "").trim();
  if (q.length < 2) return [];
  const url = "https://musicbrainz.org/ws/2/release-group/?" + new URLSearchParams({
    query: q, fmt: "json", limit: "15",
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error("musicbrainz search failed: " + res.status);
  const data = await res.json();
  const qLower = q.toLowerCase();

  const scored = (data["release-groups"] || []).map((rg) => {
    const { artist, title, score } = rescore(rg, qLower);
    const year = rg["first-release-date"] ? Number(rg["first-release-date"].slice(0, 4)) || null : null;
    return { id: rg.id, artist, album: title, year, score };
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

export function coverArtUrl(mbid) {
  return `https://coverartarchive.org/release-group/${mbid}/front-250`;
}
