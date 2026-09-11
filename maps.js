/* ============================================================
   maps.js — real street networks from OpenStreetMap.
   Algorithms: graph-algos.js   Geometry: map-geo.js
   ============================================================ */
(function () {
    'use strict';

    const canvas = document.getElementById('mapCanvas');
    if (!canvas) return;

    // Failing silently here leaves an empty page with no clue why, so say
    // exactly which script is missing.
    const missing = [];
    if (!window.GraphAlgos) missing.push('graph-algos.js');
    if (!window.MapGeo) missing.push('map-geo.js');
    if (missing.length) {
        const el = document.getElementById('mapStatus');
        if (el) el.textContent = 'Could not start: ' + missing.join(' and ') +
            ' did not load. Check the file is present and reload.';
        console.error('maps.js needs these and could not find them:', missing);
        return;
    }

    const { ALGORITHMS, haversine } = window.GraphAlgos;
    const { joinWays, coastlineWater, assembleRings } = window.MapGeo;
    const ctx = canvas.getContext('2d');

    const citySel = document.getElementById('mapCity');
    const algoSel = document.getElementById('mapAlgo');
    const weightSel = document.getElementById('mapWeight');
    const speedSel = document.getElementById('mapSpeed');
    const noteEl = document.getElementById('mapAlgoNote');
    const statusEl = document.getElementById('mapStatus');
    const statsEl = document.getElementById('mapStats');
    const runBtn = document.getElementById('mapRun');
    const clearBtn = document.getElementById('mapClear');
    const randomBtn = document.getElementById('mapRandom');
    const modeBtns = {
        start: document.getElementById('mapModeStart'),
        end: document.getElementById('mapModeEnd')
    };

    /* ---------------- cities ---------------- */
    const CITIES = {
        kadikoy: { name: 'Istanbul · Kadıköy', bbox: [40.9775, 29.0019, 41.0015, 29.0531] },
        besiktas: { name: 'Istanbul · Beşiktaş', bbox: [41.0305, 28.9768, 41.0545, 29.0282] },
        munich: { name: 'Munich · Altstadt', bbox: [48.1265, 11.5470, 48.1505, 11.6050] },
        vienna: { name: 'Vienna · Innere Stadt', bbox: [48.1965, 16.3440, 48.2205, 16.4020] },
        karlsruhe: { name: 'Karlsruhe · Fächerstadt', bbox: [48.9995, 8.3705, 49.0235, 8.4295] },
        manhattan: { name: 'New York · Manhattan', bbox: [40.6960, -74.0250, 40.8800, -73.9070] },
        london: { name: 'London · Westminster', bbox: [51.4975, -0.1571, 51.5215, -0.0949] },
        paris: { name: 'Paris · Île de la Cité', bbox: [48.8465, 2.3151, 48.8705, 2.3739] },
        rome: { name: 'Rome · Centro Storico', bbox: [41.8875, 12.4520, 41.9115, 12.5040] },
        barcelona: { name: 'Barcelona · Eixample', bbox: [41.3785, 2.1392, 41.4025, 2.1908] },
        venice: { name: 'Venice · San Marco', bbox: [45.4265, 12.3079, 45.4505, 12.3631], walk: true },
        tokyo: { name: 'Tokyo · Shinjuku', bbox: [35.6785, 139.6767, 35.7025, 139.7243] }
    };

    const DEFAULT_SPEED = {
        motorway: 100, trunk: 80, primary: 50, secondary: 50, tertiary: 40,
        unclassified: 30, residential: 30, living_street: 10, pedestrian: 5,
        footway: 5, path: 5, steps: 2, service: 20
    };
    const ROAD_RANK = {
        motorway: 3, trunk: 3, primary: 2, secondary: 2, tertiary: 1,
        unclassified: 0, residential: 0, living_street: 0, pedestrian: 0,
        footway: 0, path: 0, steps: 0, service: 0
    };

    const WATER_TAGS = t => t.natural === 'water' || t.waterway === 'riverbank' ||
        t.natural === 'bay' || t.landuse === 'reservoir' || t.landuse === 'basin';
    const GREEN_TAGS = t => ['park', 'garden', 'golf_course', 'pitch'].indexOf(t.leisure) >= 0 ||
        ['grass', 'forest', 'meadow', 'cemetery', 'village_green', 'recreation_ground',
            'allotments', 'orchard'].indexOf(t.landuse) >= 0;

    const OVERPASS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter'
    ];
    const SPEEDS = { slow: 15, normal: 70, fast: 250, instant: Infinity };
    const SPEED_FRAC = { slow: 0.0015, normal: 0.008, fast: 0.03, instant: Infinity };

    const COLOR = {
        water: 'rgba(18, 40, 92, 0.9)',
        waterEdge: 'rgba(130, 170, 255, 0.32)',
        green: 'rgba(46, 106, 74, 0.32)',
        rail: 'rgba(255, 255, 255, 0.20)',
        road: ['rgba(255,255,255,0.32)', 'rgba(255,255,255,0.46)',
            'rgba(255,222,170,0.58)', 'rgba(255,176,116,0.75)'],
        roadWidth: [1.0, 1.5, 2.1, 2.9],
        forward: 'rgba(102,126,234,0.85)',
        backward: 'rgba(45,212,191,0.85)',
        path: '#ffd166',
        start: '#667eea',
        end: '#f093fb'
    };

    /* ---------------- state ---------------- */
    let graph = null, decor = null, proj = null, base = null;
    let start = -1, end = -1;
    let mode = 'start';
    let lastResult = null;
    let animId = null, running = false;
    let dpr = 1;
    const cache = new Map();

    /* ---------------- OSM download ---------------- */

    function overpassQuery(city) {
        const [s, w, n, e] = city.bbox;
        const box = `${s},${w},${n},${e}`;
        const kinds = city.walk
            ? 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|footway|path|steps'
            : 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian';
        return `[out:json][timeout:180];(` +
            `way["highway"~"^(${kinds})(_link)?$"](${box});` +
            `way["natural"~"^(water|coastline|bay)$"](${box});` +
            `way["waterway"="riverbank"](${box});` +
            `way["landuse"~"^(reservoir|basin|grass|forest|meadow|cemetery|village_green|recreation_ground|allotments|orchard)$"](${box});` +
            `way["leisure"~"^(park|garden|golf_course|pitch)$"](${box});` +
            `way["railway"~"^(rail|light_rail)$"](${box});` +
            `relation["natural"="water"](${box});` +
            `relation["waterway"="riverbank"](${box});` +
            `relation["leisure"="park"](${box});` +
            `);(._;>>;);out body qt;`;
    }

    async function downloadCity(id) {
        try {
            // 'no-cache' still uses the cached copy when the file is unchanged, but it
            // revalidates first. 'force-cache' would serve a stale map for ever.
            const local = await fetch(`data/${id}.json`, { cache: 'no-cache' });
            if (local.ok) {
                const json = await local.json();
                if (json && json.elements) return json;
            }
        } catch (_) { /* fall through to the live API */ }

        const body = 'data=' + encodeURIComponent(overpassQuery(CITIES[id]));
        let lastErr = null;
        for (const url of OVERPASS) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body
                });
                if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
                return await res.json();
            } catch (err) { lastErr = err; }
        }
        throw lastErr || new Error('every Overpass mirror refused the request');
    }

    /* ---------------- parsing ---------------- */

    function parseOsm(osm) {
        const coords = new Map(), ways = new Map(), relations = [];
        for (const el of osm.elements) {
            if (el.type === 'node') coords.set(el.id, [el.lat, el.lon]);
            else if (el.type === 'way') ways.set(el.id, { id: el.id, nodes: el.nodes || [], tags: el.tags || {} });
            else if (el.type === 'relation') relations.push({ tags: el.tags || {}, members: el.members || [] });
        }
        return { coords: coords, ways: ways, relations: relations };
    }

    function geomOf(way, coords) {
        const g = [];
        for (const id of way.nodes) {
            const c = coords.get(id);
            if (c) g.push(c);
        }
        return g;
    }

    function isClosed(way) {
        return way.nodes.length > 3 && way.nodes[0] === way.nodes[way.nodes.length - 1];
    }

    function parseSpeed(tags) {
        const raw = tags && tags.maxspeed;
        if (raw) {
            const m = String(raw).match(/(\d+)/);
            if (m) {
                let v = +m[1];
                if (/mph/i.test(raw)) v *= 1.609;
                if (v > 0) return v;
            }
        }
        const kind = ((tags && tags.highway) || '').replace(/_link$/, '');
        return DEFAULT_SPEED[kind] || 30;
    }

    /* ---------------- scenery ---------------- */

    function buildDecor(parsed, bbox) {
        const coords = parsed.coords, ways = parsed.ways;
        // Each water source gets its OWN path. Tracing them all into one path
        // and filling even-odd makes overlapping areas cancel out, which paints
        // the land and leaves the water empty - exactly backwards.
        const waterGroups = [], greenGroups = [], rails = [];
        const simpleWater = [], simpleGreen = [], coastWays = [];

        for (const way of ways.values()) {
            const t = way.tags;
            if (t.natural === 'coastline') {
                coastWays.push({ nodes: way.nodes, geom: geomOf(way, coords) });
            } else if (WATER_TAGS(t) && isClosed(way)) {
                simpleWater.push(geomOf(way, coords));
            } else if (GREEN_TAGS(t) && isClosed(way)) {
                simpleGreen.push(geomOf(way, coords));
            } else if (t.railway === 'rail' || t.railway === 'light_rail') {
                rails.push(geomOf(way, coords));
            }
        }

        // one group per relation, so a relation's holes only punch its own outline
        for (const rel of parsed.relations) {
            const t = rel.tags;
            if (!WATER_TAGS(t) && !GREEN_TAGS(t)) continue;
            const members = rel.members
                .filter(m => m.type === 'way' && ways.has(m.ref))
                .map(m => ({
                    role: m.role,
                    nodes: ways.get(m.ref).nodes,
                    geom: geomOf(ways.get(m.ref), coords)
                }))
                .filter(m => m.geom.length >= 2);
            if (!members.length) continue;
            const rings = assembleRings(members);
            const group = {
                fill: rings.outer.filter(r => r.length >= 3),
                holes: rings.inner.filter(r => r.length >= 3)
            };
            if (!group.fill.length) continue;
            (WATER_TAGS(t) ? waterGroups : greenGroups).push(group);
        }

        // The sea is not a polygon in OSM - rebuild it from the coastline.
        if (coastWays.length) {
            // no reversal: coastline direction tells us which side the land is on
            const chains = joinWays(coastWays.filter(w => w.geom.length >= 2), false);
            const sea = coastlineWater(chains, bbox);
            const fill = sea.water.filter(r => r.length >= 3);
            if (fill.length) {
                // islands ARE holes in this ring, so they belong in this group
                waterGroups.push({ fill: fill, holes: sea.islands.filter(r => r.length >= 3) });
            }
        }

        if (simpleWater.length) {
            waterGroups.push({ fill: simpleWater.filter(r => r.length >= 3), holes: [] });
        }
        if (simpleGreen.length) {
            greenGroups.push({ fill: simpleGreen.filter(r => r.length >= 3), holes: [] });
        }

        return {
            waterGroups: waterGroups.filter(g => g.fill.length),
            greenGroups: greenGroups.filter(g => g.fill.length),
            rails: rails.filter(r => r.length >= 2)
        };
    }

    /* ---------------- road graph ---------------- */

    function buildGraph(parsed, bbox) {
        const coords = parsed.coords, ways = parsed.ways;
        const bS = bbox[0], bW = bbox[1], bN = bbox[2], bE = bbox[3];
        // Overpass returns whole ways, including the parts outside the box.
        // Drop edges that never touch it, or one motorway ramp skews everything.
        const inBox = (la, lo) => la >= bS && la <= bN && lo >= bW && lo <= bE;

        const index = new Map();
        const rawLat = [], rawLon = [];
        const eu = [], ev = [], elen = [], espd = [], erank = [];

        function nodeIndex(osmId) {
            let i = index.get(osmId);
            if (i === undefined) {
                const c = coords.get(osmId);
                if (!c) return -1;
                i = rawLat.length;
                rawLat.push(c[0]); rawLon.push(c[1]);
                index.set(osmId, i);
            }
            return i;
        }

        for (const way of ways.values()) {
            const tags = way.tags;
            if (!tags.highway || way.nodes.length < 2) continue;
            const kind = tags.highway.replace(/_link$/, '');
            if (ROAD_RANK[kind] === undefined && DEFAULT_SPEED[kind] === undefined) continue;
            const speed = parseSpeed(tags) / 3.6;
            const rank = ROAD_RANK[kind] !== undefined ? ROAD_RANK[kind] : 0;
            for (let k = 1; k < way.nodes.length; k++) {
                const a = nodeIndex(way.nodes[k - 1]);
                const b = nodeIndex(way.nodes[k]);
                if (a < 0 || b < 0 || a === b) continue;
                if (!inBox(rawLat[a], rawLon[a]) && !inBox(rawLat[b], rawLon[b])) continue;
                const d = haversine(rawLat[a], rawLon[a], rawLat[b], rawLon[b]);
                if (!(d > 0)) continue;
                eu.push(a); ev.push(b); elen.push(d); espd.push(speed); erank.push(rank);
            }
        }

        const rawN = rawLat.length;
        if (!rawN || !eu.length) throw new Error('no roads found in this area');

        // --- keep only the largest connected component ---
        const deg = new Int32Array(rawN);
        for (let i = 0; i < eu.length; i++) { deg[eu[i]]++; deg[ev[i]]++; }
        const off = new Int32Array(rawN + 1);
        for (let i = 0; i < rawN; i++) off[i + 1] = off[i] + deg[i];
        const cursor = off.slice(0, rawN);
        const tgt = new Int32Array(off[rawN]);
        for (let i = 0; i < eu.length; i++) {
            tgt[cursor[eu[i]]++] = ev[i];
            tgt[cursor[ev[i]]++] = eu[i];
        }
        const comp = new Int32Array(rawN).fill(-1);
        const queue = new Int32Array(rawN);
        let bestComp = -1, bestSize = 0, nComp = 0;
        for (let s = 0; s < rawN; s++) {
            if (comp[s] !== -1) continue;
            let head = 0, tail = 0, size = 0;
            queue[tail++] = s; comp[s] = nComp;
            while (head < tail) {
                const cur = queue[head++]; size++;
                for (let e = off[cur]; e < off[cur + 1]; e++) {
                    if (comp[tgt[e]] === -1) { comp[tgt[e]] = nComp; queue[tail++] = tgt[e]; }
                }
            }
            if (size > bestSize) { bestSize = size; bestComp = nComp; }
            nComp++;
        }

        const remap = new Int32Array(rawN).fill(-1);
        const lat = [], lon = [];
        for (let i = 0; i < rawN; i++) {
            if (comp[i] === bestComp) { remap[i] = lat.length; lat.push(rawLat[i]); lon.push(rawLon[i]); }
        }
        const n = lat.length;

        const keep = [];
        for (let i = 0; i < eu.length; i++) {
            if (remap[eu[i]] >= 0 && remap[ev[i]] >= 0) keep.push(i);
        }
        const deg2 = new Int32Array(n);
        for (const i of keep) { deg2[remap[eu[i]]]++; deg2[remap[ev[i]]]++; }
        const offset = new Int32Array(n + 1);
        for (let i = 0; i < n; i++) offset[i + 1] = offset[i] + deg2[i];
        const m = offset[n];
        const cur2 = offset.slice(0, n);
        const target = new Int32Array(m);
        const len = new Float64Array(m);
        const spd = new Float64Array(m);
        const rank = new Uint8Array(m);
        for (const i of keep) {
            const a = remap[eu[i]], b = remap[ev[i]];
            let p = cur2[a]++; target[p] = b; len[p] = elen[i]; spd[p] = espd[i]; rank[p] = erank[i];
            p = cur2[b]++; target[p] = a; len[p] = elen[i]; spd[p] = espd[i]; rank[p] = erank[i];
        }

        return {
            n: n, lat: Float64Array.from(lat), lon: Float64Array.from(lon),
            offset: offset, target: target, len: len, spd: spd, rank: rank,
            weight: new Float64Array(m), heurDiv: 1,
            edgeCount: keep.length
        };
    }

    // A heuristic that overestimates silently breaks A*'s optimality, so in
    // travel-time mode it has to be divided by the fastest speed in the graph.
    function applyWeightMode() {
        if (!graph) return;
        const timeMode = weightSel.value === 'time';
        let maxSpeed = 1;
        if (timeMode) for (let e = 0; e < graph.spd.length; e++) {
            if (graph.spd[e] > maxSpeed) maxSpeed = graph.spd[e];
        }
        for (let e = 0; e < graph.weight.length; e++) {
            graph.weight[e] = timeMode ? graph.len[e] / graph.spd[e] : graph.len[e];
        }
        graph.heurDiv = timeMode ? maxSpeed : 1;
    }

    /* ---------------- projection ---------------- */

    let canvasAspect = 0.62;          // height / width

    function aspectFor(bbox) {
        const latSpan = bbox[2] - bbox[0];
        const lonSpan = (bbox[3] - bbox[1]) * Math.cos((bbox[0] + bbox[2]) / 2 * Math.PI / 180);
        return Math.max(0.45, Math.min(1.35, latSpan / lonSpan));
    }

    function sizeCanvas() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = canvas.clientWidth || 800;
        // A portrait city like Manhattan would otherwise be taller than the
        // window, so cap it and let the projection scale to fit.
        const maxH = Math.round((window.innerHeight || 800) * 0.78);
        const h = Math.min(Math.round(w * canvasAspect), maxH);
        canvas.style.height = h + 'px';
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
    }

    function computeProjection() {
        // Frame the box we asked for. Using node extents instead would let a
        // single road running off the edge dictate the zoom for the whole city.
        const minLat = graph.bbox[0], minLon = graph.bbox[1];
        const maxLat = graph.bbox[2], maxLon = graph.bbox[3];
        const kx = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
        const pad = 8 * dpr;
        const w = canvas.width - pad * 2, h = canvas.height - pad * 2;
        const scale = Math.min(w / ((maxLon - minLon) * kx), h / (maxLat - minLat));
        const drawW = (maxLon - minLon) * kx * scale, drawH = (maxLat - minLat) * scale;
        proj = {
            kx: kx, scale: scale, minLon: minLon, maxLat: maxLat,
            ox: pad + (w - drawW) / 2,
            oy: pad + (h - drawH) / 2,
            w: drawW, h: drawH
        };
    }

    const X = lon => proj.ox + (lon - proj.minLon) * proj.kx * proj.scale;
    const Y = lat => proj.oy + (proj.maxLat - lat) * proj.scale;
    const px = i => X(graph.lon[i]);
    const py = i => Y(graph.lat[i]);

    /* ---------------- base map ---------------- */

    function tracePolys(c, polys) {
        for (const ring of polys) {
            for (let i = 0; i < ring.length; i++) {
                const x = X(ring[i][1]), y = Y(ring[i][0]);
                if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
            c.closePath();
        }
    }

    function drawBase() {
        base = document.createElement('canvas');
        base.width = canvas.width; base.height = canvas.height;
        const b = base.getContext('2d');
        b.save();
        b.beginPath();
        b.rect(proj.ox, proj.oy, proj.w, proj.h);
        b.clip();

        if (decor) {
            // One fill per group. Overlapping groups simply paint over each
            // other; holes only apply within the group they came from.
            for (const g of decor.waterGroups) {
                b.beginPath();
                tracePolys(b, g.fill);
                tracePolys(b, g.holes);
                b.fillStyle = COLOR.water;
                b.fill('evenodd');
                b.strokeStyle = COLOR.waterEdge;
                b.lineWidth = 1 * dpr;
                b.stroke();
            }
            for (const g of decor.greenGroups) {
                b.beginPath();
                tracePolys(b, g.fill);
                tracePolys(b, g.holes);
                b.fillStyle = COLOR.green;
                b.fill('evenodd');
            }
            if (decor.rails.length) {
                b.beginPath();
                b.setLineDash([5 * dpr, 4 * dpr]);
                b.strokeStyle = COLOR.rail;
                b.lineWidth = 1.2 * dpr;
                for (const line of decor.rails) {
                    for (let i = 0; i < line.length; i++) {
                        const x = X(line[i][1]), y = Y(line[i][0]);
                        if (i === 0) b.moveTo(x, y); else b.lineTo(x, y);
                    }
                }
                b.stroke();
                b.setLineDash([]);
            }
        }

        b.lineCap = 'round';
        b.lineJoin = 'round';
        for (let level = 0; level <= 3; level++) {
            b.beginPath();
            b.strokeStyle = COLOR.road[level];
            b.lineWidth = COLOR.roadWidth[level] * dpr;
            for (let u = 0; u < graph.n; u++) {
                for (let e = graph.offset[u]; e < graph.offset[u + 1]; e++) {
                    const v = graph.target[e];
                    if (v < u || graph.rank[e] !== level) continue;   // each edge once
                    b.moveTo(px(u), py(u));
                    b.lineTo(px(v), py(v));
                }
            }
            b.stroke();
        }
        b.restore();
    }

    function drawMarkers() {
        const pins = [[start, COLOR.start], [end, COLOR.end]];
        for (const pin of pins) {
            if (pin[0] < 0) continue;
            ctx.beginPath();
            ctx.arc(px(pin[0]), py(pin[0]), 6 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = pin[1];
            ctx.fill();
            ctx.lineWidth = 2 * dpr;
            ctx.strokeStyle = 'rgba(10,14,39,0.9)';
            ctx.stroke();
        }
    }

    function resetCanvas() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (base) ctx.drawImage(base, 0, 0);
        drawMarkers();
    }

    function strokeVisited(entries, from, count) {
        ctx.lineCap = 'round';
        for (const side of [0, 1]) {
            ctx.beginPath();
            ctx.strokeStyle = side === 0 ? COLOR.forward : COLOR.backward;
            ctx.lineWidth = 1.4 * dpr;
            let any = false;
            for (let i = from; i < from + count && i < entries.length; i++) {
                const node = entries[i][0], s = entries[i][1], parent = entries[i][2];
                if (s !== side || parent < 0) continue;
                ctx.moveTo(px(parent), py(parent));
                ctx.lineTo(px(node), py(node));
                any = true;
            }
            if (any) ctx.stroke();
        }
    }

    function drawPath(path) {
        ctx.beginPath();
        ctx.strokeStyle = COLOR.path;
        ctx.lineWidth = 3.4 * dpr;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (let i = 0; i < path.length; i++) {
            const x = px(path[i]), y = py(path[i]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function redrawResult() {
        resetCanvas();
        if (!lastResult) return;
        strokeVisited(lastResult.visited, 0, lastResult.visited.length);
        if (lastResult.path) drawPath(lastResult.path);
        drawMarkers();
    }

    /* ---------------- stats ---------------- */

    function edgeStats(path) {
        let metres = 0, seconds = 0;
        for (let i = 1; i < path.length; i++) {
            const u = path[i - 1], v = path[i];
            let bestLen = Infinity, bestSpd = 1;
            for (let e = graph.offset[u]; e < graph.offset[u + 1]; e++) {
                if (graph.target[e] === v && graph.len[e] < bestLen) {
                    bestLen = graph.len[e]; bestSpd = graph.spd[e];
                }
            }
            if (bestLen === Infinity) continue;
            metres += bestLen;
            seconds += bestLen / bestSpd;
        }
        return { metres: metres, seconds: seconds };
    }

    function describe(id, result, ms) {
        const algo = ALGORITHMS[id];
        if (!result.path) return `${algo.label}: no route found.`;
        const s = edgeStats(result.path);
        return `${algo.label} · ${result.visited.length.toLocaleString()} intersections explored · ` +
            `${(s.metres / 1000).toFixed(2)} km · ${Math.round(s.seconds / 60)} min · ` +
            `${result.path.length - 1} segments · ${ms.toFixed(1)} ms`;
    }

    /* ---------------- interaction ---------------- */

    function nearestNode(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left) * (canvas.width / rect.width);
        const y = (clientY - rect.top) * (canvas.height / rect.height);
        let best = -1, bestD = Infinity;
        for (let i = 0; i < graph.n; i++) {
            const dx = px(i) - x, dy = py(i) - y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }

    canvas.addEventListener('click', e => {
        if (!graph || running) return;
        const node = nearestNode(e.clientX, e.clientY);
        if (node < 0) return;
        if (mode === 'start') { if (node === end) return; start = node; }
        else { if (node === start) return; end = node; }
        lastResult = null;
        resetCanvas();
        setStats('');
        setStatus('Ready — press Find Route.');
    });

    /* ---------------- running ---------------- */

    function setStatus(t) { if (statusEl) statusEl.textContent = t; }
    function setStats(t) { if (statsEl) statsEl.textContent = t; }

    function setBusy(b) {
        [runBtn, clearBtn, randomBtn, citySel, algoSel, weightSel]
            .concat(Object.keys(modeBtns).map(k => modeBtns[k]))
            .forEach(el => { if (el) el.disabled = b; });
    }

    function stopAnimation() {
        if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
        running = false;
        setBusy(false);
    }

    function runSearch() {
        if (!graph || start < 0 || end < 0) {
            setStatus('Click the map to place a start and an end point first.');
            return;
        }
        stopAnimation();
        applyWeightMode();

        const id = algoSel.value;
        const g = Object.assign({}, graph, { start: start, end: end });
        const t0 = performance.now();
        const result = ALGORITHMS[id].run(g);
        const ms = performance.now() - t0;
        lastResult = result;

        const key = speedSel.value;
        const perFrame = key === 'instant' ? Infinity
            : Math.max(SPEEDS[key], Math.round(graph.n * SPEED_FRAC[key]));
        resetCanvas();

        if (perFrame === Infinity) {
            strokeVisited(result.visited, 0, result.visited.length);
            if (result.path) drawPath(result.path);
            drawMarkers();
            setStatus(result.path ? 'Done.' : 'No route.');
            setStats(describe(id, result, ms));
            return;
        }

        running = true;
        setBusy(true);
        setStatus(`Running ${ALGORITHMS[id].label}...`);
        setStats('');
        let i = 0;

        function frame() {
            if (i < result.visited.length) {
                strokeVisited(result.visited, i, perFrame);
                i += perFrame;
                drawMarkers();
                animId = requestAnimationFrame(frame);
                return;
            }
            if (result.path) drawPath(result.path);
            drawMarkers();
            running = false; animId = null;
            setBusy(false);
            setStatus(result.path ? 'Done.' : 'No route found.');
            setStats(describe(id, result, ms));
        }
        animId = requestAnimationFrame(frame);
    }

    function randomEndpoints() {
        if (!graph) return;
        let bestA = 0, bestB = 0, bestD = -1;
        for (let t = 0; t < 60; t++) {
            const a = Math.floor(Math.random() * graph.n);
            const b = Math.floor(Math.random() * graph.n);
            const d = haversine(graph.lat[a], graph.lon[a], graph.lat[b], graph.lon[b]);
            if (d > bestD) { bestD = d; bestA = a; bestB = b; }
        }
        start = bestA; end = bestB;
        lastResult = null;
        resetCanvas();
        setStats('');
        setStatus('Ready — press Find Route.');
    }

    /* ---------------- loading ---------------- */

    async function loadCity(id) {
        stopAnimation();
        graph = null; decor = null; lastResult = null; start = end = -1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setStats('');
        setBusy(true);
        setStatus(`Downloading ${CITIES[id].name} from OpenStreetMap...`);

        try {
            let osm = cache.get(id);
            if (!osm) {
                osm = await downloadCity(id);
                cache.set(id, osm);
            }
            setStatus('Building the road graph...');
            const parsed = parseOsm(osm);
            const bbox = CITIES[id].bbox;
            graph = buildGraph(parsed, bbox);
            graph.bbox = bbox;
            canvasAspect = aspectFor(bbox);
            decor = buildDecor(parsed, bbox);
            applyWeightMode();
            sizeCanvas();
            computeProjection();
            drawBase();
            resetCanvas();
            randomEndpoints();
            const scenery = [];
            if (decor.waterGroups.length) scenery.push('water');
            if (decor.greenGroups.length) scenery.push('parks');
            if (decor.rails.length) scenery.push('rail');
            setStatus(`${graph.n.toLocaleString()} intersections, ` +
                `${graph.edgeCount.toLocaleString()} road segments` +
                (scenery.length ? ` (+ ${scenery.join(', ')})` : '') +
                `. Click the map to move the pins, then press Find Route.`);
        } catch (err) {
            setStatus('Could not load this city: ' + (err && err.message ? err.message : err) +
                '. OpenStreetMap\'s free API rate-limits busy periods — try again in a minute.');
        } finally {
            setBusy(false);
        }
    }

    /* ---------------- wiring ---------------- */

    function setMode(m) {
        mode = m;
        Object.keys(modeBtns).forEach(k => {
            if (modeBtns[k]) modeBtns[k].classList.toggle('active', k === m);
        });
    }

    function updateNote() {
        const algo = ALGORITHMS[algoSel.value];
        if (noteEl && algo) noteEl.textContent = algo.note;
    }

    Object.keys(modeBtns).forEach(k => {
        if (modeBtns[k]) modeBtns[k].addEventListener('click', () => setMode(k));
    });
    runBtn.addEventListener('click', runSearch);
    randomBtn.addEventListener('click', randomEndpoints);
    clearBtn.addEventListener('click', () => {
        stopAnimation();
        lastResult = null;
        resetCanvas();
        setStats('');
        setStatus('Cleared.');
    });
    citySel.addEventListener('change', () => loadCity(citySel.value));
    algoSel.addEventListener('change', () => {
        updateNote();
        stopAnimation();
        lastResult = null;
        resetCanvas();
        setStats('');
    });
    weightSel.addEventListener('change', () => {
        stopAnimation();
        lastResult = null;
        resetCanvas();
        setStats('');
        setStatus(weightSel.value === 'time'
            ? 'Now minimising travel time — faster roads win.'
            : 'Now minimising distance — shortest route wins.');
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (!graph) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            sizeCanvas();
            computeProjection();
            drawBase();
            redrawResult();
        }, 200);
    });

    try {
        Object.keys(CITIES).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id; opt.textContent = CITIES[id].name;
            citySel.appendChild(opt);
        });
        citySel.value = 'manhattan';
        setMode('start');
        updateNote();
        sizeCanvas();
        loadCity('manhattan');
    } catch (err) {
        console.error('maps.js failed to start:', err);
        setStatus('Startup failed: ' + (err && err.message ? err.message : err));
    }
})();
