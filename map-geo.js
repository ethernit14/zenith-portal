/* ============================================================
   map-geo.js — geometry helpers for the map renderer. No DOM.

   The interesting one is coastlineWater(). OpenStreetMap does not store
   "the sea" as a polygon; it stores natural=coastline ways with the
   convention that LAND IS ON THE LEFT of the way's direction. To paint
   water you therefore have to:
     1. clip the coastline chains to your bounding box,
     2. walk clockwise around the box edge from where a chain leaves to
        where the next one enters (clockwise in lat/lon keeps the enclosed
        area on the right of travel, which is the water side),
     3. close the ring.
   Closed coastline rings are islands and come back as holes.

   All coordinates are [lat, lon] pairs.
   ============================================================ */
(function (global) {
    'use strict';

    /* ---------- join way fragments into longer chains ---------- */
    // ways: [{ nodes: [id...], geom: [[lat,lon]...] }]
    //
    // allowReverse matters. Multipolygon relations store their member ways in
    // arbitrary directions, so closing a ring REQUIRES flipping some of them.
    // Coastlines are the opposite: direction encodes which side is land, so
    // reversing one would put the sea on the wrong side of the shore.
    function joinWays(ways, allowReverse) {
        const usable = [];
        ways.forEach(w => {
            if (w.nodes && w.nodes.length >= 2 && w.geom && w.geom.length >= 2) usable.push(w);
        });

        const ends = new Map();          // node id -> [indices of ways touching it]
        const touch = (id, i) => {
            if (!ends.has(id)) ends.set(id, []);
            ends.get(id).push(i);
        };
        usable.forEach((w, i) => {
            touch(w.nodes[0], i);
            if (allowReverse) touch(w.nodes[w.nodes.length - 1], i);
        });

        const used = new Uint8Array(usable.length);
        const chains = [];

        for (let seed = 0; seed < usable.length; seed++) {
            if (used[seed]) continue;
            used[seed] = 1;
            const nodes = usable[seed].nodes.slice();
            const geom = usable[seed].geom.slice();

            for (;;) {
                const tail = nodes[nodes.length - 1];
                const candidates = ends.get(tail);
                if (!candidates) break;
                let next = -1;
                for (const i of candidates) { if (!used[i]) { next = i; break; } }
                if (next === -1) break;

                const w = usable[next];
                used[next] = 1;
                if (w.nodes[0] === tail) {
                    nodes.push(...w.nodes.slice(1));
                    geom.push(...w.geom.slice(1));
                } else {
                    // joins the other way round, so walk it backwards
                    nodes.push(...w.nodes.slice(0, -1).reverse());
                    geom.push(...w.geom.slice(0, -1).reverse());
                }
            }
            chains.push({ nodes, geom, closed: nodes[0] === nodes[nodes.length - 1] });
        }
        return chains;
    }

    /* ---------- clip a polyline to the box ---------- */
    function makeBox(bbox) {
        const [S, W, N, E] = bbox;
        return {
            S, W, N, E,
            inside: p => p[0] >= S && p[0] <= N && p[1] >= W && p[1] <= E
        };
    }

    // Where does the segment a->b cross the box edge? Returns the parameter
    // range [t0, t1] of the part inside the box, or null (Liang-Barsky).
    function segmentInside(a, b, box) {
        const dx = b[1] - a[1], dy = b[0] - a[0];
        let t0 = 0, t1 = 1;
        const tests = [
            [-dx, a[1] - box.W], [dx, box.E - a[1]],
            [-dy, a[0] - box.S], [dy, box.N - a[0]]
        ];
        for (const [p, q] of tests) {
            if (p === 0) { if (q < 0) return null; continue; }
            const r = q / p;
            if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
            else { if (r < t0) return null; if (r < t1) t1 = r; }
        }
        return [t0, t1];
    }

    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

    // Split a chain into the pieces of it that lie inside the box.
    function clipChain(geom, box) {
        const pieces = [];
        let current = null;
        for (let i = 1; i < geom.length; i++) {
            const a = geom[i - 1], b = geom[i];
            const range = segmentInside(a, b, box);
            if (!range) { if (current) { pieces.push(current); current = null; } continue; }
            const [t0, t1] = range;
            const p0 = t0 === 0 ? a : lerp(a, b, t0);
            const p1 = t1 === 1 ? b : lerp(a, b, t1);
            if (!current) current = [p0];
            current.push(p1);
            if (t1 < 1) { pieces.push(current); current = null; }   // left the box here
        }
        if (current) pieces.push(current);
        return pieces.filter(p => p.length >= 2);
    }

    /* ---------- position along the box perimeter, clockwise from NW ---------- */
    // t in [0,4): 0-1 top edge W->E, 1-2 right edge N->S, 2-3 bottom E->W,
    // 3-4 left edge S->N. Clockwise in lat/lon = enclosed area on the right.
    function perimeterT(p, box) {
        const eps = 1e-9;
        const { S, W, N, E } = box;
        const dLon = E - W, dLat = N - S;
        if (Math.abs(p[0] - N) < eps * dLat + 1e-12) return (p[1] - W) / dLon;
        if (Math.abs(p[1] - E) < eps * dLon + 1e-12) return 1 + (N - p[0]) / dLat;
        if (Math.abs(p[0] - S) < eps * dLat + 1e-12) return 2 + (E - p[1]) / dLon;
        if (Math.abs(p[1] - W) < eps * dLon + 1e-12) return 3 + (p[0] - S) / dLat;
        // not exactly on an edge: snap to the nearest one
        const d = [
            [Math.abs(p[0] - N), (p[1] - W) / dLon],
            [Math.abs(p[1] - E), 1 + (N - p[0]) / dLat],
            [Math.abs(p[0] - S), 2 + (E - p[1]) / dLon],
            [Math.abs(p[1] - W), 3 + (p[0] - S) / dLat]
        ].sort((x, y) => x[0] - y[0]);
        return d[0][1];
    }

    function cornersBetween(from, to, box) {
        const { S, W, N, E } = box;
        const CORNER = [[N, W], [N, E], [S, E], [S, W]];   // t = 0, 1, 2, 3
        const out = [];
        let t = Math.ceil(from + 1e-12);
        let span = to - from;
        if (span < 0) span += 4;
        for (let step = 0; step < 4; step++) {
            let rel = t - from;
            if (rel < 0) rel += 4;
            if (rel > span) break;
            out.push(CORNER[((t % 4) + 4) % 4]);
            t += 1;
        }
        return out;
    }

    /* ---------- coastline -> water rings ---------- */
    function coastlineWater(chains, bbox) {
        const box = makeBox(bbox);
        const open = [];        // pieces that touch the box edge
        const islands = [];     // closed rings fully inside -> holes

        for (const chain of chains) {
            for (const piece of clipChain(chain.geom, box)) {
                const first = piece[0], last = piece[piece.length - 1];
                const closed = Math.abs(first[0] - last[0]) < 1e-12 &&
                    Math.abs(first[1] - last[1]) < 1e-12;
                if (closed) islands.push(piece);
                else open.push({
                    points: piece,
                    tIn: perimeterT(first, box),
                    tOut: perimeterT(last, box),
                    used: false
                });
            }
        }

        const rings = [];
        open.sort((a, b) => a.tIn - b.tIn);

        for (const seed of open) {
            if (seed.used) continue;
            const ring = [];
            let cur = seed;
            for (let guard = 0; guard <= open.length; guard++) {
                cur.used = true;
                ring.push(...cur.points);
                // walk clockwise along the edge to whichever chain starts next
                let best = null, bestGap = Infinity;
                for (const cand of open) {
                    if (cand.used && cand !== seed) continue;
                    let gap = cand.tIn - cur.tOut;
                    if (gap < -1e-12) gap += 4;
                    if (gap < bestGap) { bestGap = gap; best = cand; }
                }
                if (!best) break;
                ring.push(...cornersBetween(cur.tOut, best.tIn, box));
                if (best === seed) break;
                cur = best;
            }
            if (ring.length >= 3) rings.push(ring);
        }

        return { water: rings, islands };
    }

    /* ---------- multipolygon relations (rivers, lakes, parks) ---------- */
    // members: [{ role: 'outer'|'inner', nodes, geom }]
    function assembleRings(members) {
        // reversal allowed: ring members come in mixed directions
        const outer = joinWays(members.filter(m => m.role !== 'inner'), true);
        const inner = joinWays(members.filter(m => m.role === 'inner'), true);
        // an unclosed ring is a broken ring - filling it paints nonsense
        const ringsOf = list => list.filter(c => c.closed && c.geom.length >= 4).map(c => c.geom);
        return { outer: ringsOf(outer), inner: ringsOf(inner) };
    }

    const api = { joinWays, clipChain, coastlineWater, assembleRings, perimeterT, makeBox };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.MapGeo = api;
})(typeof window !== 'undefined' ? window : globalThis);
