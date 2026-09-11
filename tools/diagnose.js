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
