#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_covers.py  —  Cover fetcher for "החבורה" album-ranking site.

Runs on YOUR machine (open internet). Zero dependencies: pure Python 3 stdlib.
It looks up each of the 83 albums on the free iTunes Search API (no key needed),
downloads the cover at a fixed size directly from Apple's CDN, encodes it as a
base64 data-URI, and writes them out so they can be embedded straight into the
artifact — no runtime network, no CSP/CORS problems.

USAGE
  python3 fetch_covers.py                 # fetch everything, write covers.json + reports
  python3 fetch_covers.py --patch haburah.jsx   # also inject covers into the artifact file
  python3 fetch_covers.py --size 250     # smaller covers = smaller output file

HANDLING WRONG / MISSING MATCHES (the Israeli albums will mostly miss iTunes)
  1) covers_manual/<id>.jpg  — drop your own image here (e.g. covers_manual/s70.jpg).
                               Takes priority over iTunes. Any of .jpg/.jpeg/.png/.webp.
  2) overrides.json          — force a better search term or a direct image URL:
       {
         "s12": {"term": "Pixies Surfer Rosa"},
         "s70": {"url": "https://example.com/cover.jpg"}
       }
  After adding manual files / overrides, just run the script again.

OUTPUT
  covers.json          — {id: "data:image/...;base64,..."} for everything found
  covers_report.txt    — what matched (and to which iTunes release), per album
  covers_missing.txt   — the albums with no cover yet, ready for covers_manual/
  (with --patch)       — your haburah.jsx, covers injected between the COVERS markers
                         (a .bak backup of the original is written first)
"""

import argparse, base64, json, os, re, sys, time, unicodedata
import urllib.request, urllib.parse, urllib.error

# ---- the 83 albums, ids identical to the artifact (s0..s82) ----
ALBUMS = [
    {"id": "s0", "artist": "Pixies", "album": "Surfer Rosa", "year": 1988},
    {"id": "s1", "artist": "Pixies", "album": "Doolittle", "year": 1989},
    {"id": "s2", "artist": "Pixies", "album": "Bossanova", "year": 1990},
    {"id": "s3", "artist": "Pixies", "album": "Trompe le Monde", "year": 1991},
    {"id": "s4", "artist": "Sonic Youth", "album": "EVOL", "year": 1986},
    {"id": "s5", "artist": "Sonic Youth", "album": "Goo", "year": 1990},
    {"id": "s6", "artist": "Sonic Youth", "album": "Dirty", "year": 1992},
    {"id": "s7", "artist": "Blur", "album": "Leisure", "year": 1991},
    {"id": "s8", "artist": "Blur", "album": "Modern Life Is Rubbish", "year": 1993},
    {"id": "s9", "artist": "Blur", "album": "Parklife", "year": 1994},
    {"id": "s10", "artist": "Blur", "album": "The Great Escape", "year": 1995},
    {"id": "s11", "artist": "Metallica", "album": "Metallica (The Black Album)", "year": 1991},
    {"id": "s12", "artist": "Nirvana", "album": "Bleach", "year": 1989},
    {"id": "s13", "artist": "Nirvana", "album": "Nevermind", "year": 1991},
    {"id": "s14", "artist": "Nirvana", "album": "In Utero", "year": 1993},
    {"id": "s15", "artist": "Pearl Jam", "album": "Ten", "year": 1991},
    {"id": "s16", "artist": "Pavement", "album": "Slanted and Enchanted", "year": 1992},
    {"id": "s17", "artist": "Pavement", "album": "Crooked Rain, Crooked Rain", "year": 1994},
    {"id": "s18", "artist": "Pavement", "album": "Wowee Zowee", "year": 1995},
    {"id": "s19", "artist": "Pavement", "album": "Brighten the Corners", "year": 1997},
    {"id": "s20", "artist": "Pavement", "album": "Terror Twilight", "year": 1999},
    {"id": "s21", "artist": "The Smashing Pumpkins", "album": "Gish", "year": 1991},
    {"id": "s22", "artist": "The Smashing Pumpkins", "album": "Siamese Dream", "year": 1993},
    {"id": "s23", "artist": "Guided by Voices", "album": "Same Place the Fly Got Smashed", "year": 1990},
    {"id": "s24", "artist": "Guided by Voices", "album": "Propeller", "year": 1992},
    {"id": "s25", "artist": "Guided by Voices", "album": "Vampire on Titus", "year": 1993},
    {"id": "s26", "artist": "Guided by Voices", "album": "Bee Thousand", "year": 1994},
    {"id": "s27", "artist": "Guided by Voices", "album": "Alien Lanes", "year": 1995},
    {"id": "s28", "artist": "Guided by Voices", "album": "Under the Bushes Under the Stars", "year": 1996},
    {"id": "s29", "artist": "The Breeders", "album": "Pod", "year": 1990},
    {"id": "s30", "artist": "The Breeders", "album": "Last Splash", "year": 1993},
    {"id": "s31", "artist": "The Amps", "album": "Pacer", "year": 1995},
    {"id": "s32", "artist": "Dinosaur Jr.", "album": "You're Living All Over Me", "year": 1987},
    {"id": "s33", "artist": "Dinosaur Jr.", "album": "Bug", "year": 1988},
    {"id": "s34", "artist": "Dinosaur Jr.", "album": "Green Mind", "year": 1991},
    {"id": "s35", "artist": "Dinosaur Jr.", "album": "Where You Been", "year": 1993},
    {"id": "s36", "artist": "Sebadoh", "album": "III", "year": 1991},
    {"id": "s37", "artist": "Sebadoh", "album": "Bakesale", "year": 1994},
    {"id": "s38", "artist": "Sebadoh", "album": "Harmacy", "year": 1996},
    {"id": "s39", "artist": "Robert Wyatt", "album": "Rock Bottom", "year": 1974},
    {"id": "s40", "artist": "נושאי המגבעת", "album": "נושאי המגבעת", "year": 1988},
    {"id": "s41", "artist": "נושאי המגבעת", "album": "מי רצח את אגנתה פאלסקוג", "year": 1991},
    {"id": "s42", "artist": "רעש", "album": "רעש רק רעש", "year": 1994},
    {"id": "s43", "artist": "Pink Floyd", "album": "The Piper at the Gates of Dawn", "year": 1967},
    {"id": "s44", "artist": "Pink Floyd", "album": "Atom Heart Mother", "year": 1970},
    {"id": "s45", "artist": "The Beatles", "album": "The Beatles (White Album)", "year": 1968},
    {"id": "s46", "artist": "Aphex Twin", "album": "Richard D. James Album", "year": 1996},
    {"id": "s47", "artist": "My Bloody Valentine", "album": "Loveless", "year": 1991},
    {"id": "s48", "artist": "Built to Spill", "album": "Perfect from Now On", "year": 1997},
    {"id": "s49", "artist": "Yo La Tengo", "album": "I Can Hear the Heart Beating as One", "year": 1997},
    {"id": "s50", "artist": "Beck", "album": "Mellow Gold", "year": 1994},
    {"id": "s51", "artist": "Afghan Whigs", "album": "Gentlemen", "year": 1993},
    {"id": "s52", "artist": "PJ Harvey", "album": "Rid of Me", "year": 1993},
    {"id": "s53", "artist": "Stereolab", "album": "Emperor Tomato Ketchup", "year": 1996},
    {"id": "s54", "artist": "The Velvet Underground", "album": "The Velvet Underground", "year": 1969},
    {"id": "s55", "artist": "The Cure", "album": "Disintegration", "year": 1989},
    {"id": "s56", "artist": "Joy Division", "album": "Unknown Pleasures", "year": 1979},
    {"id": "s57", "artist": "The Modern Lovers", "album": "The Modern Lovers", "year": 1976},
    {"id": "s58", "artist": "The Magnetic Fields", "album": "69 Love Songs", "year": 1999},
    {"id": "s59", "artist": "Blonde Redhead", "album": "Fake Can Be Just as Good", "year": 1997},
    {"id": "s60", "artist": "Blonde Redhead", "album": "In an Expression of the Inexpressible", "year": 1998},
    {"id": "s61", "artist": "R.E.M.", "album": "Automatic for the People", "year": 1992},
    {"id": "s62", "artist": "Pulp", "album": "Different Class", "year": 1995},
    {"id": "s63", "artist": "Faith No More", "album": "Angel Dust", "year": 1992},
    {"id": "s64", "artist": "Jane's Addiction", "album": "Ritual de lo Habitual", "year": 1990},
    {"id": "s65", "artist": "Frank Black", "album": "Teenager of the Year", "year": 1994},
    {"id": "s66", "artist": "dEUS", "album": "Worst Case Scenario", "year": 1994},
    {"id": "s67", "artist": "Mission of Burma", "album": "Vs.", "year": 1982},
    {"id": "s68", "artist": "The Jon Spencer Blues Explosion", "album": "Orange", "year": 1994},
    {"id": "s69", "artist": "Oasis", "album": "Definitely Maybe", "year": 1994},
    {"id": "s70", "artist": "זקני צפת", "album": "זקני צפת", "year": 1992},
    {"id": "s71", "artist": "כרמלה גרוס ואגנר", "album": "פרח שחור", "year": 1991},
    {"id": "s72", "artist": "הפה והטלפיים", "album": "בין הים והביצות", "year": 1995},
    {"id": "s73", "artist": "רוקפור", "album": "האיש שראה הכל", "year": 1995},
    {"id": "s74", "artist": "ברי סחרוף", "album": "סימנים של חולשה", "year": 1993},
    {"id": "s75", "artist": "Gang of Four", "album": "Entertainment!", "year": 1979},
    {"id": "s76", "artist": "Can", "album": "Ege Bamyasi", "year": 1972},
    {"id": "s77", "artist": "Portishead", "album": "Dummy", "year": 1994},
    {"id": "s78", "artist": "Ween", "album": "The Mollusk", "year": 1997},
    {"id": "s79", "artist": "Pere Ubu", "album": "The Modern Dance", "year": 1978},
    {"id": "s80", "artist": "Shellac", "album": "At Action Park", "year": 1994},
    {"id": "s81", "artist": "Devo", "album": "Q: Are We Not Men? A: We Are Devo!", "year": 1978},
    {"id": "s82", "artist": "Syd Barrett", "album": "The Madcap Laughs", "year": 1970},
]

# ---- config (tweak if you like) ----
DEFAULT_SIZE       = 300          # cover pixel size to download (200-600 sensible)
COUNTRIES          = ["us", "il", "gb"]  # tried in order until a confident match
THROTTLE_SECONDS   = 3.2          # iTunes allows ~20 search calls/min; stay under it
ALBUM_MIN_RATIO    = 0.60         # fuzzy-match acceptance thresholds
ARTIST_MIN_RATIO   = 0.45
UA = "Mozilla/5.0 (haburah-cover-fetcher)"

MANUAL_DIR   = "covers_manual"
OVERRIDES    = "overrides.json"
OUT_JSON     = "covers.json"
OUT_REPORT   = "covers_report.txt"
OUT_MISSING  = "covers_missing.txt"

from difflib import SequenceMatcher


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9֐-׿]+", " ", s)  # keep latin, digits, hebrew
    return re.sub(r"\s+", " ", s).strip()


def ratio(a, b):
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def http_get(url, is_json=False, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                return json.loads(data.decode("utf-8")) if is_json else data
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 429):      # rate limited — back off
                time.sleep(20)
            else:
                break
        except Exception as e:
            last = e
            time.sleep(3)
    raise last if last else RuntimeError("request failed: " + url)


def upsize(art_url, size):
    # Apple artwork urls end in .../<N>x<N>bb.<ext>  — swap N for the size we want.
    return re.sub(r"/\d+x\d+bb", f"/{size}x{size}bb", art_url)


def mime_for(url):
    u = url.lower()
    if u.endswith(".png"):  return "image/png"
    if u.endswith(".webp"): return "image/webp"
    return "image/jpeg"


def to_data_uri(img_bytes, mime):
    return f"data:{mime};base64," + base64.b64encode(img_bytes).decode("ascii")


def itunes_best(artist, album, size):
    """Search iTunes across countries; return (data_uri, matched_name) or (None, None)."""
    term = f"{artist} {album}".strip()
    for country in COUNTRIES:
        q = urllib.parse.urlencode({
            "term": term, "media": "music", "entity": "album",
            "limit": 8, "country": country,
        })
        url = "https://itunes.apple.com/search?" + q
        time.sleep(THROTTLE_SECONDS)
        try:
            res = http_get(url, is_json=True)
        except Exception as e:
            print(f"      ! search error ({country}): {e}")
            continue
        best, best_score = None, 0.0
        for c in res.get("results", []):
            a_r = ratio(artist, c.get("artistName", ""))
            b_r = ratio(album,  c.get("collectionName", ""))
            score = b_r * 0.65 + a_r * 0.35
            if b_r >= ALBUM_MIN_RATIO and a_r >= ARTIST_MIN_RATIO and score > best_score:
                best, best_score = c, score
        if best and best.get("artworkUrl100"):
            try:
                art = upsize(best["artworkUrl100"], size)
                img = http_get(art)
                name = f'{best.get("artistName","?")} — {best.get("collectionName","?")} [{country}]'
                return to_data_uri(img, mime_for(art)), name
            except Exception as e:
                print(f"      ! artwork download failed: {e}")
    return None, None


def load_overrides():
    if os.path.exists(OVERRIDES):
        try:
            return json.load(open(OVERRIDES, encoding="utf-8"))
        except Exception as e:
            print(f"! could not read {OVERRIDES}: {e}")
    return {}


def manual_file(album_id):
    if not os.path.isdir(MANUAL_DIR):
        return None
    for ext in ("jpg", "jpeg", "png", "webp"):
        p = os.path.join(MANUAL_DIR, f"{album_id}.{ext}")
        if os.path.exists(p):
            return p
    return None


def patch_jsx(path, covers):
    src = open(path, encoding="utf-8").read()
    pat = re.compile(r"/\*__COVERS_START__\*/.*?/\*__COVERS_END__\*/", re.S)
    if not pat.search(src):
        print(f"! markers not found in {path}; skipping patch. "
              f"(Make sure it's the haburah.jsx that has the COVERS markers.)")
        return
    payload = "/*__COVERS_START__*/const COVERS = " + \
              json.dumps(covers, ensure_ascii=False) + ";/*__COVERS_END__*/"
    open(path + ".bak", "w", encoding="utf-8").write(src)
    open(path, "w", encoding="utf-8").write(pat.sub(lambda _: payload, src))
    print(f"✓ patched {path}  (backup: {path}.bak)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=DEFAULT_SIZE)
    ap.add_argument("--patch", metavar="haburah.jsx", default=None,
                    help="also inject covers into this artifact file")
    args = ap.parse_args()

    overrides = load_overrides()
    covers, report, missing = {}, [], []

    print(f"Fetching covers for {len(ALBUMS)} albums at {args.size}px "
          f"(~{len(ALBUMS)*THROTTLE_SECONDS/60:.0f} min, be patient)...\n")

    for i, al in enumerate(ALBUMS, 1):
        aid, artist, album = al["id"], al["artist"], al["album"]
        label = f'{artist} — {album}'
        print(f'[{i:>2}/{len(ALBUMS)}] {aid}  {label}')
        ov = overrides.get(aid, {})

        # 1) manual file wins
        mf = manual_file(aid)
        if mf:
            covers[aid] = to_data_uri(open(mf, "rb").read(), mime_for(mf))
            report.append(f"{aid}\tMANUAL\t{label}\t<- {mf}")
            print(f"      · manual file: {mf}")
            continue

        # 2) override direct url
        if ov.get("url"):
            try:
                covers[aid] = to_data_uri(http_get(ov["url"]), mime_for(ov["url"]))
                report.append(f"{aid}\tOVERRIDE-URL\t{label}\t<- {ov['url']}")
                print("      · override url")
                continue
            except Exception as e:
                print(f"      ! override url failed: {e}")

        # 3) iTunes search (optionally with an override term)
        s_artist = ov.get("term", artist) if "term" in ov else artist
        s_album  = "" if "term" in ov else album
        data_uri, matched = itunes_best(s_artist, s_album, args.size)
        if data_uri:
            covers[aid] = data_uri
            report.append(f"{aid}\tMATCH\t{label}\t=> {matched}")
            print(f"      · matched: {matched}")
        else:
            report.append(f"{aid}\tMISS\t{label}")
            missing.append(al)
            print("      · no confident match — needs a manual cover")

    json.dump(covers, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False)
    open(OUT_REPORT, "w", encoding="utf-8").write("\n".join(report) + "\n")
    with open(OUT_MISSING, "w", encoding="utf-8") as f:
        f.write("These albums have no cover yet. Drop an image at "
                f"{MANUAL_DIR}/<id>.jpg and re-run.\n\n")
        for al in missing:
            f.write(f'{al["id"]}\t{al["artist"]} — {al["album"]}\n')

    print(f"\nDone. {len(covers)} covers found, {len(missing)} missing.")
    print(f"  → {OUT_JSON}  (send this to Claude, or use --patch)")
    print(f"  → {OUT_REPORT}   (review the matches — check the tricky ones)")
    if missing:
        print(f"  → {OUT_MISSING}   ({len(missing)} to supply manually)")

    if args.patch:
        patch_jsx(args.patch, covers)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(1)
