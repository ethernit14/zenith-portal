/*
 * In-browser DDIM diffusion demo.
 *
 * Runs the actual trained U-Net (exported to ONNX) in the visitor's browser
 * via onnxruntime-web. Nothing here is faked or pre-rendered -- every image
 * on this page was generated live, in that tab, from random noise.
 *
 * Depends on: unet.onnx, classifier.onnx, reference.bin sitting next to
 * this file (produced by export_onnx.py and extract_reference.py).
 */

// ---------------------------------------------------------------------------
// Constants -- MUST match the Python training config (ddpm.py Diffusion class)
// ---------------------------------------------------------------------------
const T = 400;              // diffusion timesteps the model was trained with
const COSINE_S = 0.008;     // cosine schedule offset, same as ddpm.py
const IMG = 28;              // image side length
const PIXELS = IMG * IMG;
const REFERENCE_COUNT = 240; // images packed in reference.bin

// Eyeballed from memorisation_test.py's histogram: real held-out digits sit
// mostly in the 6-13 L2-distance band from the training set. Used only to
// phrase the originality label -- not a hard scientific cutoff.
const DIST_NEAR_DUPLICATE = 4.0;
const DIST_TYPICAL_MAX = 13.5;

// ---------------------------------------------------------------------------
// Diffusion schedule (recomputed in JS -- the ONNX graph is just the U-Net,
// the noise schedule and the sampling loop live here)
// ---------------------------------------------------------------------------
function buildAbarSchedule(steps = T, s = COSINE_S) {
    const raw = [];
    for (let i = 0; i <= steps; i++) {
        const tv = i / steps;
        const c = Math.cos(((tv + s) / (1 + s)) * Math.PI / 2);
        raw.push(c * c);
    }
    const f0 = raw[0];
    const abarRaw = raw.map(v => v / f0); // steps+1 values

    const betas = [];
    for (let i = 0; i < steps; i++) {
        let b = 1 - abarRaw[i + 1] / abarRaw[i];
        if (b > 0.999) b = 0.999;
        betas.push(b);
    }
    const abar = [];
    let cum = 1;
    for (let i = 0; i < steps; i++) {
        cum *= (1 - betas[i]);
        abar.push(cum);
    }
    return abar; // length `steps`, abar[i] matches Python's diff.abar[i]
}

function ddimTimesteps(nSteps, totalT = T) {
    const ts = [];
    for (let k = 0; k < nSteps; k++) {
        ts.push(Math.round((totalT - 1) * k / (nSteps - 1)));
    }
    return ts.reverse(); // high t (noisy) -> low t (clean)
}

function randn() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Model sessions
// ---------------------------------------------------------------------------
let unetSession = null;
let clfSession = null;
let referenceImages = null; // Float32Array, REFERENCE_COUNT * PIXELS, range [-1,1]
const ABAR = buildAbarSchedule();

async function loadEverything(onProgress) {
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);

    onProgress('Loading the trained model...');
    unetSession = await ort.InferenceSession.create('unet.onnx', {
        executionProviders: ['wasm'],
    });

    onProgress('Loading the digit classifier...');
    clfSession = await ort.InferenceSession.create('classifier.onnx', {
        executionProviders: ['wasm'],
    });

    onProgress('Loading reference digits...');
    const buf = await (await fetch('reference.bin')).arrayBuffer();
    const bytes = new Uint8Array(buf);
    referenceImages = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        referenceImages[i] = (bytes[i] / 127.5) - 1.0; // uint8 [0,255] -> [-1,1]
    }
}

// A quick timed forward pass to decide how much work this device can afford.
async function calibrate() {
    const batch = 8;
    const x = new Float32Array(batch * PIXELS);
    for (let i = 0; i < x.length; i++) x[i] = randn();
    const t = new BigInt64Array(batch).fill(BigInt(T - 1));

    const t0 = performance.now();
    await unetSession.run({
        x: new ort.Tensor('float32', x, [batch, 1, IMG, IMG]),
        t: new ort.Tensor('int64', t, [batch]),
    });
    const msPerBatchStep = performance.now() - t0;

    // Pick (batch size, ddim steps) so a full run stays under roughly 12-15s.
    // Batch size floor is 60 (6x10 grid) even on slower devices -- step count
    // is the knob that adapts to speed instead, since more samples per digit
    // matters more here than a few extra denoising steps.
    if (msPerBatchStep < 60) return { n: 70, steps: 30 };
    if (msPerBatchStep < 180) return { n: 60, steps: 22 };
    return { n: 60, steps: 14 };
}

// ---------------------------------------------------------------------------
// Generation: one batched DDIM run, rendered live
// ---------------------------------------------------------------------------
async function generateBatch(n, nSteps, onFrame, onStatus) {
    const ts = ddimTimesteps(nSteps);
    let x = new Float32Array(n * PIXELS);
    for (let i = 0; i < x.length; i++) x[i] = randn();

    const history = [x.slice()];

    for (let k = 0; k < ts.length; k++) {
        const i = ts[k];
        const iNext = k + 1 < ts.length ? ts[k + 1] : null;
        const ab = ABAR[i];
        const abPrev = iNext !== null ? ABAR[iNext] : 1.0;

        const tArr = new BigInt64Array(n).fill(BigInt(i));
        const result = await unetSession.run({
            x: new ort.Tensor('float32', x, [n, 1, IMG, IMG]),
            t: new ort.Tensor('int64', tArr, [n]),
        });
        const eps = result.eps.data; // Float32Array, n*PIXELS

        const sqrtAb = Math.sqrt(ab);
        const sqrt1mAb = Math.sqrt(1 - ab);
        const sqrtAbPrev = Math.sqrt(abPrev);
        const sqrt1mAbPrev = Math.sqrt(1 - abPrev);

        const xNext = new Float32Array(n * PIXELS);
        for (let j = 0; j < x.length; j++) {
            let x0 = (x[j] - sqrt1mAb * eps[j]) / sqrtAb;
            if (x0 > 1) x0 = 1; else if (x0 < -1) x0 = -1;
            xNext[j] = sqrtAbPrev * x0 + sqrt1mAbPrev * eps[j];
        }
        x = xNext;
        history.push(x.slice());

        onFrame(x, k + 1, ts.length);
        onStatus(`denoising ${n} images \u2014 step ${k + 1}/${ts.length}`);
        await new Promise(r => setTimeout(r, 0)); // let the browser repaint
    }

    return { samples: x, history };
}

// ---------------------------------------------------------------------------
// Classifier scoring
// ---------------------------------------------------------------------------
async function classify(samples, n) {
    const result = await clfSession.run({
        x: new ort.Tensor('float32', samples, [n, 1, IMG, IMG]),
    });
    const logits = result.logits.data; // n*10

    const out = [];
    for (let i = 0; i < n; i++) {
        const row = logits.slice(i * 10, i * 10 + 10);
        const maxLogit = Math.max(...row);
        const exps = row.map(v => Math.exp(v - maxLogit));
        const sum = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map(v => v / sum);
        let best = 0;
        for (let d = 1; d < 10; d++) if (probs[d] > probs[best]) best = d;
        out.push({ digit: best, confidence: probs[best] });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Nearest-neighbor originality check
// ---------------------------------------------------------------------------
function nearestDistance(sample) {
    // sample: Float32Array of length PIXELS, range [-1,1]
    let best = Infinity;
    for (let r = 0; r < REFERENCE_COUNT; r++) {
        const off = r * PIXELS;
        let d2 = 0;
        for (let p = 0; p < PIXELS; p++) {
            const diff = sample[p] - referenceImages[off + p];
            d2 += diff * diff;
        }
        if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
}

function originalityLabel(dist) {
    if (dist < DIST_NEAR_DUPLICATE) {
        return { text: 'unusually close to a training example', cls: 'flag' };
    }
    if (dist <= DIST_TYPICAL_MAX) {
        return { text: 'typical distance for genuine handwriting', cls: 'ok' };
    }
    return { text: 'rougher than typical -- a weaker sample', cls: 'rough' };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawSampleToCanvas(canvas, sample, offset = 0) {
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(IMG, IMG);
    for (let p = 0; p < PIXELS; p++) {
        const v = Math.round(((sample[offset + p] + 1) / 2) * 255);
        const clamped = Math.max(0, Math.min(255, v));
        img.data[p * 4 + 0] = clamped;
        img.data[p * 4 + 1] = clamped;
        img.data[p * 4 + 2] = clamped;
        img.data[p * 4 + 3] = 255;
    }
    // draw at native res then let CSS upscale with crisp pixels
    ctx.putImageData(img, 0, 0);
}

function renderGrid(canvas, samples, n, cols) {
    const rows = Math.ceil(n / cols);
    const cell = IMG + 2;
    canvas.width = cols * cell;
    canvas.height = rows * cell;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0e27';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const img = ctx.createImageData(IMG, IMG);
        for (let p = 0; p < PIXELS; p++) {
            const v = Math.round(((samples[i * PIXELS + p] + 1) / 2) * 255);
            const clamped = Math.max(0, Math.min(255, v));
            img.data[p * 4 + 0] = clamped;
            img.data[p * 4 + 1] = clamped;
            img.data[p * 4 + 2] = clamped;
            img.data[p * 4 + 3] = 255;
        }
        ctx.putImageData(img, c * cell + 1, r * cell + 1);
    }
}

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------
let lastRun = null; // { samples, n, scores, history, cols }

function $(id) { return document.getElementById(id); }

async function handleGenerate() {
    const btn = $('genBtn');
    btn.disabled = true;
    $('diffStatus').textContent = 'Warming up...';
    $('diffResults').innerHTML = '';
    $('scrubWrap').style.display = 'none';

    try {
        if (!unetSession) {
            await loadEverything(msg => { $('diffStatus').textContent = msg; });
        }
        const { n, steps } = await calibrate();
        const cols = Math.min(10, n);

        const liveCanvas = $('liveGrid');
        liveCanvas.style.display = 'block';

        const { samples, history } = await generateBatch(
            n, steps,
            (x) => renderGrid(liveCanvas, x, n, cols),
            (msg) => { $('diffStatus').textContent = msg; }
        );

        $('diffStatus').textContent = 'Scoring with the digit classifier...';
        const scores = await classify(samples, n);

        lastRun = { samples, n, scores, history, cols };
        renderResults();
        setupScrubber(history, n, cols);

        $('diffStatus').textContent =
            `Done \u2014 ${n} images, ${steps} denoising steps, all generated in this tab.`;
    } catch (err) {
        console.error(err);
        $('diffStatus').textContent = 'Something went wrong: ' + err.message;
    } finally {
        btn.disabled = false;
    }
}

function renderResults() {
    const { samples, n, scores } = lastRun;
    const wrap = $('diffResults');
    wrap.innerHTML = '';

    const bestPerDigit = {};
    for (let i = 0; i < n; i++) {
        const { digit, confidence } = scores[i];
        if (!bestPerDigit[digit] || confidence > bestPerDigit[digit].confidence) {
            bestPerDigit[digit] = { index: i, confidence };
        }
    }

    for (let d = 0; d <= 9; d++) {
        const slot = document.createElement('div');
        slot.className = 'digit-slot';

        if (bestPerDigit[d]) {
            const { index, confidence } = bestPerDigit[d];
            const offset = index * PIXELS;
            const sample = samples.slice(offset, offset + PIXELS);
            const dist = nearestDistance(sample);
            const orig = originalityLabel(dist);

            const canvas = document.createElement('canvas');
            canvas.width = IMG; canvas.height = IMG;
            canvas.className = 'digit-canvas';
            drawSampleToCanvas(canvas, sample);

            const nnCanvas = document.createElement('canvas');
            nnCanvas.width = IMG; nnCanvas.height = IMG;
            nnCanvas.className = 'digit-canvas nn-canvas';
            drawNearest(nnCanvas, sample);

            slot.innerHTML = `
                <div class="digit-flip" tabindex="0">
                  <div class="digit-flip-inner">
                    <div class="digit-face front"></div>
                    <div class="digit-face back"></div>
                  </div>
                </div>
                <div class="digit-label">${d}</div>
                <div class="digit-conf">${(confidence * 100).toFixed(0)}% confident</div>
                <div class="digit-orig ${orig.cls}">${orig.text}</div>
            `;
            slot.querySelector('.front').appendChild(canvas);
            slot.querySelector('.back').appendChild(nnCanvas);
            const backLabel = document.createElement('div');
            backLabel.className = 'nn-caption';
            backLabel.textContent = 'nearest real digit';
            slot.querySelector('.back').appendChild(backLabel);

            const flip = slot.querySelector('.digit-flip');
            flip.addEventListener('click', () => flip.classList.toggle('flipped'));
        } else {
            slot.innerHTML = `
                <div class="digit-empty">not generated this round</div>
                <div class="digit-label dim">${d}</div>
                <button class="app-btn secondary retry-btn" data-digit="${d}">
                    try to generate a ${d}
                </button>
            `;
            slot.querySelector('.retry-btn').addEventListener('click', (e) => retryDigit(d, e.target));
        }
        wrap.appendChild(slot);
    }
}

function drawNearest(canvas, sample) {
    // recompute + also fetch which reference image was nearest
    let best = Infinity, bestIdx = 0;
    for (let r = 0; r < REFERENCE_COUNT; r++) {
        const off = r * PIXELS;
        let d2 = 0;
        for (let p = 0; p < PIXELS; p++) {
            const diff = sample[p] - referenceImages[off + p];
            d2 += diff * diff;
        }
        if (d2 < best) { best = d2; bestIdx = r; }
    }
    drawSampleToCanvas(canvas, referenceImages, bestIdx * PIXELS);
}

async function retryDigit(digit, btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = 'trying...';
    const maxRounds = 4;
    const roundSize = 16;

    for (let round = 0; round < maxRounds; round++) {
        const steps = 18;
        const { samples } = await generateBatch(roundSize, steps, () => {}, () => {});
        const scores = await classify(samples, roundSize);
        let bestIdx = -1, bestConf = 0;
        for (let i = 0; i < roundSize; i++) {
            if (scores[i].digit === digit && scores[i].confidence > bestConf) {
                bestIdx = i; bestConf = scores[i].confidence;
            }
        }
        if (bestIdx >= 0) {
            // splice this single result into lastRun and re-render its slot
            const offset = bestIdx * PIXELS;
            const newSample = samples.slice(offset, offset + PIXELS);
            injectDigit(digit, newSample, bestConf);
            return;
        }
    }
    btnEl.textContent = `still no clean ${digit} -- try again?`;
    btnEl.disabled = false;
}

function injectDigit(digit, sample, confidence) {
    const dist = nearestDistance(sample);
    const orig = originalityLabel(dist);
    const wrap = $('diffResults');
    const slot = wrap.children[digit];

    const canvas = document.createElement('canvas');
    canvas.width = IMG; canvas.height = IMG;
    canvas.className = 'digit-canvas';
    drawSampleToCanvas(canvas, sample);

    const nnCanvas = document.createElement('canvas');
    nnCanvas.width = IMG; nnCanvas.height = IMG;
    nnCanvas.className = 'digit-canvas nn-canvas';
    drawNearest(nnCanvas, sample);

    slot.innerHTML = `
        <div class="digit-flip" tabindex="0">
          <div class="digit-flip-inner">
            <div class="digit-face front"></div>
            <div class="digit-face back"></div>
          </div>
        </div>
        <div class="digit-label">${digit}</div>
        <div class="digit-conf">${(confidence * 100).toFixed(0)}% confident</div>
        <div class="digit-orig ${orig.cls}">${orig.text}</div>
    `;
    slot.querySelector('.front').appendChild(canvas);
    slot.querySelector('.back').appendChild(nnCanvas);
    const backLabel = document.createElement('div');
    backLabel.className = 'nn-caption';
    backLabel.textContent = 'nearest real digit';
    slot.querySelector('.back').appendChild(backLabel);
    const flip = slot.querySelector('.digit-flip');
    flip.addEventListener('click', () => flip.classList.toggle('flipped'));
}

// ---------------------------------------------------------------------------
// Scrub back through the generation trajectory
// ---------------------------------------------------------------------------
function setupScrubber(history, n, cols) {
    const wrap = $('scrubWrap');
    const slider = $('scrubSlider');
    const canvas = $('liveGrid');
    wrap.style.display = 'flex';
    slider.max = history.length - 1;
    slider.value = history.length - 1;
    slider.oninput = () => {
        const idx = parseInt(slider.value, 10);
        renderGrid(canvas, history[idx], n, cols);
        $('scrubLabel').textContent =
            idx === history.length - 1 ? 'final' : `step ${idx}/${history.length - 1}`;
    };
    $('scrubLabel').textContent = 'final';
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = $('genBtn');
    if (btn) btn.addEventListener('click', handleGenerate);
});
