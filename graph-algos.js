/* ============================================================
   graph-algos.js — the same eight searches as the maze page, but on a
   general weighted graph instead of a grid. No DOM access.

   Graph model (compressed sparse row):
     n              node count
     lat, lon       Float64Array(n)      position of each node
     offset         Int32Array(n + 1)    offset[i]..offset[i+1] = edges of i
     target         Int32Array(m)        neighbour on the other end
     weight         Float64Array(m)      edge cost (metres, or seconds)
     heurDiv        divide haversine metres by this to stay admissible
                    (1 for distance, max speed in m/s for travel time)

   Edges are stored in both directions, so the reverse graph is the same
   graph — which is what lets the bidirectional searches share this data.

   Every algorithm returns:
     { visited: [[node, side, from], ...], path: [node, ...] | null }
   `from` is the node the search arrived from, so the renderer can draw
   the edge rather than the point. side 0 = forward, 1 = backward.
   ============================================================ */
(function (global) {
    'use strict';

    class MinHeap {
        constructor() { this.k = []; this.v = []; }
        get size() { return this.k.length; }
        peekKey() { return this.k.length ? this.k[0] : Infinity; }
        push(key, val) {
            const k = this.k, v = this.v;
            k.push(key); v.push(val);
            let i = k.length - 1;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (k[p] <= k[i]) break;
                const tk = k[p]; k[p] = k[i]; k[i] = tk;
                const tv = v[p]; v[p] = v[i]; v[i] = tv;
                i = p;
            }
        }
        pop() {
            const k = this.k, v = this.v;
            const top = v[0];
            const lk = k.pop(), lv = v.pop();
            if (k.length) {
                k[0] = lk; v[0] = lv;
                let i = 0;
                for (;;) {
                    const l = 2 * i + 1, r = l + 1;
                    let m = i;
                    if (l < k.length && k[l] < k[m]) m = l;
                    if (r < k.length && k[r] < k[m]) m = r;
                    if (m === i) break;
                    const tk = k[m]; k[m] = k[i]; k[i] = tk;
                    const tv = v[m]; v[m] = v[i]; v[i] = tv;
                    i = m;
                }
            }
            return top;
        }
    }

    const R_EARTH = 6371000;
    const RAD = Math.PI / 180;

    // Great-circle distance in metres. Manhattan distance is meaningless on a
    // sphere, so this replaces the maze's heuristic entirely.
    function haversine(lat1, lon1, lat2, lon2) {
        const dLat = (lat2 - lat1) * RAD;
        const dLon = (lon2 - lon1) * RAD;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
        return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    function makeHeuristic(g, to) {
        const { lat, lon, heurDiv } = g;
        const tLat = lat[to], tLon = lon[to];
        return i => haversine(lat[i], lon[i], tLat, tLon) / heurDiv;
    }

    function buildPath(parent, start, end) {
        const path = [];
        let cur = end;
        for (let guard = 0; guard <= parent.length; guard++) {
            path.push(cur);
            if (cur === start) { path.reverse(); return path; }
            cur = parent[cur];
            if (cur === -1) return null;
        }
        return null;
    }

    function pathCost(g, path) {
        if (!path) return null;
        let total = 0;
        for (let i = 1; i < path.length; i++) {
            const u = path[i - 1], v = path[i];
            let best = Infinity;
            for (let e = g.offset[u]; e < g.offset[u + 1]; e++) {
                if (g.target[e] === v && g.weight[e] < best) best = g.weight[e];
            }
            if (best === Infinity) return null;
            total += best;
        }
        return total;
    }

    /* ---------- 1. BFS — fewest intersections, ignores edge weights ---------- */
    function bfs(g) {
        const { n, offset, target, start, end } = g;
        const parent = new Int32Array(n).fill(-1);
        const seen = new Uint8Array(n);
        const queue = new Int32Array(n);
        const visited = [];
        let head = 0, tail = 0;

        queue[tail++] = start; seen[start] = 1;
        while (head < tail) {
            const cur = queue[head++];
            visited.push([cur, 0, parent[cur]]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            for (let e = offset[cur]; e < offset[cur + 1]; e++) {
                const nx = target[e];
                if (!seen[nx]) { seen[nx] = 1; parent[nx] = cur; queue[tail++] = nx; }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 2. DFS — no guarantee whatsoever ---------- */
    function dfs(g) {
        const { n, offset, target, start, end } = g;
        const parent = new Int32Array(n).fill(-1);
        const done = new Uint8Array(n);
        const visited = [];
        const stackNode = [start], stackFrom = [-1];

        while (stackNode.length) {
            const cur = stackNode.pop();
            const from = stackFrom.pop();
            if (done[cur]) continue;
            done[cur] = 1;
            parent[cur] = from;
            visited.push([cur, 0, from]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            for (let e = offset[cur]; e < offset[cur + 1]; e++) {
                if (!done[target[e]]) { stackNode.push(target[e]); stackFrom.push(cur); }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 3./4. Dijkstra and A* ---------- */
    function dijkstraLike(g, useH) {
        const { n, offset, target, weight, start, end } = g;
        const dist = new Float64Array(n).fill(Infinity);
        const parent = new Int32Array(n).fill(-1);
        const done = new Uint8Array(n);
        const visited = [];
        const pq = new MinHeap();
        const h = useH ? makeHeuristic(g, end) : null;

        dist[start] = 0;
        pq.push(useH ? h(start) : 0, start);

        while (pq.size) {
            const cur = pq.pop();
            if (done[cur]) continue;
            done[cur] = 1;
            visited.push([cur, 0, parent[cur]]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            for (let e = offset[cur]; e < offset[cur + 1]; e++) {
                const nx = target[e];
                if (done[nx]) continue;
                const nd = dist[cur] + weight[e];
                if (nd < dist[nx]) {
                    dist[nx] = nd;
                    parent[nx] = cur;
                    pq.push(useH ? nd + h(nx) : nd, nx);
                }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 5. Greedy best-first ---------- */
    function greedy(g) {
        const { n, offset, target, start, end } = g;
        const parent = new Int32Array(n).fill(-1);
        const seen = new Uint8Array(n);
        const visited = [];
        const pq = new MinHeap();
        const h = makeHeuristic(g, end);

        seen[start] = 1;
        pq.push(h(start), start);
        while (pq.size) {
            const cur = pq.pop();
            visited.push([cur, 0, parent[cur]]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            for (let e = offset[cur]; e < offset[cur + 1]; e++) {
                const nx = target[e];
                if (!seen[nx]) { seen[nx] = 1; parent[nx] = cur; pq.push(h(nx), nx); }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 6./7./8. Bidirectional ----------
       Same engine as the maze page. A* uses the balanced potential
       p(v) = (h(v,end) - h(v,start)) / 2, consistent in both directions,
       so the stopping rule  topF + topR >= mu  stays valid.
    ------------------------------------------------------------------- */
    function bidirectional(g, unit, useH) {
        const { n, offset, target, weight, start, end } = g;
        if (start === end) return { visited: [[start, 0, -1]], path: [start] };

        const hEnd = makeHeuristic(g, end);
        const hStart = makeHeuristic(g, start);
        const pot = useH ? (i => (hEnd(i) - hStart(i)) / 2) : (() => 0);
        const w = unit ? () => 1 : e => weight[e];

        const distF = new Float64Array(n).fill(Infinity);
        const distB = new Float64Array(n).fill(Infinity);
        const parF = new Int32Array(n).fill(-1);
        const parB = new Int32Array(n).fill(-1);
        const doneF = new Uint8Array(n);
        const doneB = new Uint8Array(n);
        const pqF = new MinHeap(), pqB = new MinHeap();
        const visited = [];

        let mu = Infinity, meetU = -1, meetV = -1;

        distF[start] = 0; pqF.push(pot(start), start);
        distB[end] = 0; pqB.push(-pot(end), end);

        while (pqF.size && pqB.size) {
            if (pqF.peekKey() + pqB.peekKey() >= mu) break;

            const forward = pqF.size <= pqB.size;
            const pq = forward ? pqF : pqB;
            const dist = forward ? distF : distB;
            const other = forward ? distB : distF;
            const done = forward ? doneF : doneB;
            const par = forward ? parF : parB;
            const sign = forward ? 1 : -1;

            const cur = pq.pop();
            if (done[cur]) continue;
            done[cur] = 1;
            visited.push([cur, forward ? 0 : 1, par[cur]]);

            for (let e = offset[cur]; e < offset[cur + 1]; e++) {
                const nx = target[e];
                const step = w(e);
                const nd = dist[cur] + step;
                if (nd < dist[nx]) {
                    dist[nx] = nd;
                    par[nx] = cur;
                    pq.push(nd + sign * pot(nx), nx);
                }
                if (other[nx] < Infinity && dist[cur] + step + other[nx] < mu) {
                    mu = dist[cur] + step + other[nx];
                    meetU = forward ? cur : nx;   // reached from start
                    meetV = forward ? nx : cur;   // reaches the end
                }
            }
        }

        if (meetU === -1) return { visited, path: null };
        const head = buildPath(parF, start, meetU);
        if (!head) return { visited, path: null };
        let cur = meetV;
        head.push(cur);
        for (let guard = 0; cur !== end; guard++) {
            if (guard > n) return { visited, path: null };
            cur = parB[cur];
            if (cur === -1) return { visited, path: null };
            head.push(cur);
        }
        return { visited, path: head };
    }

    const ALGORITHMS = {
        bfs: {
            label: 'Breadth-First Search',
            note: 'Fewest intersections, not the shortest drive — it has no idea some roads are longer than others.',
            run: bfs
        },
        dfs: {
            label: 'Depth-First Search',
            note: 'Charges down one street until it dead-ends, then backs up. On a real city this is spectacularly bad.',
            run: dfs
        },
        dijkstra: {
            label: "Dijkstra",
            note: 'Expands outwards by true cost. Always optimal, but it explores in every direction — including away from the target.',
            run: g => dijkstraLike(g, false)
        },
        astar: {
            label: 'A*',
            note: 'Dijkstra guided by great-circle distance to the target. Same route, a fraction of the city searched.',
            run: g => dijkstraLike(g, true)
        },
        greedy: {
            label: 'Greedy Best-First',
            note: 'Always heads towards the target as the crow flies. Gets trapped by rivers, parks and dead ends.',
            run: greedy
        },
        bibfs: {
            label: 'Bidirectional BFS',
            note: 'Two hop-counting frontiers meeting in the middle. Two small circles beat one big one.',
            run: g => bidirectional(g, true, false)
        },
        bidijkstra: {
            label: "Bidirectional Dijkstra",
            note: 'The classic road-routing baseline: search from both ends, stop when no cheaper meeting point can exist.',
            run: g => bidirectional(g, false, false)
        },
        biastar: {
            label: 'Bidirectional A*',
            note: 'Both frontiers steered by a balanced heuristic. The direct ancestor of what real routing engines do.',
            run: g => bidirectional(g, false, true)
        }
    };

    const api = { ALGORITHMS, haversine, pathCost, MinHeap };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.GraphAlgos = api;
})(typeof window !== 'undefined' ? window : globalThis);
