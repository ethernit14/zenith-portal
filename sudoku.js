(function () {
    const boardEl = document.getElementById('sudokuBoard');
    const statusEl = document.getElementById('sudokuStatus');
    const solveBtn = document.getElementById('sudokuSolve');
    const clearBtn = document.getElementById('sudokuClear');
    const exampleBtn = document.getElementById('sudokuExample');

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

    function writeGrid(grid, markSolvedFrom) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                const cell = cells[r * 9 + c];
                const wasEmpty = !markSolvedFrom[r][c];
                cell.value = grid[r][c] || '';
                cell.classList.toggle('solved', wasEmpty && !!grid[r][c]);
            }
        }
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

    function solve(grid) {
        for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
                if (grid[r][c] === 0) {
                    for (let num = 1; num <= 9; num++) {
                        if (isValid(grid, r, c, num)) {
                            grid[r][c] = num;
                            if (solve(grid)) return true;
                            grid[r][c] = 0;
                        }
                    }
                    return false;
                }
            }
        }
        return true;
    }

    function clearMarks() {
        cells.forEach(cell => cell.classList.remove('invalid', 'solved', 'given'));
    }

    function loadExample() {
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
        cells.forEach(cell => { cell.value = ''; });
        clearMarks();
        setStatus('');
    }

    function handleSolve() {
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

        if (solve(grid)) {
            writeGrid(grid, original);
            setStatus('Solved!');
        } else {
            setStatus('No solution exists for this puzzle.', true);
        }
    }

    solveBtn.addEventListener('click', handleSolve);
    clearBtn.addEventListener('click', clearBoard);
    exampleBtn.addEventListener('click', loadExample);
})();
