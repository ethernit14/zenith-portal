(function () {
    const boardEl = document.getElementById('sudokuBoard');
    const statusEl = document.getElementById('sudokuStatus');
    const stepEl = document.getElementById('sudokuSteps');
    const solveBtn = document.getElementById('sudokuSolve');
    const stopBtn = document.getElementById('sudokuStop');
    const skipBtn = document.getElementById('sudokuSkip');
    const clearBtn = document.getElementById('sudokuClear');
    const exampleBtn = document.getElementById('sudokuExample');
    const speedSlider = document.getElementById('sudokuSpeed');

    if (!boardEl) return;

    const EXAMPLE = [
        '53..7....',
        '6..195...',
        '.98....6.',
        '8...6...3',
        '4..8.3..1',
        '7...2...6',
        '.6....28.',
        '...419..5',
        '....8..79'
    ];

    // Build the 81 cells
    const cells = [];
    for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
            const input = document.createElement('input');
            input.className = 'sudoku-cell';
            input.setAttribute('inputmode', 'numeric');
            input.setAttribute('maxlength', '1');
            if (c === 2 || c === 5) input.classList.add('border-right');
            if (r === 2 || r === 5) input.classList.add('border-bottom');
            input.addEventListener('input', () => {
                input.value = input.value.replace(/[^1-9]/g, '').slice(0, 1);
                input.classList.remove('solved', 'invalid');
                setStatus('');
            });
            input.addEventListener('keydown', (e) => handleNav(e, r, c));
            boardEl.appendChild(input);
            cells.push(input);
        }
    }

    // ---- animation state ----
    let solving = false;
    let stopRequested = false;
    let fastForward = false;
    let stepCount = 0;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getDelay() {
        return fastForward ? 0 : parseInt(speedSlider.value, 10);
    }

    function handleNav(e, r, c) {
        const dirs = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
        if (dirs[e.key]) {
            e.preventDefault();
            const [dr, dc] = dirs[e.key];
            const nr = Math.min(8, Math.max(0, r + dr));
            const nc = Math.min(8, Math.max(0, c + dc));
            cells[nr * 9 + nc].focus();
        }
    }

    function setStatus(text, isError) {
        statusEl.textContent = text;
        statusEl.style.color = isError ? '#f5576c' : '#f093fb';
    }

    function setStepCount() {
        stepEl.textContent = solving ? `${stepCount} placements tried` : '';
    }

    function readGrid() {
        const grid = [];
        for (let r = 0; r < 9; r++) {
            const row = [];
            for (let c = 0; c < 9; c++) {
                const v = cells[r * 9 + c].value;
                row.push(v ? parseInt(v, 10) : 0);
            }
            grid.push(row);
        }
        return grid;
    }

    function isValid(grid, row, col, num) {
        for (let i = 0; i < 9; i++) {
            if (grid[row][i] === num) return false;
            if (grid[i][col] === num) return false;
        }
        const br = Math.floor(row / 3) * 3;
        const bc = Math.floor(col / 3) * 3;
        for (let r = br; r < br + 3; r++) {
            for (let c = bc; c < bc + 3; c++) {
                if (grid[r][c] === num) return false;
            }
        }
        return true;
    }

    // ---- animated backtracking solve ----
    // Same algorithm as a plain recursive solver, but it touches the actual
    // DOM cells live and awaits a short delay at every placement and every
    // backtrack, so you can watch the search happen.
    async function solveAnimated(grid) {
        if (stopRequested) return 'stopped';

        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] === 0) {
                    const cell = cells[r * 9 + c];
                    for (let num = 1; num <= 9; num++) {
                        if (stopRequested) return 'stopped';
                        if (isValid(grid, r, c, num)) {
                            grid[r][c] = num;
                            stepCount++;
                            cell.value = num;
                            cell.classList.remove('backtrack');
                            cell.classList.add('trying');
                            setStepCount();
                            await sleep(getDelay());

                            const result = await solveAnimated(grid);
                            if (result === true) return true;
                            if (result === 'stopped') return 'stopped';

                            // dead end further down -- undo this placement
                            grid[r][c] = 0;
                            cell.classList.remove('trying');
                            cell.classList.add('backtrack');
                            await sleep(getDelay());
                            cell.value = '';
                            cell.classList.remove('backtrack');
                        }
                    }
                    return false; // no digit worked here -- signal backtrack up
                }
            }
        }
        return true; // no empty cells left
    }

    function clearMarks() {
        cells.forEach(cell => cell.classList.remove('invalid', 'solved', 'given', 'trying', 'backtrack'));
    }

    function setInputsDisabled(disabled) {
        cells.forEach(cell => { cell.disabled = disabled; });
    }

    function loadExample() {
        if (solving) return;
        clearMarks();
        EXAMPLE.forEach((rowStr, r) => {
            rowStr.split('').forEach((ch, c) => {
                const cell = cells[r * 9 + c];
                cell.value = ch === '.' ? '' : ch;
                cell.classList.toggle('given', ch !== '.');
            });
        });
        setStatus('Example puzzle loaded.');
    }

    function clearBoard() {
        if (solving) return;
        cells.forEach(cell => { cell.value = ''; });
        clearMarks();
        setStatus('');
    }

    function setSolvingUI(isSolving) {
        solving = isSolving;
        solveBtn.style.display = isSolving ? 'none' : 'inline-block';
        stopBtn.style.display = isSolving ? 'inline-block' : 'none';
        skipBtn.style.display = isSolving ? 'inline-block' : 'none';
        clearBtn.disabled = isSolving;
        exampleBtn.disabled = isSolving;
        setInputsDisabled(isSolving);
    }

    async function handleSolve() {
        const original = readGrid();
        const grid = original.map(row => row.slice());

        // Validate the starting numbers don't already conflict
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const val = grid[r][c];
                if (val !== 0) {
                    grid[r][c] = 0;
                    if (!isValid(grid, r, c, val)) {
                        cells[r * 9 + c].classList.add('invalid');
                        grid[r][c] = val;
                        setStatus('That puzzle has conflicting numbers.', true);
                        return;
                    }
                    grid[r][c] = val;
                }
            }
        }

        stopRequested = false;
        fastForward = false;
        stepCount = 0;
        setSolvingUI(true);
        setStatus('Solving...');

        const result = await solveAnimated(grid);

        setSolvingUI(false);

        if (result === 'stopped') {
            // restore exactly what the user typed, discard the attempt
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    const cell = cells[r * 9 + c];
                    cell.value = original[r][c] || '';
                    cell.classList.remove('trying', 'backtrack');
                }
            }
            setStatus('Stopped.');
        } else if (result === true) {
            for (let r = 0; r < 9; r++) {
                for (let c = 0; c < 9; c++) {
                    const cell = cells[r * 9 + c];
                    cell.classList.remove('trying', 'backtrack');
                    if (!original[r][c]) cell.classList.add('solved');
                }
            }
            setStatus(`Solved! (${stepCount} placements tried)`);
        } else {
            setStatus('No solution exists for this puzzle.', true);
        }
        setStepCount();
    }

    function handleStop() {
        stopRequested = true;
    }

    function handleSkip() {
        fastForward = true;
    }

    solveBtn.addEventListener('click', handleSolve);
    stopBtn.addEventListener('click', handleStop);
    skipBtn.addEventListener('click', handleSkip);
    clearBtn.addEventListener('click', clearBoard);
    exampleBtn.addEventListener('click', loadExample);
})();
