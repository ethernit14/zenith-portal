(function () {
    const HUMAN = 'X';
    const AI = 'O';
    const WIN_LINES = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    let board = Array(9).fill(null);
    let gameOver = false;

    const boardEl = document.getElementById('tttBoard');
    const statusEl = document.getElementById('tttStatus');
    const resetBtn = document.getElementById('tttReset');

    if (!boardEl) return;

    function checkWinner(b) {
        for (const [a, c, d] of WIN_LINES) {
            if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
        }
        if (b.every(cell => cell)) return 'draw';
        return null;
    }

    function minimax(b, depth, isMaximizing) {
        const winner = checkWinner(b);
        if (winner === AI) return 10 - depth;
        if (winner === HUMAN) return depth - 10;
        if (winner === 'draw') return 0;

        if (isMaximizing) {
            let best = -Infinity;
            for (let i = 0; i < 9; i++) {
                if (!b[i]) {
                    b[i] = AI;
                    best = Math.max(best, minimax(b, depth + 1, false));
                    b[i] = null;
                }
            }
            return best;
        } else {
            let best = Infinity;
            for (let i = 0; i < 9; i++) {
                if (!b[i]) {
                    b[i] = HUMAN;
                    best = Math.min(best, minimax(b, depth + 1, true));
                    b[i] = null;
                }
            }
            return best;
        }
    }

    function bestMove(b) {
        let bestScore = -Infinity;
        let move = -1;
        for (let i = 0; i < 9; i++) {
            if (!b[i]) {
                b[i] = AI;
                const score = minimax(b, 0, false);
                b[i] = null;
                if (score > bestScore) {
                    bestScore = score;
                    move = i;
                }
            }
        }
        return move;
    }

    function render() {
        boardEl.querySelectorAll('.ttt-cell').forEach((cell, i) => {
            cell.textContent = board[i] || '';
            cell.classList.toggle('filled', !!board[i]);
            cell.classList.toggle('x', board[i] === 'X');
            cell.classList.toggle('o', board[i] === 'O');
        });
    }

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function endGame(winner) {
        gameOver = true;
        if (winner === 'draw') setStatus("It's a draw.");
        else if (winner === HUMAN) setStatus('You win! 🎉');
        else setStatus('AI wins.');
    }

    function handleCellClick(i) {
        if (gameOver || board[i]) return;
        board[i] = HUMAN;
        render();

        let winner = checkWinner(board);
        if (winner) { endGame(winner); return; }

        setStatus('AI is thinking...');
        setTimeout(() => {
            const move = bestMove(board);
            if (move !== -1) board[move] = AI;
            render();
            winner = checkWinner(board);
            if (winner) { endGame(winner); return; }
            setStatus('Your turn (X)');
        }, 250);
    }

    function newGame() {
        board = Array(9).fill(null);
        gameOver = false;
        render();
        setStatus('Your turn (X)');
    }

    boardEl.querySelectorAll('.ttt-cell').forEach((cell, i) => {
        cell.addEventListener('click', () => handleCellClick(i));
    });
    if (resetBtn) resetBtn.addEventListener('click', newGame);

    newGame();
})();
