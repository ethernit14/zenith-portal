#!/usr/bin/env python3
"""
Bake city street networks into static JSON so maps.html doesn't have to hit the
Overpass API on every visit.

    python3 tools/fetch_city.py            # all cities (skips ones already done)
    python3 tools/fetch_city.py munich     # just one
    python3 tools/fetch_city.py --force    # re-download everything

Safe to re-run: cities already in data/ are skipped, so if Overpass rate-limits
you part way through, just run it again in a few minutes.

Writes data/<id>.json. maps.js tries that file first and only falls back to the
live API if it isn't there, so baking is purely an optimisation - nothing else
needs changing.

Standard library only, no pip install required. Be polite: Overpass is a free
volunteer-run service, so this sleeps between requests.
"""

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

# Must stay in sync with CITIES in maps.js. bbox = [south, west, north, east]
CITIES = {
    "kadikoy":   ([40.9775, 29.0019, 41.0015, 29.0531], False),
    "besiktas":  ([41.0305, 28.9768, 41.0545, 29.0282], False),
    "munich":    ([48.1265, 11.5470, 48.1505, 11.6050], False),
    "vienna":    ([48.1965, 16.3440, 48.2205, 16.4020], False),
    "karlsruhe": ([48.9995, 8.3705, 49.0235, 8.4295], False),
    "manhattan": ([40.6960, -74.0250, 40.8800, -73.9070], False),
    "london":    ([51.4975, -0.1571, 51.5215, -0.0949], False),
    "paris":     ([48.8465, 2.3151, 48.8705, 2.3739], False),
    "rome":      ([41.8875, 12.4520, 41.9115, 12.5040], False),
    "barcelona": ([41.3785, 2.1392, 41.4025, 2.1908], False),
    "venice":    ([45.4265, 12.3079, 45.4505, 12.3631], True),
    "tokyo":     ([35.6785, 139.6767, 35.7025, 139.7243], False),
}

DRIVE = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian"
WALK = DRIVE + "|footway|path|steps"

# Scenery. Seas are NOT polygons in OSM - they are natural=coastline lines,
# and map-geo.js rebuilds the water area from them.
LANDUSE = ("reservoir|basin|grass|forest|meadow|cemetery|village_green|"
           "recreation_ground|allotments|orchard")
LEISURE = "park|garden|golf_course|pitch"
KEEP_TAGS = ("highway", "maxspeed", "natural", "waterway",
             "landuse", "leisure", "railway")

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def query(bbox, walk):
    s, w, n, e = bbox
    kinds = WALK if walk else DRIVE
    box = f"{s},{w},{n},{e}"
    return (
        "[out:json][timeout:180];("
        f'way["highway"~"^({kinds})(_link)?$"]({box});'
        f'way["natural"~"^(water|coastline|bay)$"]({box});'
        f'way["waterway"="riverbank"]({box});'
        f'way["landuse"~"^({LANDUSE})$"]({box});'
        f'way["leisure"~"^({LEISURE})$"]({box});'
        f'way["railway"~"^(rail|light_rail)$"]({box});'
        f'relation["natural"="water"]({box});'
        f'relation["waterway"="riverbank"]({box});'
        f'relation["leisure"="park"]({box});'
        # ">>" also pulls the member ways of multipolygon relations, not just nodes
        ");(._;>>;);out body qt;"
    )


# Overpass is free and volunteer-run. 429 (rate limited) and 504 (server busy)
# are normal, not bugs - the fix is to wait and try again, not to give up.
BACKOFF = [15, 45, 90, 180]


def fetch(bbox, walk):
    data = urllib.parse.urlencode({"data": query(bbox, walk)}).encode()
    last = None
    for attempt, wait in enumerate(BACKOFF, start=1):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(
                    url, data=data,
                    headers={"User-Agent": "zenith-portal-route-finder/1.0"},
                )
                with urllib.request.urlopen(req, timeout=300) as resp:
                    return json.loads(resp.read().decode())
            except Exception as err:   # noqa: BLE001 - any failure, try the next mirror
                last = err
                host = url.split("/")[2]
                print(f"    {host} failed: {err}")
        if attempt < len(BACKOFF):
            print(f"    both mirrors busy - waiting {wait}s before retry "
                  f"{attempt + 1}/{len(BACKOFF)}")
            time.sleep(wait)
    raise SystemExit(
        f"all Overpass mirrors failed after {len(BACKOFF)} attempts: {last}\n"
        "Already-downloaded cities are kept - just run the script again later "
        "and it will resume where it stopped."
    )


# Overpass returns whole ways, so a single coastline can drag in the entire
# lagoon or coastline of a country. Keep only the parts near our box.
MARGIN = 0.25          # fraction of the bbox size to keep as context


def expand(bbox):
    s, w, n, e = bbox
    dy, dx = (n - s) * MARGIN, (e - w) * MARGIN
    return (s - dy, w - dx, n + dy, e + dx)


def clip_ways(elements, bbox):
    """Split open ways into the runs that come near the box; drop the rest.

    Closed ways (park and lake polygons) are never split - a half a polygon is
    not a polygon - so they are kept whole or dropped whole. Relation members
    are also kept whole, because their rings get reassembled in the browser.
    """
    box = expand(bbox)
    coords = {e["id"]: (e["lat"], e["lon"])
              for e in elements if e["type"] == "node"}
    protected = set()
    for el in elements:
        if el["type"] == "relation":
            protected.update(m["ref"] for m in el["members"])

    def near(a, b):
        (la1, lo1), (la2, lo2) = coords[a], coords[b]
        return (max(la1, la2) >= box[0] and min(la1, la2) <= box[2] and
                max(lo1, lo2) >= box[1] and min(lo1, lo2) <= box[3])

    def inside(nid):
        la, lo = coords[nid]
        return box[0] <= la <= box[2] and box[1] <= lo <= box[3]

    next_id = max((e["id"] for e in elements), default=0) + 1
    out = []
    for el in elements:
        if el["type"] != "way":
            out.append(el)
            continue
        nodes = [n for n in el["nodes"] if n in coords]
        if len(nodes) < 2:
            continue
        closed = len(nodes) > 3 and nodes[0] == nodes[-1]
        if closed or el["id"] in protected:
            if any(inside(n) for n in nodes):
                out.append({**el, "nodes": nodes})
            continue
        runs, cur = [], []
        for k in range(len(nodes) - 1):
            if near(nodes[k], nodes[k + 1]):
                if not cur:
                    cur = [nodes[k]]
                cur.append(nodes[k + 1])
            elif cur:
                runs.append(cur)
                cur = []
        if cur:
            runs.append(cur)
        for j, run in enumerate(runs):
            if j == 0:
                out.append({**el, "nodes": run})
            else:
                out.append({**el, "id": next_id, "nodes": run})
                next_id += 1

    used = {n for e in out if e["type"] == "way" for n in e["nodes"]}
    return [e for e in out if e["type"] != "node" or e["id"] in used]


# Most nodes in OSM are shape points tracing a curve, not junctions. Dropping
# the ones that barely bend the line costs nothing visually and buys us a much
# bigger map for the same download. Junctions are never touched - removing one
# would tear the road graph apart.
SIMPLIFY_M = 3.0        # max deviation allowed, in metres
# Big areas are drawn zoomed out, so they can take a coarser tolerance.
SIMPLIFY_OVERRIDE = {"manhattan": 9.0}


def _rdp(pts, tol, kx):
    """Ramer-Douglas-Peucker on (lat, lon), lon scaled by cos(lat)."""
    if len(pts) < 3:
        return pts
    (y0, x0), (y1, x1) = pts[0], pts[-1]
    dy, dx = y1 - y0, (x1 - x0) * kx
    span = (dy * dy + dx * dx) ** 0.5
    worst, wi = -1.0, 0
    for i in range(1, len(pts) - 1):
        y, x = pts[i]
        ey, ex = y - y0, (x - x0) * kx
        if span < 1e-12:
            d = (ey * ey + ex * ex) ** 0.5
        else:
            d = abs(ex * dy - ey * dx) / span
        if d > worst:
            worst, wi = d, i
    if worst <= tol:
        return [pts[0], pts[-1]]
    return _rdp(pts[:wi + 1], tol, kx)[:-1] + _rdp(pts[wi:], tol, kx)


def simplify_ways(elements, bbox, tol_m=SIMPLIFY_M):
    coords = {e["id"]: (e["lat"], e["lon"])
              for e in elements if e["type"] == "node"}
    lat0 = (bbox[0] + bbox[2]) / 2
    kx = math.cos(math.radians(lat0))
    tol = tol_m / 111320.0               # metres -> degrees of latitude

    # a node shared by two ways is a junction: it must survive
    seen, junction = set(), set()
    for el in elements:
        if el["type"] != "way":
            continue
        for n in set(el["nodes"]):
            if n in seen:
                junction.add(n)
            seen.add(n)
        junction.add(el["nodes"][0])
        junction.add(el["nodes"][-1])
    for el in elements:
        if el["type"] == "relation":
            for m in el["members"]:
                junction.add(m["ref"])

    out = []
    for el in elements:
        if el["type"] != "way":
            out.append(el)
            continue
        nodes = el["nodes"]
        anchors = [i for i, n in enumerate(nodes) if n in junction]
        if len(nodes) > 3 and nodes[0] == nodes[-1] and len(anchors) < 3:
            anchors = sorted(set(anchors + [len(nodes) // 2]))   # keep rings open-able
        if anchors[0] != 0:
            anchors.insert(0, 0)
        if anchors[-1] != len(nodes) - 1:
            anchors.append(len(nodes) - 1)

        kept = [nodes[0]]
        for a, b in zip(anchors, anchors[1:]):
            run = nodes[a:b + 1]
            if len(run) > 2:
                pts = [coords[n] for n in run]
                keepset = {(round(y, 9), round(x, 9)) for y, x in _rdp(pts, tol, kx)}
                run = [run[0]] + [n for n in run[1:-1]
                                  if (round(coords[n][0], 9), round(coords[n][1], 9)) in keepset] + [run[-1]]
            kept.extend(run[1:])
        out.append({**el, "nodes": kept})

    used = {n for e in out if e["type"] == "way" for n in e["nodes"]}
    return [e for e in out if e["type"] != "node" or e["id"] in used]


def trim(osm):
    """Drop everything maps.js doesn't read. Usually shrinks the file by ~70%."""
    out = []
    for el in osm.get("elements", []):
        kind = el.get("type")
        if kind == "node":
            # 6 decimals is about 11 cm - far more than enough, and much smaller
            out.append({"type": "node", "id": el["id"],
                        "lat": round(el["lat"], 6), "lon": round(el["lon"], 6)})
        elif kind == "way" and el.get("nodes"):
            tags = el.get("tags") or {}
            keep = {k: tags[k] for k in KEEP_TAGS if k in tags}
            # Untagged ways still matter: they are the members of multipolygon
            # relations (river banks, parks with holes), so keep them all.
            out.append({"type": "way", "id": el["id"],
                        "nodes": el["nodes"], "tags": keep})
        elif kind == "relation" and el.get("members"):
            tags = el.get("tags") or {}
            keep = {k: tags[k] for k in KEEP_TAGS if k in tags}
            if not keep:
                continue
            members = [{"type": m["type"], "ref": m["ref"], "role": m.get("role", "")}
                       for m in el["members"] if m.get("type") == "way"]
            if not members:
                continue
            out.append({"type": "relation", "id": el["id"],
                        "members": members, "tags": keep})
    return {"elements": out}


def main():
    args = sys.argv[1:]
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    wanted = args or list(CITIES)
    unknown = [c for c in wanted if c not in CITIES]
    if unknown:
        raise SystemExit(f"unknown city id(s): {', '.join(unknown)}\n"
                         f"known: {', '.join(CITIES)}")

    os.makedirs("data", exist_ok=True)

    # Resume: skip cities already on disk unless --force is given.
    if not force:
        done = [c for c in wanted if os.path.exists(os.path.join("data", f"{c}.json"))]
        if done:
            print(f"Already downloaded, skipping: {', '.join(done)}")
            print("(use --force to re-download them)\n")
        wanted = [c for c in wanted if c not in done]
    if not wanted:
        print("Nothing to do - every requested city is already in data/.")
        return

    for i, city in enumerate(wanted):
        bbox, walk = CITIES[city]
        print(f"[{i + 1}/{len(wanted)}] {city} ...")
        raw = trim(fetch(bbox, walk))
        kept = clip_ways(raw["elements"], bbox)
        baked = {"elements": simplify_ways(
            kept, bbox, SIMPLIFY_OVERRIDE.get(city, SIMPLIFY_M))}
        path = os.path.join("data", f"{city}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(baked, fh, separators=(",", ":"))
        nodes = sum(1 for e in baked["elements"] if e["type"] == "node")
        ways = sum(1 for e in baked["elements"] if e["type"] == "way")
        rels = sum(1 for e in baked["elements"] if e["type"] == "relation")
        size = os.path.getsize(path) / 1024
        print(f"    {nodes} nodes, {ways} ways, {rels} relations -> {path} ({size:.0f} KB)")
        if i + 1 < len(wanted):
            time.sleep(8)          # don't hammer a free volunteer service

    print("\nDone. Commit the data/ folder and the pages will load instantly.")
    print("Remember: OpenStreetMap data is ODbL - keep the attribution link on the page.")


if __name__ == "__main__":
    main()
