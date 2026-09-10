/* ============================================================
   maze.js — grid UI, painting and animation.
   Algorithms live in maze-algos.js (window.MazeAlgos).
   ============================================================ */
(function () {
    'use strict';

    const gridEl = document.getElementById('mazeGrid');
    if (!gridEl || !window.MazeAlgos) return;

    const { ALGORITHMS, pathCost, generateMaze } = window.MazeAlgos;

    const statusEl = document.getElementById('mazeStatus');
    const statsEl = document.getElementById('mazeStats');
    const noteEl = document.getElementById('mazeAlgoNote');
    const algoSel = document.getElementById('mazeAlgo');
    const sizeSel = document.getElementById('mazeSize');
    const speedSel = document.getElementById('mazeSpeed');
    const runBtn = document.getElementById('mazeRun');
    const genBtn = document.getElementById('mazeGenerate');
    const randomBtn = document.getElementById('mazeRandom');
    const clearBtn = document.getElementById('mazeClearWalls');
    const resetBtn = document.getElementById('mazeReset');
    const modeBtns = {
        wall: document.getElementById('mazeModeWall'),
        mud: document.getElementById('mazeModeMud'),
        start: document.getElementById('mazeModeStart'),
        end: document.getElementById('mazeModeEnd')
    };

    const SIZES = {
        small: { cols: 31, rows: 19 },
        medium: { cols: 45, rows: 27 },
        large: { cols: 61, rows: 37 }
    };
    const SPEEDS = { slow: 2, normal: 8, fast: 30, instant: Infinity };
    const MUD_COST = 5;

    // ---- state ----
    let COLS, ROWS, blocked, cost, start, end;
    let cellEls = [], lastClass = [];
    let marks;                 // 0 none, 1 forward frontier, 2 backward frontier, 3 path
    let mode = 'wall';
    let running = false;       // an animation is playing
    let hasResult = false;     // a finished search is on screen -> live re-run while editing
    let animId = null, liveId = null;
    let drag = null;           // { action: 'wall'|'mud'|'erase'|'start'|'end' }

    const idx = (r, c) => r * COLS + c;

    /* ---------------- grid construction ---------------- */

    function buildGrid(cols, rows) {
        COLS = cols; ROWS = rows;
        const n = cols * rows;
        blocked = new Uint8Array(n);
        cost = new Uint16Array(n).fill(1);
        marks = new Uint8Array(n);
        start = idx(Math.floor(rows / 2), Math.max(1, Math.round(cols * 0.12)));
        end = idx(Math.floor(rows / 2), Math.min(cols - 2, Math.round(cols * 0.88)));

        gridEl.innerHTML = '';
        gridEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        gridEl.style.aspectRatio = `${cols} / ${rows}`;
        cellEls = new Array(n);
        lastClass = new Array(n).fill('');

        const frag = document.createDocumentFragment();
        for (let i = 0; i < n; i++) {
            const cell = document.createElement('div');
            cell.className = 'maze-cell';
            cell.dataset.i = i;
            frag.appendChild(cell);
            cellEls[i] = cell;
        }
        gridEl.appendChild(frag);
        hasResult = false;
        render();
        setStats('');
    }

    /* ---------------- rendering ---------------- */

    function classFor(i) {
        let cls = 'maze-cell';
        if (blocked[i]) cls += ' wall';
        else if (cost[i] > 1) cls += ' mud';
        const m = marks[i];
        if (m === 1) cls += ' visited';
        else if (m === 2) cls += ' visited-b';
        else if (m === 3) cls += ' path';
        if (i === start) cls += ' start';
        else if (i === end) cls += ' end';
        return cls;
    }

    // Only touches the DOM for cells whose appearance actually changed.
    function render() {
        for (let i = 0; i < cellEls.length; i++) {
            const cls = classFor(i);
            if (cls !== lastClass[i]) { cellEls[i].className = cls; lastClass[i] = cls; }
        }
    }

    function paintCell(i) {
        const cls = classFor(i);
        if (cls !== lastClass[i]) { cellEls[i].className = cls; lastClass[i] = cls; }
    }

    function clearMarks() {
        marks.fill(0);
    }

    function setStatus(text) { if (statusEl) statusEl.textContent = text; }
    function setStats(text) { if (statsEl) statsEl.textContent = text; }

    /* ---------------- editing ---------------- */

    function applyPaint(i) {
        if (drag.action === 'start') {
            if (i === end || blocked[i]) return false;
            if (i === start) return false;
            start = i;
        } else if (drag.action === 'end') {
            if (i === start || blocked[i]) return false;
            if (i === end) return false;
            end = i;
        } else {
            if (i === start || i === end) return false;
            if (drag.action === 'wall') {
                if (blocked[i]) return false;
                blocked[i] = 1; cost[i] = 1;
            } else if (drag.action === 'mud') {
                if (!blocked[i] && cost[i] === MUD_COST) return false;
                blocked[i] = 0; cost[i] = MUD_COST;
            } else { // erase
                if (!blocked[i] && cost[i] === 1) return false;
                blocked[i] = 0; cost[i] = 1;
            }
        }
        return true;
    }

    function startDrag(i) {
        if (mode === 'start' || mode === 'end') {
            drag = { action: mode };
        } else if (mode === 'wall') {
            // Pressing on an existing wall turns the whole drag into an eraser.
            drag = { action: blocked[i] ? 'erase' : 'wall' };
        } else {
            drag = { action: (!blocked[i] && cost[i] === MUD_COST) ? 'erase' : 'mud' };
        }
        touchCell(i);
    }

    function touchCell(i) {
        if (!drag || running) return;
        if (!applyPaint(i)) return;
        if (hasResult) scheduleLiveRun();   // keeps the solution in sync while you draw
        else { render(); }
    }

    function cellFromEvent(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || !el.dataset || el.dataset.i === undefined) return -1;
        return +el.dataset.i;
    }

    gridEl.addEventListener('pointerdown', e => {
        if (running) return;
        const i = cellFromEvent(e);
        if (i < 0) return;
        e.preventDefault();
        try { gridEl.setPointerCapture(e.pointerId); } catch (_) { }
        startDrag(i);
    });

    gridEl.addEventListener('pointermove', e => {
        if (!drag || running) return;
        e.preventDefault();
        const i = cellFromEvent(e);
        if (i >= 0) touchCell(i);
    });

    function endDrag(e) {
        if (!drag) return;
        drag = null;
        if (e && e.pointerId !== undefined) {
            try { gridEl.releasePointerCapture(e.pointerId); } catch (_) { }
        }
    }
    gridEl.addEventListener('pointerup', endDrag);
    gridEl.addEventListener('pointercancel', endDrag);
    window.addEventListener('pointerup', endDrag);

    /* ---------------- running a search ---------------- */

    function currentGrid() {
        return { cols: COLS, rows: ROWS, blocked, cost, start, end };
    }

    function setControlsDisabled(d) {
        [runBtn, genBtn, randomBtn, clearBtn, resetBtn, algoSel, sizeSel]
            .concat(Object.values(modeBtns))
            .forEach(el => { if (el) el.disabled = d; });
    }

    function describe(id, result, ms) {
        const algo = ALGORITHMS[id];
        if (!result.path) return `${algo.label}: no path — the target is walled off.`;
        const c = pathCost(result.path, cost);
        const steps = result.path.length - 1;
        return `${algo.label} · ${result.visited.length} cells explored · ` +
            `${steps} steps · cost ${c} · ${ms.toFixed(1)} ms`;
    }

    function stopAnimation() {
        if (animId !== null) { cancelAnimationFrame(animId); animId = null; }
        running = false;
        setControlsDisabled(false);
    }

    function runSearch(animate) {
        stopAnimation();
        const id = algoSel.value;
        const algo = ALGORITHMS[id];
        clearMarks();

        const t0 = performance.now();
        const result = algo.run(currentGrid());
        const ms = performance.now() - t0;

        const perFrame = SPEEDS[speedSel.value];
        hasResult = true;

        if (!animate || perFrame === Infinity) {
            for (const [i, side] of result.visited) marks[i] = side === 0 ? 1 : 2;
            if (result.path) for (const i of result.path) marks[i] = 3;
            render();
            setStatus(result.path ? 'Done.' : 'No path.');
            setStats(describe(id, result, ms));
            return;
        }

        running = true;
        setControlsDisabled(true);
        setStatus(`Running ${algo.label}...`);
        setStats('');

        const visited = result.visited;
        let v = 0, p = 0;
        const pathPerFrame = Math.max(1, Math.round(perFrame / 3));

        function frame() {
            if (v < visited.length) {
                for (let k = 0; k < perFrame && v < visited.length; k++, v++) {
                    const [i, side] = visited[v];
                    marks[i] = side === 0 ? 1 : 2;
                    paintCell(i);
                }
            } else if (result.path && p < result.path.length) {
                for (let k = 0; k < pathPerFrame && p < result.path.length; k++, p++) {
                    marks[result.path[p]] = 3;
                    paintCell(result.path[p]);
                }
            } else {
                running = false;
                animId = null;
                setControlsDisabled(false);
                setStatus(result.path ? 'Done.' : 'No path found.');
                setStats(describe(id, result, ms));
                return;
            }
            animId = requestAnimationFrame(frame);
        }
        animId = requestAnimationFrame(frame);
    }

    // While you drag over a solved grid, re-solve instantly on the next frame.
    function scheduleLiveRun() {
        if (liveId !== null) return;
        liveId = requestAnimationFrame(() => {
            liveId = null;
            runSearch(false);
        });
    }

    /* ---------------- grid presets ---------------- */

    function clearAll(keepEndpoints) {
        blocked.fill(0);
        cost.fill(1);
        clearMarks();
        if (!keepEndpoints) {
            start = idx(Math.floor(ROWS / 2), Math.max(1, Math.round(COLS * 0.12)));
            end = idx(Math.floor(ROWS / 2), Math.min(COLS - 2, Math.round(COLS * 0.88)));
        }
        hasResult = false;
        render();
        setStatus('');
        setStats('');
    }

    function randomWalls() {
        stopAnimation();
        blocked.fill(0); cost.fill(1); clearMarks();
        for (let i = 0; i < blocked.length; i++) {
            if (i === start || i === end) continue;
            const r = Math.random();
            if (r < 0.24) blocked[i] = 1;
            else if (r < 0.36) cost[i] = MUD_COST;
        }
        hasResult = false;
        render();
        setStatus('Random walls and mud generated.');
        setStats('');
    }

    function generatePerfectMaze() {
        stopAnimation();
        const gen = generateMaze(COLS, ROWS);
        blocked.set(gen);
        cost.fill(1);
        clearMarks();
        start = idx(1, 1);
        end = idx(ROWS - 2, COLS - 2);
        blocked[start] = 0; blocked[end] = 0;
        hasResult = false;
        render();
        setStatus('Perfect maze generated — exactly one route from start to end.');
        setStats('');
    }

    /* ---------------- wiring ---------------- */

    function setMode(m) {
        mode = m;
        Object.entries(modeBtns).forEach(([k, btn]) => {
            if (btn) btn.classList.toggle('active', k === m);
        });
    }

    function updateNote() {
        const algo = ALGORITHMS[algoSel.value];
        if (noteEl && algo) noteEl.textContent = algo.note;
    }

    Object.entries(modeBtns).forEach(([k, btn]) => {
        if (btn) btn.addEventListener('click', () => setMode(k));
    });
    if (runBtn) runBtn.addEventListener('click', () => runSearch(true));
    if (genBtn) genBtn.addEventListener('click', generatePerfectMaze);
    if (randomBtn) randomBtn.addEventListener('click', randomWalls);
    if (clearBtn) clearBtn.addEventListener('click', () => { stopAnimation(); clearAll(true); });
    if (resetBtn) resetBtn.addEventListener('click', () => { stopAnimation(); clearAll(false); });
    if (algoSel) algoSel.addEventListener('change', () => {
        updateNote();
        // Keep the board exactly as drawn, but drop the previous algorithm's
        // result and wait for Run — switching algorithms must not auto-solve.
        stopAnimation();
        clearMarks();
        hasResult = false;
        render();
        setStatus('');
        setStats('');
    });
    if (sizeSel) sizeSel.addEventListener('change', () => {
        stopAnimation();
        const s = SIZES[sizeSel.value];
        buildGrid(s.cols, s.rows);
        setStatus('');
    });

    // ---- init ----
    const defaultSize = window.innerWidth < 760 ? 'small' : 'medium';
    if (sizeSel) sizeSel.value = defaultSize;
    buildGrid(SIZES[defaultSize].cols, SIZES[defaultSize].rows);
    setMode('wall');
    updateNote();
})();
