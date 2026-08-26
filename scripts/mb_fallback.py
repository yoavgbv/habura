#!/usr/bin/env python3
"""Second-pass cover fetch for albums the iTunes Search API doesn't index
(a known gap for some major-label 90s catalogs, e.g. Nirvana/Pearl Jam/Pixies —
verified by hand, not a fuzzy-match tuning problem). Tries MusicBrainz release-group
search + the Cover Art Archive for each id still missing a cover, merges into
the existing covers.json/covers_report.txt/covers_missing.txt in place."""
import importlib.util
import json
import pathlib
import time
import urllib.parse
import urllib.request
import base64

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ROOT / "reference" / "files"

spec = importlib.util.spec_from_file_location("fetch_covers", ROOT / "reference" / "fetch_covers.py")
fetch_covers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_covers)
ALBUMS_BY_ID = {a["id"]: a for a in fetch_covers.ALBUMS}

UA = "habura-cover-fetcher/1.0 (personal project, non-commercial)"


def http_get(url, is_json=False, ua=UA, tries=3):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=20) as r:
                data = r.read()
                return json.loads(data.decode("utf-8")) if is_json else data
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                return None
            time.sleep(2)
        except Exception as e:
            last = e
            time.sleep(2)
    if isinstance(last, urllib.error.HTTPError) and last.code == 404:
        return None
    if last:
        print(f"      ! {last}")
    return None


def mb_release_group_id(artist, album):
    q = f'artist:"{artist}" AND releasegroup:"{album}"'
    url = "https://musicbrainz.org/ws/2/release-group/?" + urllib.parse.urlencode({
        "query": q, "fmt": "json", "limit": 3,
    })
    data = http_get(url, is_json=True)
    if not data:
        return None
    groups = data.get("release-groups", [])
    if not groups:
        return None
    return groups[0]["id"], groups[0].get("title", "?")


def caa_front(mbid, size=500):
    url = f"https://coverartarchive.org/release-group/{mbid}/front-{size}"
    return http_get(url)


def main():
    covers = json.loads((FILES / "covers.json").read_text(encoding="utf-8"))
    missing_ids = []
    for line in (FILES / "covers_missing.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("s") and "\t" in line:
            missing_ids.append(line.split("\t")[0])

    report_extra = []
    still_missing = []
    for aid in missing_ids:
        al = ALBUMS_BY_ID[aid]
        label = f'{al["artist"]} — {al["album"]}'
        print(f'{aid}  {label}')
        time.sleep(1.1)  # MusicBrainz: max ~1 req/sec unauthenticated
        found = mb_release_group_id(al["artist"], al["album"])
        if not found:
            print("      · no MusicBrainz match")
            still_missing.append(al)
            continue
        mbid, mb_title = found
        time.sleep(0.3)
        img = caa_front(mbid)
        if not img:
            print(f"      · MB matched '{mb_title}' but no cover art archived")
            still_missing.append(al)
            continue
        covers[aid] = "data:image/jpeg;base64," + base64.b64encode(img).decode("ascii")
        report_extra.append(f"{aid}\tMATCH-MB\t{label}\t=> {mb_title} [musicbrainz]")
        print(f"      · matched via MusicBrainz: {mb_title}")

    (FILES / "covers.json").write_text(json.dumps(covers, ensure_ascii=False), encoding="utf-8")
    with (FILES / "covers_report.txt").open("a", encoding="utf-8") as f:
        f.write("\n".join(report_extra) + ("\n" if report_extra else ""))
    with (FILES / "covers_missing.txt").open("w", encoding="utf-8") as f:
        f.write("These albums have no cover yet (checked iTunes + MusicBrainz/Cover Art "
                "Archive). Drop an image at covers_manual/<id>.jpg and re-run fetch_covers.py.\n\n")
        for al in still_missing:
            f.write(f'{al["id"]}\t{al["artist"]} — {al["album"]}\n')

    print(f"\nDone. {len(report_extra)} more covers found via MusicBrainz, {len(still_missing)} still missing.")


if __name__ == "__main__":
    main()
