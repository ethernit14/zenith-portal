(function () {
    const COLS = 25;
    const ROWS = 15;
    const gridEl = document.getElementById('mazeGrid');
    const statusEl = document.getElementById('mazeStatus');
    if (!gridEl) return;

    const modeWallBtn = document.getElementById('mazeModeWall');
    const modeStartBtn = document.getElementById('mazeModeStart');
    const modeEndBtn = document.getElementById('mazeModeEnd');
    const bfsBtn = document.getElementById('mazeBfs');
    const astarBtn = document.getElementById('mazeAstar');
    const clearWallsBtn = document.getElementById('mazeClearWalls');
    const randomBtn = document.getElementById('mazeRandom');
    const resetBtn = document.getElementById('mazeReset');
    const allButtons = [bfsBtn, astarBtn, clearWallsBtn, randomBtn, resetBtn, modeWallBtn, modeStartBtn, modeEndBtn];

    let mode = 'wall';
    let start = { r: 2, c: 2 };
    let end = { r: ROWS - 3, c: COLS - 3 };
    let walls = new Set();
    let running = false;

    const cellEls = [];

    function key(r, c) { return r + ',' + c; }

    function buildGrid() {
        gridEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
        gridEl.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
        for (let r = 0; r < ROWS; r++) {
            const row = [];
            for (let c = 0; c < COLS; c++) {
                const cell = document.createElement('div');
                cell.className = 'maze-cell';
                cell.addEventListener('click', () => handleCellClick(r, c));
                gridEl.appendChild(cell);
                row.push(cell);
            }
            cellEls.push(row);
        }
    }

    function handleCellClick(r, c) {
        if (running) return;
        if (mode === 'start') {
            if (key(r, c) === key(end.r, end.c) || walls.has(key(r, c))) return;
            start = { r, c };
        } else if (mode === 'end') {
            if (key(r, c) === key(start.r, start.c) || walls.has(key(r, c))) return;
            end = { r, c };
        } else {
            if (key(r, c) === key(start.r, start.c) || key(r, c) === key(end.r, end.c)) return;
            const k = key(r, c);
            if (walls.has(k)) walls.delete(k); else walls.add(k);
        }
        render();
    }

    function setMode(m) {
        mode = m;
        [modeWallBtn, modeStartBtn, modeEndBtn].forEach(btn => btn.classList.remove('active'));
        if (m === 'wall') modeWallBtn.classList.add('active');
        if (m === 'start') modeStartBtn.classList.add('active');
        if (m === 'end') modeEndBtn.classList.add('active');
    }

    function render() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cell = cellEls[r][c];
                cell.className = 'maze-cell';
                const k = key(r, c);
                if (r === start.r && c === start.c) cell.classList.add('start');
                else if (r === end.r && c === end.c) cell.classList.add('end');
                else if (walls.has(k)) cell.classList.add('wall');
            }
        }
    }

    function clearSearchMarks() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                cellEls[r][c].classList.remove('visited', 'path');
            }
        }
    }

    function neighbors(r, c) {
        const deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        const result = [];
        for (const [dr, dc] of deltas) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && !walls.has(key(nr, nc))) {
                result.push({ r: nr, c: nc });
            }
        }
        return result;
    }

    function reconstructPath(cameFrom, endKey) {
        const path = [];
        let cur = endKey;
        while (cameFrom.has(cur)) {
            path.push(cur);
            cur = cameFrom.get(cur);
        }
        path.push(cur);
        path.reverse();
        return path;
    }

    function bfs() {
        const startKey = key(start.r, start.c);
        const endKey = key(end.r, end.c);
        const visitedOrder = [];
        const cameFrom = new Map();
        const seen = new Set([startKey]);
        const queue = [{ r: start.r, c: start.c }];
        let found = false;

        while (queue.length) {
            const cur = queue.shift();
            const curKey = key(cur.r, cur.c);
            visitedOrder.push(curKey);
            if (curKey === endKey) { found = true; break; }
            for (const n of neighbors(cur.r, cur.c)) {
                const nk = key(n.r, n.c);
                if (!seen.has(nk)) {
                    seen.add(nk);
                    cameFrom.set(nk, curKey);
                    queue.push(n);
                }
            }
        }
        return { visitedOrder, path: found ? reconstructPath(cameFrom, endKey) : null };
    }

    function astar() {
        const startKey = key(start.r, start.c);
        const endKey = key(end.r, end.c);
        const heuristic = (r, c) => Math.abs(r - end.r) + Math.abs(c - end.c);
        const gScore = new Map([[startKey, 0]]);
        const fScore = new Map([[startKey, heuristic(start.r, start.c)]]);
        const cameFrom = new Map();
        const open = new Map([[startKey, { r: start.r, c: start.c }]]);
        const visitedOrder = [];
        let found = false;

        while (open.size) {
            let curKey = null, curBestF = Infinity;
            for (const [k, v] of open) {
                const f = fScore.has(k) ? fScore.get(k) : Infinity;
                if (f < curBestF) { curBestF = f; curKey = k; }
            }
            const cur = open.get(curKey);
            open.delete(curKey);
            visitedOrder.push(curKey);

            if (curKey === endKey) { found = true; break; }

            for (const n of neighbors(cur.r, cur.c)) {
                const nk = key(n.r, n.c);
                const tentativeG = gScore.get(curKey) + 1;
                if (tentativeG < (gScore.has(nk) ? gScore.get(nk) : Infinity)) {
                    cameFrom.set(nk, curKey);
                    gScore.set(nk, tentativeG);
                    fScore.set(nk, tentativeG + heuristic(n.r, n.c));
                    if (!open.has(nk)) open.set(nk, n);
                }
            }
        }
        return { visitedOrder, path: found ? reconstructPath(cameFrom, endKey) : null };
    }

    function keyToCell(k) {
        const [r, c] = k.split(',').map(Number);
        return { r, c };
    }

    function setButtonsDisabled(disabled) {
        allButtons.forEach(btn => { if (btn) btn.disabled = disabled; });
    }

    function animateResult(result, label) {
        running = true;
        setButtonsDisabled(true);
        clearSearchMarks();
        const { visitedOrder, path } = result;
        let i = 0;
        const startKey = key(start.r, start.c);
        const endKey = key(end.r, end.c);

        statusEl.textContent = `Running ${label}...`;

        function stepVisited() {
            if (i >= visitedOrder.length) {
                if (path) {
                    animatePath(path, label);
                } else {
                    statusEl.textContent = `${label}: no path found.`;
                    running = false;
                    setButtonsDisabled(false);
                }
                return;
            }
            const k = visitedOrder[i];
            if (k !== startKey && k !== endKey) {
                const { r, c } = keyToCell(k);
                cellEls[r][c].classList.add('visited');
            }
            i++;
            setTimeout(stepVisited, 6);
        }
        stepVisited();
    }

    function animatePath(path, label) {
        let i = 0;
        const startKey = key(start.r, start.c);
        const endKey = key(end.r, end.c);
        function stepPath() {
            if (i >= path.length) {
                statusEl.textContent = `${label}: path found — ${path.length - 1} steps.`;
                running = false;
                setButtonsDisabled(false);
                return;
            }
            const k = path[i];
            if (k !== startKey && k !== endKey) {
                const { r, c } = keyToCell(k);
                cellEls[r][c].classList.add('path');
            }
            i++;
            setTimeout(stepPath, 20);
        }
        stepPath();
    }

    function runBfs() {
        if (running) return;
        animateResult(bfs(), 'BFS');
    }

    function runAstar() {
        if (running) return;
        animateResult(astar(), 'A*');
    }

    function clearWalls() {
        if (running) return;
        walls.clear();
        clearSearchMarks();
        render();
        statusEl.textContent = '';
    }

    function randomMaze() {
        if (running) return;
        walls.clear();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if ((r === start.r && c === start.c) || (r === end.r && c === end.c)) continue;
                if (Math.random() < 0.28) walls.add(key(r, c));
            }
        }
        clearSearchMarks();
        render();
        statusEl.textContent = 'Random walls generated.';
    }

    function fullReset() {
        if (running) return;
        walls.clear();
        start = { r: 2, c: 2 };
        end = { r: ROWS - 3, c: COLS - 3 };
        clearSearchMarks();
        render();
        statusEl.textContent = '';
    }

    modeWallBtn.addEventListener('click', () => setMode('wall'));
    modeStartBtn.addEventListener('click', () => setMode('start'));
    modeEndBtn.addEventListener('click', () => setMode('end'));
    bfsBtn.addEventListener('click', runBfs);
    astarBtn.addEventListener('click', runAstar);
    clearWallsBtn.addEventListener('click', clearWalls);
    randomBtn.addEventListener('click', randomMaze);
    resetBtn.addEventListener('click', fullReset);

    buildGrid();
    setMode('wall');
    render();
})();
