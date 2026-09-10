/* ============================================================
   maze-algos.js  —  pure pathfinding, no DOM.
   Every algorithm takes a grid model and returns:
     { visited: [[index, side], ...], path: [index, ...] | null }
   side 0 = forward search, side 1 = backward search (bidirectional only)

   Grid model:
     cols, rows : integers
     blocked    : Uint8Array, 1 = wall
     cost       : Uint16Array, cost of ENTERING that cell (1 = normal)
     start, end : flat indices (r * cols + c)
   ============================================================ */
(function (global) {
    'use strict';

    /* ---------- binary min-heap (key = number, value = node index) ---------- */
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

    /* ---------- helpers ---------- */

    // Fills `out` with the walkable neighbours of idx, returns how many.
    function neighbors(idx, cols, rows, blocked, out) {
        const r = (idx / cols) | 0, c = idx - r * cols;
        let n = 0, i;
        if (r > 0) { i = idx - cols; if (!blocked[i]) out[n++] = i; }
        if (r < rows - 1) { i = idx + cols; if (!blocked[i]) out[n++] = i; }
        if (c > 0) { i = idx - 1; if (!blocked[i]) out[n++] = i; }
        if (c < cols - 1) { i = idx + 1; if (!blocked[i]) out[n++] = i; }
        return n;
    }

    function manhattan(a, b, cols) {
        const ar = (a / cols) | 0, ac = a - ar * cols;
        const br = (b / cols) | 0, bc = b - br * cols;
        return Math.abs(ar - br) + Math.abs(ac - bc);
    }

    // Total cost of a path = sum of entry costs of every cell after the start.
    function pathCost(path, cost) {
        if (!path) return null;
        let total = 0;
        for (let i = 1; i < path.length; i++) total += cost[path[i]];
        return total;
    }

    function buildPath(parent, start, end) {
        const path = [];
        let cur = end;
        while (cur !== -1) {
            path.push(cur);
            if (cur === start) break;
            cur = parent[cur];
        }
        if (path[path.length - 1] !== start) return null;
        path.reverse();
        return path;
    }

    /* ---------- 1. Breadth-First Search (ignores weights) ---------- */
    function bfs(g) {
        const { cols, rows, blocked, start, end } = g;
        const n = cols * rows;
        const parent = new Int32Array(n).fill(-1);
        const seen = new Uint8Array(n);
        const queue = new Int32Array(n);
        const nb = new Int32Array(4);
        const visited = [];
        let head = 0, tail = 0;

        queue[tail++] = start; seen[start] = 1;
        while (head < tail) {
            const cur = queue[head++];
            visited.push([cur, 0]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            const count = neighbors(cur, cols, rows, blocked, nb);
            for (let i = 0; i < count; i++) {
                const nx = nb[i];
                if (!seen[nx]) { seen[nx] = 1; parent[nx] = cur; queue[tail++] = nx; }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 2. Depth-First Search (no optimality guarantee) ---------- */
    function dfs(g) {
        const { cols, rows, blocked, start, end } = g;
        const n = cols * rows;
        const parent = new Int32Array(n).fill(-1);
        const done = new Uint8Array(n);
        const nb = new Int32Array(4);
        const visited = [];
        const stackNode = [start], stackFrom = [-1];

        while (stackNode.length) {
            const cur = stackNode.pop();
            const from = stackFrom.pop();
            if (done[cur]) continue;
            done[cur] = 1;
            parent[cur] = from;
            visited.push([cur, 0]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            const count = neighbors(cur, cols, rows, blocked, nb);
            for (let i = 0; i < count; i++) {
                if (!done[nb[i]]) { stackNode.push(nb[i]); stackFrom.push(cur); }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 3./4. Dijkstra and A* (weight-aware, both optimal) ---------- */
    // useH = false -> Dijkstra, true -> A* with Manhattan distance.
    function dijkstraLike(g, useH) {
        const { cols, rows, blocked, cost, start, end } = g;
        const n = cols * rows;
        const dist = new Float64Array(n).fill(Infinity);
        const parent = new Int32Array(n).fill(-1);
        const done = new Uint8Array(n);
        const nb = new Int32Array(4);
        const visited = [];
        const pq = new MinHeap();

        dist[start] = 0;
        pq.push(useH ? manhattan(start, end, cols) : 0, start);

        while (pq.size) {
            const cur = pq.pop();
            if (done[cur]) continue;
            done[cur] = 1;
            visited.push([cur, 0]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            const count = neighbors(cur, cols, rows, blocked, nb);
            for (let i = 0; i < count; i++) {
                const nx = nb[i];
                if (done[nx]) continue;
                const nd = dist[cur] + cost[nx];
                if (nd < dist[nx]) {
                    dist[nx] = nd;
                    parent[nx] = cur;
                    pq.push(useH ? nd + manhattan(nx, end, cols) : nd, nx);
                }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 5. Greedy Best-First (heuristic only, not optimal) ---------- */
    function greedy(g) {
        const { cols, rows, blocked, start, end } = g;
        const n = cols * rows;
        const parent = new Int32Array(n).fill(-1);
        const seen = new Uint8Array(n);
        const nb = new Int32Array(4);
        const visited = [];
        const pq = new MinHeap();

        seen[start] = 1;
        pq.push(manhattan(start, end, cols), start);

        while (pq.size) {
            const cur = pq.pop();
            visited.push([cur, 0]);
            if (cur === end) return { visited, path: buildPath(parent, start, end) };
            const count = neighbors(cur, cols, rows, blocked, nb);
            for (let i = 0; i < count; i++) {
                const nx = nb[i];
                if (!seen[nx]) {
                    seen[nx] = 1;
                    parent[nx] = cur;
                    pq.push(manhattan(nx, end, cols), nx);
                }
            }
        }
        return { visited, path: null };
    }

    /* ---------- 6./7./8. Bidirectional search ----------
       One engine covers bidirectional BFS, Dijkstra and A*.

       Edges are directed: entering cell v costs cost[v], so the reverse
       search leaving v towards u pays cost[v] as well.

       A* uses the balanced potential  p(v) = (h(v,end) - h(v,start)) / 2,
       which is consistent for both directions, so the classic stopping rule
           min(forward key) + min(backward key) >= mu
       stays valid (the potential terms cancel out).
         unit = true  -> every cell costs 1 (this is bidirectional BFS)
         useH = true  -> apply the balanced potential (bidirectional A*)
    ------------------------------------------------------------------- */
    function bidirectional(g, unit, useH) {
        const { cols, rows, blocked, cost, start, end } = g;
        const n = cols * rows;
        const w = unit ? null : cost;
        const enter = i => (w ? w[i] : 1);
        const pot = useH
            ? i => (manhattan(i, end, cols) - manhattan(i, start, cols)) / 2
            : () => 0;

        const distF = new Float64Array(n).fill(Infinity);
        const distB = new Float64Array(n).fill(Infinity);
        const parF = new Int32Array(n).fill(-1);
        const parB = new Int32Array(n).fill(-1);
        const doneF = new Uint8Array(n);
        const doneB = new Uint8Array(n);
        const pqF = new MinHeap(), pqB = new MinHeap();
        const nb = new Int32Array(4);
        const visited = [];

        if (start === end) return { visited: [[start, 0]], path: [start] };

        // The two frontiers meet on an EDGE, so remember both of its ends:
        // meetU is in the forward tree, meetV in the backward tree.
        let mu = Infinity, meetU = -1, meetV = -1;

        distF[start] = 0; pqF.push(pot(start), start);
        distB[end] = 0; pqB.push(-pot(end), end);

        while (pqF.size && pqB.size) {
            if (pqF.peekKey() + pqB.peekKey() >= mu) break;

            // Expand whichever frontier is currently cheaper to grow.
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
            visited.push([cur, forward ? 0 : 1]);

            const count = neighbors(cur, cols, rows, blocked, nb);
            for (let i = 0; i < count; i++) {
                const nx = nb[i];
                // Forward pays to enter nx; backward pays to leave cur.
                const step = forward ? enter(nx) : enter(cur);
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

        // Stitch: start .. meetU  +  meetV .. end
        const head = buildPath(parF, start, meetU);
        if (!head) return { visited, path: null };
        let cur = meetV;
        head.push(cur);
        while (cur !== end) {
            cur = parB[cur];
            if (cur === -1) return { visited, path: null };
            head.push(cur);
        }
        return { visited, path: head };
    }

    /* ---------- maze generator: recursive backtracker ----------
       Carves a perfect maze (exactly one route between any two cells)
       by walking to random unvisited cells two steps at a time and
       knocking out the wall in between. Returns a `blocked` array.
    ------------------------------------------------------------------- */
    function generateMaze(cols, rows, rnd) {
        rnd = rnd || Math.random;
        const n = cols * rows;
        const blocked = new Uint8Array(n).fill(1);
        const idx = (r, c) => r * cols + c;
        const inside = (r, c) => r > 0 && c > 0 && r < rows - 1 && c < cols - 1;

        const stack = [[1, 1]];
        blocked[idx(1, 1)] = 0;

        while (stack.length) {
            const [r, c] = stack[stack.length - 1];
            const options = [];
            const deltas = [[-2, 0], [2, 0], [0, -2], [0, 2]];
            for (const [dr, dc] of deltas) {
                const nr = r + dr, nc = c + dc;
                if (inside(nr, nc) && blocked[idx(nr, nc)]) options.push([nr, nc, r + dr / 2, c + dc / 2]);
            }
            if (!options.length) { stack.pop(); continue; }
            const [nr, nc, wr, wc] = options[Math.floor(rnd() * options.length)];
            blocked[idx(wr, wc)] = 0;
            blocked[idx(nr, nc)] = 0;
            stack.push([nr, nc]);
        }
        return blocked;
    }

    /* ---------- registry ---------- */
    const ALGORITHMS = {
        bfs: {
            label: 'Breadth-First Search (BFS)',
            note: 'Explores in rings. Fewest steps guaranteed — but it ignores mud, so it can return an expensive path.',
            run: bfs
        },
        dfs: {
            label: 'Depth-First Search (DFS)',
            note: 'Follows one corridor to the end before backtracking. Fast to write, no guarantee at all about the path it finds.',
            run: dfs
        },
        dijkstra: {
            label: "Dijkstra's Algorithm",
            note: 'Expands by cheapest cost so far. Always returns the cheapest path, mud included.',
            run: g => dijkstraLike(g, false)
        },
        astar: {
            label: 'A* Search',
            note: 'Dijkstra plus a Manhattan estimate of the distance left. Same optimal path, far fewer cells explored.',
            run: g => dijkstraLike(g, true)
        },
        greedy: {
            label: 'Greedy Best-First',
            note: 'Runs straight at the target using the heuristic alone. Very fast, frequently wrong.',
            run: greedy
        },
        bibfs: {
            label: 'Bidirectional BFS',
            note: 'Two BFS frontiers grow towards each other and meet in the middle. Same path as BFS, roughly half the cells.',
            run: g => bidirectional(g, true, false)
        },
        bidijkstra: {
            label: "Bidirectional Dijkstra",
            note: 'Two cost-driven frontiers meeting in the middle, stopping once no cheaper meeting point can exist.',
            run: g => bidirectional(g, false, false)
        },
        biastar: {
            label: 'Bidirectional A*',
            note: 'Both frontiers steered by a balanced heuristic. Usually the fewest cells explored of anything here.',
            run: g => bidirectional(g, false, true)
        }
    };

    const api = { ALGORITHMS, pathCost, manhattan, generateMaze, MinHeap };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.MazeAlgos = api;
})(typeof window !== 'undefined' ? window : globalThis);
