// ============================================================
// マッスルパズル - Muscle Puzzle (Match-3 Game)
// ============================================================

(() => {
    'use strict';

    // --- Constants ---
    const COLS = 8;
    const ROWS = 8;
    const TILES = ['tile1', 'tile2', 'tile3', 'tile4', 'tile5', 'tile6', 'tile7'];
    const TILE_IMAGES = {};
    TILES.forEach(t => { TILE_IMAGES[t] = `tiles/${t}.png`; });
    const TILE_COLORS = {
        'tile1': '#ff2d55',
        'tile2': '#ff9500',
        'tile3': '#5e5ce6',
        'tile4': '#ff3b30',
        'tile5': '#ffd60a',
        'tile6': '#30d158',
        'tile7': '#00d4ff'
    };

    const SWAP_DURATION = 250;
    const FALL_DURATION = 300;
    const MATCH_DURATION = 350;
    const SPAWN_DURATION = 350;
    const CASCADE_PAUSE = 100;

    // --- Sound (Web Audio API) ---
    let audioCtx = null;

    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playTone(freq, duration, type = 'sine', volume = 0.15) {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    }

    function playMatchSound(comboCount) {
        const base = 600 + comboCount * 100;
        // ピロン！（上昇音）
        playTone(base, 0.12, 'sine', 0.15);
        setTimeout(() => playTone(base * 1.25, 0.12, 'sine', 0.15), 60);
        setTimeout(() => playTone(base * 1.5, 0.18, 'sine', 0.12), 120);
        if (comboCount >= 3) {
            // 大コンボはキラキラ追加
            setTimeout(() => playTone(base * 2, 0.25, 'triangle', 0.1), 180);
            setTimeout(() => playTone(base * 2.5, 0.3, 'triangle', 0.08), 250);
        }
    }

    // --- State ---
    let grid = [];          // grid[row][col] = emoji string
    let tileEls = [];       // tileEls[row][col] = DOM element
    let selected = null;    // { row, col }
    let score = 0;
    let level = 1;
    let combo = 0;
    let maxCombo = 0;
    let targetScore = 1000;
    let animating = false;

    // --- DOM refs ---
    const $board = document.getElementById('board');
    const $particles = document.getElementById('particles');
    const $score = document.getElementById('score');
    const $level = document.getElementById('level');
    const $combo = document.getElementById('combo');
    const $progressBar = document.getElementById('progress-bar');
    const $progressText = document.getElementById('progress-text');
    const $boardContainer = document.getElementById('board-container');

    // Screens
    const $titleScreen = document.getElementById('title-screen');
    const $gameScreen = document.getElementById('game-screen');
    const $levelClearScreen = document.getElementById('level-clear-screen');
    const $gameoverScreen = document.getElementById('gameover-screen');

    // --- Helpers ---
    function randomTile() {
        return TILES[Math.floor(Math.random() * TILES.length)];
    }

    function showScreen(screen) {
        [$titleScreen, $gameScreen, $levelClearScreen, $gameoverScreen].forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    }

    function updateUI() {
        $score.textContent = score.toLocaleString();
        $level.textContent = level;
        $combo.textContent = combo;
        const progress = Math.min(score / targetScore, 1);
        $progressBar.style.width = (progress * 100) + '%';
        $progressText.textContent = `${score.toLocaleString()} / ${targetScore.toLocaleString()}`;
    }

    // --- Board Generation ---
    function generateBoard() {
        grid = [];
        for (let r = 0; r < ROWS; r++) {
            grid[r] = [];
            for (let c = 0; c < COLS; c++) {
                let tile;
                do {
                    tile = randomTile();
                } while (wouldMatch(r, c, tile));
                grid[r][c] = tile;
            }
        }
    }

    function wouldMatch(row, col, tile) {
        // Check horizontal
        if (col >= 2 && grid[row][col - 1] === tile && grid[row][col - 2] === tile) return true;
        // Check vertical
        if (row >= 2 && grid[row - 1] && grid[row - 1][col] === tile && grid[row - 2] && grid[row - 2][col] === tile) return true;
        return false;
    }

    // --- Rendering ---
    function renderBoard() {
        $board.innerHTML = '';
        tileEls = [];
        for (let r = 0; r < ROWS; r++) {
            tileEls[r] = [];
            for (let c = 0; c < COLS; c++) {
                const el = document.createElement('div');
                el.className = 'tile';
                const img = document.createElement('img');
                img.src = TILE_IMAGES[grid[r][c]];
                img.draggable = false;
                el.appendChild(img);
                el.dataset.row = r;
                el.dataset.col = c;
                el.addEventListener('click', () => onTileClick(r, c));
                setupTouchEvents(el, r, c);
                $board.appendChild(el);
                tileEls[r][c] = el;
            }
        }
    }

    function updateTileContent(r, c) {
        if (tileEls[r] && tileEls[r][c]) {
            const el = tileEls[r][c];
            let img = el.querySelector('img');
            if (!img) {
                img = document.createElement('img');
                img.draggable = false;
                el.innerHTML = '';
                el.appendChild(img);
            }
            img.src = TILE_IMAGES[grid[r][c]];
        }
    }

    // --- Touch/Swipe Support ---
    function setupTouchEvents(el, row, col) {
        let startX, startY;
        el.addEventListener('touchstart', (e) => {
            if (animating) return;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
        }, { passive: true });

        el.addEventListener('touchend', (e) => {
            if (animating) return;
            const touch = e.changedTouches[0];
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            // If it was more of a tap than a swipe
            if (absDx < 15 && absDy < 15) {
                onTileClick(row, col);
                return;
            }

            // Determine swipe direction
            let targetRow = row, targetCol = col;
            if (absDx > absDy) {
                targetCol += dx > 0 ? 1 : -1;
            } else {
                targetRow += dy > 0 ? 1 : -1;
            }

            if (targetRow >= 0 && targetRow < ROWS && targetCol >= 0 && targetCol < COLS) {
                // Select first, then attempt swap
                selected = { row, col };
                tileEls[row][col].classList.add('selected');
                attemptSwap(targetRow, targetCol);
            }
        }, { passive: true });
    }

    // --- Tile Selection & Swap ---
    function onTileClick(row, col) {
        if (animating) return;

        if (!selected) {
            selected = { row, col };
            tileEls[row][col].classList.add('selected');
            return;
        }

        if (selected.row === row && selected.col === col) {
            tileEls[row][col].classList.remove('selected');
            selected = null;
            return;
        }

        attemptSwap(row, col);
    }

    function isAdjacent(r1, c1, r2, c2) {
        return (Math.abs(r1 - r2) + Math.abs(c1 - c2)) === 1;
    }

    async function attemptSwap(row, col) {
        const { row: r1, col: c1 } = selected;
        tileEls[r1][c1].classList.remove('selected');

        if (!isAdjacent(r1, c1, row, col)) {
            // Not adjacent - just re-select the new tile
            selected = { row, col };
            tileEls[row][col].classList.add('selected');
            return;
        }

        selected = null;
        animating = true;

        // Perform swap in data
        [grid[r1][c1], grid[row][col]] = [grid[row][col], grid[r1][c1]];

        // Check if swap creates matches
        const matches = findAllMatches();
        if (matches.length === 0) {
            // Invalid swap - revert
            [grid[r1][c1], grid[row][col]] = [grid[row][col], grid[r1][c1]];
            await animateInvalidSwap(r1, c1, row, col);
            animating = false;
            return;
        }

        // Animate swap
        await animateSwap(r1, c1, row, col);

        // Process matches in cascade
        combo = 0;
        await processCascade();

        // Check level clear
        if (score >= targetScore) {
            await delay(300);
            levelClear();
            animating = false;
            return;
        }

        // Check game over
        if (!hasValidMoves()) {
            await delay(500);
            gameOver();
            animating = false;
            return;
        }

        animating = false;
    }

    // --- Animations ---
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function animateSwap(r1, c1, r2, c2) {
        const el1 = tileEls[r1][c1];
        const el2 = tileEls[r2][c2];
        const tileSize = el1.offsetWidth + 2; // tile + gap

        const dr = r2 - r1;
        const dc = c2 - c1;

        el1.classList.add('swapping');
        el2.classList.add('swapping');

        el1.style.transform = `translate(${dc * tileSize}px, ${dr * tileSize}px)`;
        el2.style.transform = `translate(${-dc * tileSize}px, ${-dr * tileSize}px)`;

        await delay(SWAP_DURATION);

        el1.classList.remove('swapping');
        el2.classList.remove('swapping');
        el1.style.transform = '';
        el2.style.transform = '';

        // Swap DOM content
        updateTileContent(r1, c1);
        updateTileContent(r2, c2);

        // Swap element references
        [tileEls[r1][c1], tileEls[r2][c2]] = [tileEls[r2][c2], tileEls[r1][c1]];
        tileEls[r1][c1].dataset.row = r1;
        tileEls[r1][c1].dataset.col = c1;
        tileEls[r2][c2].dataset.row = r2;
        tileEls[r2][c2].dataset.col = c2;

        // Update image content to match grid
        updateTileContent(r1, c1);
        updateTileContent(r2, c2);
    }

    async function animateInvalidSwap(r1, c1, r2, c2) {
        const el1 = tileEls[r1][c1];
        const el2 = tileEls[r2][c2];
        el1.classList.add('invalid-swap');
        el2.classList.add('invalid-swap');
        await delay(400);
        el1.classList.remove('invalid-swap');
        el2.classList.remove('invalid-swap');
    }

    // --- Match Detection ---
    function findAllMatches() {
        const matched = new Set();

        // Check horizontal
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS - 2; c++) {
                const tile = grid[r][c];
                if (tile && tile === grid[r][c + 1] && tile === grid[r][c + 2]) {
                    let end = c + 2;
                    while (end + 1 < COLS && grid[r][end + 1] === tile) end++;
                    for (let i = c; i <= end; i++) matched.add(`${r},${i}`);
                }
            }
        }

        // Check vertical
        for (let c = 0; c < COLS; c++) {
            for (let r = 0; r < ROWS - 2; r++) {
                const tile = grid[r][c];
                if (tile && tile === grid[r + 1][c] && tile === grid[r + 2][c]) {
                    let end = r + 2;
                    while (end + 1 < ROWS && grid[end + 1][c] === tile) end++;
                    for (let i = r; i <= end; i++) matched.add(`${i},${c}`);
                }
            }
        }

        return [...matched].map(s => {
            const [r, c] = s.split(',').map(Number);
            return { row: r, col: c };
        });
    }

    // --- Cascade Processing ---
    async function processCascade() {
        let matches = findAllMatches();

        while (matches.length > 0) {
            combo++;
            if (combo > maxCombo) maxCombo = combo;

            // Calculate score for this match set
            const basePoints = matches.length * 10;
            const comboMultiplier = Math.min(combo, 10);
            const points = basePoints * comboMultiplier;
            score += points;

            // Show combo and score visual feedback
            showMatchEffects(matches, points);
            playMatchSound(combo);

            if (combo >= 3) {
                $boardContainer.classList.add('shake');
                setTimeout(() => $boardContainer.classList.remove('shake'), 400);
            }

            updateUI();

            // Animate matched tiles
            matches.forEach(({ row, col }) => {
                tileEls[row][col].classList.add('matched');
                spawnParticles(row, col, grid[row][col]);
            });

            await delay(MATCH_DURATION);

            // Remove matched tiles (set to null)
            matches.forEach(({ row, col }) => {
                grid[row][col] = null;
            });

            // Collapse columns (tiles fall down)
            await collapseAndFill();

            await delay(CASCADE_PAUSE);

            // Check for new matches
            matches = findAllMatches();
        }
    }

    async function collapseAndFill() {
        // Process each column
        for (let c = 0; c < COLS; c++) {
            // Find empty spaces and collapse
            let emptySlots = 0;
            for (let r = ROWS - 1; r >= 0; r--) {
                if (grid[r][c] === null) {
                    emptySlots++;
                } else if (emptySlots > 0) {
                    // Move this tile down by emptySlots
                    grid[r + emptySlots][c] = grid[r][c];
                    grid[r][c] = null;
                }
            }

            // Fill from top
            for (let r = 0; r < emptySlots; r++) {
                grid[r][c] = randomTile();
            }
        }

        // Re-render efficiently
        renderBoard();

        // Animate new tiles spawning in
        for (let c = 0; c < COLS; c++) {
            // Find how many were empty (new tiles at top)
            // We can detect spawn by checking which tiles are new - simplified: animate all top tiles
        }

        // Add spawn animation to tiles that just appeared
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                tileEls[r][c].classList.add('spawning');
            }
        }

        await delay(SPAWN_DURATION);

        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                tileEls[r][c].classList.remove('spawning');
            }
        }
    }

    // --- Visual Effects ---
    function spawnParticles(row, col, tile) {
        const el = tileEls[row][col];
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const containerRect = $particles.getBoundingClientRect();
        const cx = rect.left - containerRect.left + rect.width / 2;
        const cy = rect.top - containerRect.top + rect.height / 2;
        const color = TILE_COLORS[tile] || '#fff';

        for (let i = 0; i < 6; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            const angle = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
            const dist = 30 + Math.random() * 40;
            p.style.left = cx + 'px';
            p.style.top = cy + 'px';
            p.style.background = color;
            p.style.boxShadow = `0 0 6px ${color}`;
            p.style.setProperty('--px', Math.cos(angle) * dist + 'px');
            p.style.setProperty('--py', Math.sin(angle) * dist + 'px');
            $particles.appendChild(p);
            setTimeout(() => p.remove(), 700);
        }
    }

    function showMatchEffects(matches, points) {
        // Find center of matched tiles for combo text
        const containerRect = $particles.getBoundingClientRect();
        let avgX = 0, avgY = 0;
        matches.forEach(({ row, col }) => {
            const el = tileEls[row][col];
            if (!el) return;
            const rect = el.getBoundingClientRect();
            avgX += rect.left - containerRect.left + rect.width / 2;
            avgY += rect.top - containerRect.top + rect.height / 2;
        });
        avgX /= matches.length;
        avgY /= matches.length;

        // Score popup
        const scoreEl = document.createElement('div');
        scoreEl.className = 'score-popup';
        scoreEl.textContent = `+${points}`;
        scoreEl.style.left = avgX + 'px';
        scoreEl.style.top = avgY + 'px';
        $particles.appendChild(scoreEl);
        setTimeout(() => scoreEl.remove(), 800);

        // Combo text for combos >= 2
        if (combo >= 2) {
            const comboEl = document.createElement('div');
            comboEl.className = 'combo-text';
            const comboLabels = ['', '', 'ダブル！', 'トリプル！', 'すごい！', 'マッスル！', '超マッスル！', '神マッスル！'];
            comboEl.textContent = `${combo}コンボ！ ${comboLabels[Math.min(combo, 7)] || '💪MAX💪'}`;
            comboEl.style.left = avgX + 'px';
            comboEl.style.top = (avgY - 30) + 'px';
            $particles.appendChild(comboEl);
            setTimeout(() => comboEl.remove(), 1000);
        }
    }

    // --- Valid Moves Detection ---
    function hasValidMoves() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                // Try swap right
                if (c + 1 < COLS) {
                    [grid[r][c], grid[r][c + 1]] = [grid[r][c + 1], grid[r][c]];
                    if (findAllMatches().length > 0) {
                        [grid[r][c], grid[r][c + 1]] = [grid[r][c + 1], grid[r][c]];
                        return true;
                    }
                    [grid[r][c], grid[r][c + 1]] = [grid[r][c + 1], grid[r][c]];
                }
                // Try swap down
                if (r + 1 < ROWS) {
                    [grid[r][c], grid[r + 1][c]] = [grid[r + 1][c], grid[r][c]];
                    if (findAllMatches().length > 0) {
                        [grid[r][c], grid[r + 1][c]] = [grid[r + 1][c], grid[r][c]];
                        return true;
                    }
                    [grid[r][c], grid[r + 1][c]] = [grid[r + 1][c], grid[r][c]];
                }
            }
        }
        return false;
    }

    function findHintMove() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (c + 1 < COLS) {
                    [grid[r][c], grid[r][c + 1]] = [grid[r][c + 1], grid[r][c]];
                    if (findAllMatches().length > 0) {
                        [grid[r][c], grid[r][c + 1]] = [grid[r][c + 1], grid[r][c]];
                        return [{ row: r, col: c }, { row: r, col: c + 1 }];
                    }
                    [grid[r][c], grid[r][c + 1]] = [grid[r][c + 1], grid[r][c]];
                }
                if (r + 1 < ROWS) {
                    [grid[r][c], grid[r + 1][c]] = [grid[r + 1][c], grid[r][c]];
                    if (findAllMatches().length > 0) {
                        [grid[r][c], grid[r + 1][c]] = [grid[r + 1][c], grid[r][c]];
                        return [{ row: r, col: c }, { row: r + 1, col: c }];
                    }
                    [grid[r][c], grid[r + 1][c]] = [grid[r + 1][c], grid[r][c]];
                }
            }
        }
        return null;
    }

    // --- Hint ---
    function showHint() {
        if (animating) return;
        const hint = findHintMove();
        if (hint) {
            hint.forEach(({ row, col }) => {
                tileEls[row][col].classList.add('hint');
                setTimeout(() => tileEls[row][col].classList.remove('hint'), 1800);
            });
        }
    }

    // --- Level / Game State ---
    function levelClear() {
        document.getElementById('clear-score').textContent = score.toLocaleString();
        document.getElementById('clear-combo').textContent = maxCombo;
        showScreen($levelClearScreen);
    }

    function nextLevel() {
        level++;
        targetScore = Math.floor(1000 * Math.pow(1.5, level - 1));
        score = 0;
        maxCombo = 0;
        combo = 0;
        generateBoard();

        // Ensure valid moves exist
        while (!hasValidMoves()) {
            generateBoard();
        }

        renderBoard();
        updateUI();
        showScreen($gameScreen);
    }

    function gameOver() {
        document.getElementById('final-score').textContent = score.toLocaleString();
        document.getElementById('final-level').textContent = level;
        document.getElementById('final-combo').textContent = maxCombo;
        showScreen($gameoverScreen);
    }

    function startGame() {
        score = 0;
        level = 1;
        combo = 0;
        maxCombo = 0;
        targetScore = 1000;
        selected = null;
        animating = false;

        generateBoard();

        // Ensure valid moves exist
        while (!hasValidMoves()) {
            generateBoard();
        }

        renderBoard();
        updateUI();
        showScreen($gameScreen);
    }

    // --- Event Listeners ---
    document.getElementById('start-btn').addEventListener('click', startGame);
    document.getElementById('retry-btn').addEventListener('click', startGame);
    document.getElementById('next-level-btn').addEventListener('click', nextLevel);
    document.getElementById('hint-btn').addEventListener('click', showHint);

    // Prevent context menu on long press
    document.addEventListener('contextmenu', e => e.preventDefault());

})();
