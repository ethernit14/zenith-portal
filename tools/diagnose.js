/* Why is there no water on this map?
   Usage:  node tools/diagnose.js kadikoy          (run from the repo root) */
const fs = require('fs');
const path = require('path');
const MapGeo = require(path.join(__dirname, '..', 'map-geo.js'));

const city = process.argv[2] || 'kadikoy';
const js = fs.readFileSync('maps.js', 'utf8');
const m = new RegExp(city + ":\\s*\\{[^}]*bbox:\\s*\\[([^\\]]+)\\]").exec(js);
if (!m) { console.error(`No city "${city}" in maps.js`); process.exit(1); }
const bbox = m[1].split(',').map(Number);
console.log(`${city} bbox from maps.js: [${bbox.join(', ')}]`);

const file = `data/${city}.json`;
if (!fs.existsSync(file)) { console.error(`${file} missing — run fetch_city.py ${city}`); process.exit(1); }
const osm = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`${file}: ${(fs.statSync(file).size / 1024).toFixed(0)} KB, ${osm.elements.length} elements`);

const coords = new Map(), ways = [];
let rels = 0;
for (const el of osm.elements) {
    if (el.type === 'node') coords.set(el.id, [el.lat, el.lon]);
    else if (el.type === 'way') ways.push(el);
    else if (el.type === 'relation') rels++;
}
const geom = w => w.nodes.map(id => coords.get(id)).filter(Boolean);

const coast = ways.filter(w => (w.tags || {}).natural === 'coastline');
const waterPolys = ways.filter(w => {
    const t = w.tags || {};
    return (t.natural === 'water' || t.waterway === 'riverbank' || t.natural === 'bay')
        && w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];
});
console.log(`\ncoastline ways: ${coast.length}`);
console.log(`closed water polygons: ${waterPolys.length}`);
console.log(`relations: ${rels}`);

if (!coast.length && !waterPolys.length && !rels) {
    console.log('\n=> The data contains NO water at all. Nothing to draw.');
    process.exit(0);
}

// --- relations: the path the Thames, Danube and Tiber use ---
const relations = osm.elements.filter(e => e.type === 'relation');
const wayById = new Map(ways.map(w => [w.id, w]));
if (relations.length) {
    console.log('\n--- multipolygon relations ---');
    let okRings = 0, dropped = 0;
    for (const rel of relations) {
        const t = rel.tags || {};
        const kind = t.natural || t.waterway || t.leisure || t.landuse || '?';
        const wanted = rel.members.filter(m => m.type === 'way');
        const have = wanted.filter(m => wayById.has(m.ref));
        const members = have.map(m => ({
            role: m.role, nodes: wayById.get(m.ref).nodes, geom: geom(wayById.get(m.ref))
        })).filter(m => m.geom.length >= 2);
        const rings = MapGeo.assembleRings(members);
        const chainsOuter = MapGeo.joinWays(members.filter(m => m.role !== 'inner'), true);
        const unclosed = chainsOuter.filter(c => !c.closed).length;
        okRings += rings.outer.length;
        if (!rings.outer.length) dropped++;
        console.log(`  ${String(rel.id).padEnd(10)} ${kind.padEnd(12)} ` +
            `members ${have.length}/${wanted.length}` +
            (have.length < wanted.length ? ' (SOME MISSING)' : '') +
            ` -> ${rings.outer.length} outer ring(s), ${rings.inner.length} hole(s)` +
            (unclosed ? `  [${unclosed} chain(s) DID NOT CLOSE -> discarded]` : ''));
    }
    console.log(`  => ${okRings} usable ring(s); ${dropped} relation(s) produced nothing`);
}

if (coast.length) {
    const chains = MapGeo.joinWays(coast.map(w => ({ nodes: w.nodes, geom: geom(w) })));
    console.log(`\njoined into ${chains.length} chain(s)`);
    const box = MapGeo.makeBox(bbox);
    let pieces = 0;
    for (const c of chains) pieces += MapGeo.clipChain(c.geom, box).length;
    console.log(`clipped to ${pieces} piece(s) inside the box`);
    const res = MapGeo.coastlineWater(chains, bbox);
    console.log(`=> produced ${res.water.length} water ring(s), ${res.islands.length} island(s)`);
    if (res.water.length) {
        const r = res.water[0];
        const lats = r.map(p => p[0]), lons = r.map(p => p[1]);
        console.log(`   first ring: ${r.length} points, ` +
            `lat ${Math.min(...lats).toFixed(4)}..${Math.max(...lats).toFixed(4)}, ` +
            `lon ${Math.min(...lons).toFixed(4)}..${Math.max(...lons).toFixed(4)}`);
        const area = Math.abs(r.reduce((a, p, i) => {
            const q = r[(i + 1) % r.length];
            return a + (p[1] * q[0] - q[1] * p[0]);
        }, 0) / 2);
        const boxArea = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
        console.log(`   covers ~${(area / boxArea * 100).toFixed(0)}% of the box`);
    } else {
        console.log('   => BUG: coastline exists but produced no water ring.');
    }
}
