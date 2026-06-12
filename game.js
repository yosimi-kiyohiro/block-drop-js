// ============================================================
// テトリス game.js
// ------------------------------------------------------------
// 設計方針：
// ・ゲームの状態はすべて gameState オブジェクトに集約する
// ・時間管理は requestAnimationFrame に一本化する
//   （ロック遅延も setTimeout ではなく経過時間で数える）
// ・Canvas は devicePixelRatio 対応で高解像度スマホでも滲まない
// ============================================================

// ============================================================
// 定数
// ============================================================

const COLS = 10;       // 盤面の列数
const ROWS = 20;       // 盤面の行数（隠し行なし。上部2行がスポーン位置）
const CELL_SIZE = 30;  // 1マスの大きさ（CSSピクセル）

// 盤面の色
const BOARD_BG_COLOR = '#10101f';   // 盤面の背景（ページ背景より少し暗い）
const GRID_LINE_COLOR = '#2a2a45';  // グリッド枠線

// テトリミノ7種類の定義（形と標準7色）
// shape は 1 = ブロックあり、0 = 空き。回転はステップ3aで実装する
const TETROMINOES = {
  I: { color: '#3dd6e8', shape: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
  O: { color: '#f5d93d', shape: [[1, 1], [1, 1]] },
  T: { color: '#b15ce8', shape: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
  S: { color: '#5ce86b', shape: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
  Z: { color: '#e85c5c', shape: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
  J: { color: '#5c7ae8', shape: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
  L: { color: '#e8a04c', shape: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
};

// 自動落下の間隔（ms）。レベルに応じた加速はステップ4で実装する
const BASE_DROP_INTERVAL = 1000;

// ロック遅延：着地してから固定までの猶予時間（ms）と、
// 操作によるリセットの上限回数（無限に粘れないようにする）
const LOCK_DELAY_MS = 500;
const MAX_LOCK_DELAY_RESETS = 15;

// ライン消去のスコア（同時に消した行数ごと。0行・1行・2行・3行・4行）
const LINE_SCORES = [0, 100, 300, 500, 800];

// 演出の長さ（ms）
const FLASH_DURATION_MS = 200; // ライン消去の白フラッシュ
const SHAKE_DURATION_MS = 150; // ハードドロップのぶれ

// ============================================================
// ゲーム状態（すべての状態をここに集約する）
// ============================================================

const gameState = {
  board: [],              // 盤面：ROWS×COLS の2次元配列（0 = 空きマス）
  currentPiece: null,     // 現在のテトリミノ（形・色・位置・向き）
  nextPiece: null,        // 次のテトリミノ（NEXT 表示用）
  heldPiece: null,        // ホールド中のテトリミノ
  hasHeldThisTurn: false, // このターンでホールド済みか（連続ホールド防止）
  bag: [],                // 7-bag 方式の残りリスト
  score: 0,               // スコア
  level: 1,               // レベル（10ライン消すごとに上がる）
  linesCleared: 0,        // 消したライン数の合計
  lockDelayElapsed: 0,    // ロック遅延の経過時間（ms）。rAF内で加算する
  lockDelayResets: 0,     // ロック遅延をリセットした回数（最大15回）
  isGameOver: false,      // ゲームオーバーか
  isPaused: false,        // 一時停止中か
  isAnimating: false,     // 演出中か（演出中は入力を無視する）
  lastTime: 0,            // 前フレームの時刻（rAF の時間管理用）
  dropElapsed: 0,         // 自動落下用にためた経過時間（ms）
  isStarted: false,       // スタートボタンが押されてゲームが始まったか
  lineFlash: null,        // ライン消去演出 { rows: 消す行, elapsed: 経過ms }
  shakeElapsed: null,     // ハードドロップぶれ演出の経過ms（null = 演出なし）
};

// ============================================================
// Canvas の初期化（devicePixelRatio 対応）
// ============================================================

// CSSピクセルと物理ピクセルの違いを吸収する。
// CSS で決まった「実際の表示サイズ」に内部解像度を合わせるので、
// PC で大きく表示しても高解像度スマホでも滲まない。
// 描画コードは常に「論理サイズ」（盤面なら300×600）の座標のままでよい。
// ※ 表示サイズは読み込み時に一度だけ測る（ウィンドウサイズを変えたら再読み込み）
function setupCanvas(canvas, logicalWidth, logicalHeight) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const displayWidth = rect.width || logicalWidth;
  const displayHeight = rect.height || logicalHeight;
  canvas.width = displayWidth * dpr;   // 内部解像度（物理ピクセル）
  canvas.height = displayHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale((displayWidth / logicalWidth) * dpr, (displayHeight / logicalHeight) * dpr);
  return ctx;
}

const boardCanvas = document.getElementById('board-canvas');
const boardCtx = setupCanvas(boardCanvas, COLS * CELL_SIZE, ROWS * CELL_SIZE);

const nextCanvas = document.getElementById('next-canvas');
const nextCtx = setupCanvas(nextCanvas, 100, 100);

const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = setupCanvas(holdCanvas, 100, 100);

// スコア表示・オーバーレイなどの画面要素
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const linesEl = document.getElementById('lines');
const overlayEl = document.getElementById('overlay');
const overlayMessageEl = document.getElementById('overlay-message');
const overlayButtonEl = document.getElementById('overlay-button');

// ============================================================
// 盤面の初期化
// ============================================================

// ROWS行 × COLS列 をすべて 0（空き）で埋めた2次元配列を作る
function createEmptyBoard() {
  const board = [];
  for (let row = 0; row < ROWS; row++) {
    board.push(new Array(COLS).fill(0));
  }
  return board;
}

// ============================================================
// 7-bag 方式のテトリミノ生成
// ============================================================

// 袋が空になったら7種類を1セット補充する。
// シャッフルは Fisher-Yates 方式（偏りが出ない正しいシャッフル）
function refillBag() {
  const types = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]]; // 要素を入れ替える
  }
  gameState.bag.push(...types);
}

// 袋から次のテトリミノの種類を1つ取り出す
function takeFromBag() {
  if (gameState.bag.length === 0) {
    refillBag();
  }
  return gameState.bag.shift();
}

// テトリミノのオブジェクトを作る（盤面上部の中央に配置）
function createPiece(type) {
  const def = TETROMINOES[type];
  return {
    type: type,
    color: def.color,
    shape: def.shape.map((row) => [...row]), // 元の定義を壊さないようコピー
    row: 0,                                            // 上端からスタート
    col: Math.floor((COLS - def.shape[0].length) / 2), // 横は中央
  };
}

// 新しいテトリミノを出現させる（NEXT から繰り上げる）
function spawnPiece() {
  if (gameState.nextPiece === null) {
    gameState.nextPiece = createPiece(takeFromBag());
  }
  gameState.currentPiece = gameState.nextPiece;
  gameState.nextPiece = createPiece(takeFromBag());
  gameState.hasHeldThisTurn = false; // 新しいターンなのでホールド解禁
  gameState.lockDelayElapsed = 0;    // ロック遅延も新しいピース用にリセット
  gameState.lockDelayResets = 0;

  // スポーン位置がすでに埋まっていたらゲームオーバー
  const piece = gameState.currentPiece;
  if (checkCollision(piece.shape, piece.row, piece.col)) {
    gameOver();
  }
}

// ============================================================
// 衝突判定と固定
// ============================================================

// shape を (row, col) に置いたとき、壁・床・積まれたブロックに
// ぶつかるなら true を返す
function checkCollision(shape, row, col) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] === 0) continue; // 空きマスは調べない

      const boardRow = row + r;
      const boardCol = col + c;

      // 左右の壁・床の外に出ていたら衝突
      if (boardCol < 0 || boardCol >= COLS || boardRow >= ROWS) {
        return true;
      }
      // 盤面内で、すでにブロックが積まれていたら衝突
      // （boardRow < 0 は盤面より上なので調べない）
      if (boardRow >= 0 && gameState.board[boardRow][boardCol] !== 0) {
        return true;
      }
    }
  }
  return false;
}

// 現在のテトリミノを盤面に固定して、次のテトリミノを出す
function lockPiece() {
  const piece = gameState.currentPiece;
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 0) continue;
      const boardRow = piece.row + r;
      const boardCol = piece.col + c;
      if (boardRow >= 0) {
        gameState.board[boardRow][boardCol] = piece.color; // 色を書き込む
      }
    }
  }
  const fullRows = findFullRows();
  if (fullRows.length === 0) {
    spawnPiece(); // 消える行がなければすぐ次のテトリミノを出す
  } else {
    // 消える行を白く光らせる演出を始める（実際に消すのは200ms後）
    gameState.currentPiece = null; // 固定済みなので手放す
    gameState.isAnimating = true;  // 演出中は入力を無視する
    gameState.lineFlash = { rows: fullRows, elapsed: 0 };
  }
}

// そろっている行の番号一覧を返す（上から順）
function findFullRows() {
  const rows = [];
  for (let row = 0; row < ROWS; row++) {
    if (gameState.board[row].every((cell) => cell !== 0)) {
      rows.push(row);
    }
  }
  return rows;
}

// 行を実際に消して、スコア・レベルを更新する
function applyLineClear(rows) {
  // 上の行から順に処理すれば、まだ消していない下の行の番号はずれない
  // （1行消すたびに一番上へ空行を足すので、その行より下の位置は変わらない）
  for (const row of rows) {
    gameState.board.splice(row, 1);                   // そろった行を取り除く
    gameState.board.unshift(new Array(COLS).fill(0)); // 一番上に空の行を足す
  }

  const cleared = rows.length;
  gameState.score += LINE_SCORES[cleared];
  gameState.linesCleared += cleared;
  // 10ライン消すごとにレベルアップ（0〜9ライン=Lv1、10〜19=Lv2…）
  gameState.level = Math.floor(gameState.linesCleared / 10) + 1;
}

// 現在のレベルに応じた自動落下の間隔（レベルが上がるほど速い・最速100ms）
function dropInterval() {
  return Math.max(100, BASE_DROP_INTERVAL - (gameState.level - 1) * 100);
}

// テトリミノが着地しているか（1マス下に動けない状態か）
function isGrounded() {
  const piece = gameState.currentPiece;
  return checkCollision(piece.shape, piece.row + 1, piece.col);
}

// 着地中に移動・回転できた時、固定までの猶予を延長する。
// ただしリセットは最大15回まで（無限に粘れないようにする）
function tryResetLockDelay() {
  if (isGrounded() && gameState.lockDelayResets < MAX_LOCK_DELAY_RESETS) {
    gameState.lockDelayElapsed = 0;
    gameState.lockDelayResets++;
  }
}

// テトリミノを1マス下に動かす。
// 着地していても即固定はしない（固定はロック遅延が判断する）
function stepDown() {
  const piece = gameState.currentPiece;
  if (!checkCollision(piece.shape, piece.row + 1, piece.col)) {
    piece.row++;
  }
}

// ============================================================
// 操作（移動・回転・ドロップ）
// ============================================================

// 左右に1マス動かす（dCol：-1 = 左、+1 = 右）
function movePiece(dCol) {
  const piece = gameState.currentPiece;
  if (!checkCollision(piece.shape, piece.row, piece.col + dCol)) {
    piece.col += dCol;
    tryResetLockDelay(); // 着地中の移動なら固定までの猶予を延長
  }
}

// ソフトドロップ：1マス下に落とす（自動落下のタイマーもリセット）
function softDrop() {
  stepDown();
  gameState.dropElapsed = 0;
}

// ハードドロップ：一番下まで一気に落として即固定する
// （ロック遅延はスキップする仕様）
function hardDrop() {
  const piece = gameState.currentPiece;
  while (!checkCollision(piece.shape, piece.row + 1, piece.col)) {
    piece.row++;
  }
  lockPiece();
  gameState.dropElapsed = 0;
  gameState.shakeElapsed = 0; // 着地の重さを表現するぶれ演出を始める
}

// 行列を時計回りに90度回転する（転置＋行の反転と同じ結果）
// rotated[r][c] = shape[size-1-c][r] という対応になる
function rotateMatrix(shape) {
  const size = shape.length;
  const rotated = [];
  for (let r = 0; r < size; r++) {
    rotated.push([]);
    for (let c = 0; c < size; c++) {
      rotated[r].push(shape[size - 1 - c][r]);
    }
  }
  return rotated;
}

// テトリミノを回転する。壁際・床の上で回転できない時は
// 左右や上に少しずらして試す（簡易ウォールキック＋フロアキック）
function rotatePiece() {
  const piece = gameState.currentPiece;
  if (piece.type === 'O') return; // Oミノは回転しても形が同じ

  const rotated = rotateMatrix(piece.shape);

  // ずらして試す量 [行, 列]。行の -1 は「1マス上」（床にめり込む時の逃がし）。
  // Iミノは長いので2マスずらしも試す
  const kicks = piece.type === 'I'
    ? [[0, 0], [0, -1], [0, 1], [0, -2], [0, 2], [-1, 0], [-2, 0]]
    : [[0, 0], [0, -1], [0, 1], [-1, 0]];

  for (const [dRow, dCol] of kicks) {
    if (!checkCollision(rotated, piece.row + dRow, piece.col + dCol)) {
      piece.shape = rotated;
      piece.row += dRow;
      piece.col += dCol;
      tryResetLockDelay(); // 着地中の回転なら固定までの猶予を延長
      return;
    }
  }
  // どこにもずらせなければ回転しない
}

// ホールド：現在のテトリミノを取り置きして入れ替える。
// 1ターン（次の固定まで）に1回しか使えない
function holdPiece() {
  if (gameState.hasHeldThisTurn) return; // このターンはもうホールド済み

  const currentType = gameState.currentPiece.type;
  const held = gameState.heldPiece;

  // 現在のミノを取り置きする（形・位置は初期状態に戻す）
  gameState.heldPiece = createPiece(currentType);

  if (held === null) {
    // 初回ホールド：取り置きだけして次のミノを出す
    spawnPiece();
  } else {
    // 2回目以降：取り置きしていたミノと入れ替える
    gameState.currentPiece = createPiece(held.type);
    gameState.lockDelayElapsed = 0;
    gameState.lockDelayResets = 0;
  }

  // spawnPiece() が false に戻すので、その後に true にする
  gameState.hasHeldThisTurn = true;
}

// ============================================================
// 描画
// ============================================================

// 1マス分のブロックを描く（暗い枠線つきで隣と区別しやすくする）
function drawCell(ctx, row, col, color) {
  const x = col * CELL_SIZE;
  const y = row * CELL_SIZE;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);
}

// 盤面に固定済みのブロックをすべて描く
function drawLockedCells() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (gameState.board[row][col] !== 0) {
        drawCell(boardCtx, row, col, gameState.board[row][col]);
      }
    }
  }
}

// ゴースト（落下先の影）の行位置を計算する。
// 現在の位置から衝突するまで1マスずつ下にたどる
function getGhostRow() {
  const piece = gameState.currentPiece;
  let row = piece.row;
  while (!checkCollision(piece.shape, row + 1, piece.col)) {
    row++;
  }
  return row;
}

// ゴーストを描く（半透明の塗り＋輪郭線で本体と区別する）
function drawGhost() {
  const piece = gameState.currentPiece;
  if (piece === null) return;

  const ghostRow = getGhostRow();
  if (ghostRow === piece.row) return; // 本体と重なる時は描かない

  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 0) continue;
      if (ghostRow + r < 0) continue;

      const x = (piece.col + c) * CELL_SIZE;
      const y = (ghostRow + r) * CELL_SIZE;

      // 半透明の塗り
      boardCtx.globalAlpha = 0.25;
      boardCtx.fillStyle = piece.color;
      boardCtx.fillRect(x, y, CELL_SIZE, CELL_SIZE);
      boardCtx.globalAlpha = 1;

      // 輪郭線
      boardCtx.strokeStyle = piece.color;
      boardCtx.lineWidth = 1;
      boardCtx.strokeRect(x + 1.5, y + 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
    }
  }
}

// 落下中のテトリミノを描く
function drawCurrentPiece() {
  const piece = gameState.currentPiece;
  if (piece === null) return;
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 0) continue;
      if (piece.row + r < 0) continue; // 盤面より上は描かない
      drawCell(boardCtx, piece.row + r, piece.col + c, piece.color);
    }
  }
}

// 盤面の背景とグリッド枠線を描く
function drawBoard() {
  // 背景を塗りつぶす
  boardCtx.fillStyle = BOARD_BG_COLOR;
  boardCtx.fillRect(0, 0, COLS * CELL_SIZE, ROWS * CELL_SIZE);

  // グリッド枠線（縦線と横線）
  boardCtx.strokeStyle = GRID_LINE_COLOR;
  boardCtx.lineWidth = 1;

  for (let col = 0; col <= COLS; col++) {
    boardCtx.beginPath();
    boardCtx.moveTo(col * CELL_SIZE, 0);
    boardCtx.lineTo(col * CELL_SIZE, ROWS * CELL_SIZE);
    boardCtx.stroke();
  }
  for (let row = 0; row <= ROWS; row++) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, row * CELL_SIZE);
    boardCtx.lineTo(COLS * CELL_SIZE, row * CELL_SIZE);
    boardCtx.stroke();
  }
}

// NEXT・HOLD パネルにテトリミノを小さく描く（中央寄せ）
function drawPreview(ctx, piece) {
  const PANEL_SIZE = 100;
  const cell = 20; // パネル内のマスは小さめにする

  // パネルの背景をクリア
  ctx.fillStyle = BOARD_BG_COLOR;
  ctx.fillRect(0, 0, PANEL_SIZE, PANEL_SIZE);

  if (piece === null || piece === undefined) return;

  // ブロックがある範囲（上下左右の端）を調べて中央寄せの位置を計算する
  let minR = piece.shape.length, maxR = -1, minC = piece.shape.length, maxC = -1;
  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 0) continue;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }
  const offsetX = (PANEL_SIZE - (maxC - minC + 1) * cell) / 2 - minC * cell;
  const offsetY = (PANEL_SIZE - (maxR - minR + 1) * cell) / 2 - minR * cell;

  for (let r = 0; r < piece.shape.length; r++) {
    for (let c = 0; c < piece.shape[r].length; c++) {
      if (piece.shape[r][c] === 0) continue;
      const x = offsetX + c * cell;
      const y = offsetY + r * cell;
      ctx.fillStyle = piece.color;
      ctx.fillRect(x, y, cell, cell);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }
}

// 消える行を白く光らせる（ライン消去演出）
function drawLineFlash() {
  if (gameState.lineFlash === null) return;
  boardCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  for (const row of gameState.lineFlash.rows) {
    boardCtx.fillRect(0, row * CELL_SIZE, COLS * CELL_SIZE, CELL_SIZE);
  }
}

// 1フレーム分の描画をまとめて行う
function draw() {
  // ハードドロップのぶれ：盤面全体を縦に小さくゆらす（減衰しながら2往復）
  let shakeY = 0;
  if (gameState.shakeElapsed !== null) {
    const progress = gameState.shakeElapsed / SHAKE_DURATION_MS; // 0→1
    shakeY = 3 * Math.sin(progress * Math.PI * 4) * (1 - progress);
  }

  boardCtx.save();
  boardCtx.translate(0, shakeY);

  drawBoard();        // 背景とグリッド
  drawLockedCells();  // 積まれたブロック
  drawGhost();        // ゴースト（落下先の影）
  drawCurrentPiece(); // 落下中のブロック
  drawLineFlash();    // ライン消去の白フラッシュ

  boardCtx.restore();

  // ゲームオーバー時は盤面全体をグレーアウトする
  if (gameState.isGameOver) {
    boardCtx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    boardCtx.fillRect(0, 0, COLS * CELL_SIZE, ROWS * CELL_SIZE);
  }

  drawPreview(nextCtx, gameState.nextPiece);  // NEXT パネル
  drawPreview(holdCtx, gameState.heldPiece);  // HOLD パネル
}

// スコア・レベル・ライン数の画面表示を更新する
function updateStatus() {
  scoreEl.textContent = gameState.score;
  levelEl.textContent = gameState.level;
  linesEl.textContent = gameState.linesCleared;
}

// ============================================================
// 入力（キーボード＋タッチボタン共通）
// ============================================================

// 入力を受け付けてよい状態か
function canControl() {
  return gameState.isStarted &&
    !(gameState.isGameOver || gameState.isPaused || gameState.isAnimating);
}

document.addEventListener('keydown', (event) => {
  // 一時停止の切り替え（P / Esc）はプレイ中・一時停止中いつでも受け付ける
  if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') {
    togglePause();
    return;
  }

  // 開始前・ゲームオーバー・一時停止・演出中は操作を受け付けない
  if (!canControl()) {
    return;
  }

  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault(); // 矢印キーで画面がスクロールするのを防ぐ
      movePiece(-1);
      break;
    case 'ArrowRight':
      event.preventDefault();
      movePiece(1);
      break;
    case 'ArrowDown':
      event.preventDefault();
      softDrop();
      break;
    case 'ArrowUp':
      event.preventDefault();
      rotatePiece();
      break;
    case ' ': // スペースキー
      event.preventDefault();
      hardDrop();
      break;
    case 'c':
    case 'C':
      holdPiece();
      break;
  }
});

// ------------------------------------------------------------
// タッチボタン（pointerdown / pointerup でタッチとマウス共通）
// ------------------------------------------------------------

// 長押しタイマーを全部止めるための一覧（リスタート時にも使う）
const repeatStoppers = [];

// 「ポインタが枠の外に出ていたら止める」判定関数の一覧。
// ボタン自身にイベントが届かないケースがあるため、ページ全体で監視する
const repeatCheckers = [];

// 長押しボタン：押した瞬間に1回動き、押しっぱなしで連続実行する
function bindRepeatButton(id, action) {
  const button = document.getElementById(id);
  let timer = null;

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  repeatStoppers.push(stop);

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault(); // スクロールなどブラウザの標準動作を止める
    if (!canControl()) return;
    action();
    stop(); // 念のため古いタイマーを止めてから開始する
    timer = setInterval(() => {
      if (canControl()) action();
    }, 130);
  });
  // 指を離した・ボタンの外に出た・OSに中断された時は必ず止める
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);

  // ページ全体の監視用：押している間にポインタがボタンの枠の外に
  // 出ていたら止める（座標で判定するのでブラウザの内部動作に依存しない）
  repeatCheckers.push((x, y) => {
    if (timer === null) return; // 押していない時は何もしない
    const rect = button.getBoundingClientRect();
    const inside =
      x >= rect.left && x <= rect.right &&
      y >= rect.top && y <= rect.bottom;
    if (!inside) {
      stop();
    }
  });
  // 長押しで右クリックメニューが出るのを防ぐ
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

// 単発ボタン：押した瞬間に1回だけ実行する
function bindActionButton(id, action) {
  const button = document.getElementById(id);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (!canControl()) return;
    action();
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

bindRepeatButton('btn-left', () => movePiece(-1));
bindRepeatButton('btn-right', () => movePiece(1));
bindRepeatButton('btn-down', softDrop);
bindActionButton('btn-rotate', rotatePiece);
bindActionButton('btn-harddrop', hardDrop);
bindActionButton('btn-hold', holdPiece);

// オーバーレイのボタン1つで「スタート・再開・リスタート」を受け持つ
overlayButtonEl.addEventListener('click', () => {
  if (gameState.isPaused) {
    togglePause(); // 一時停止からの再開
  } else {
    startGame();   // 開始前のスタート／ゲームオーバー後のリスタート
  }
});

// ⏸ ボタンで一時停止 ⇔ 再開
document.getElementById('btn-pause').addEventListener('click', togglePause);

// 保険：ボタン自身にイベントが届かなくても、ページ全体なら必ず届く。
// 指の移動のたびに「枠の外に出ていないか」を判定し、
// どこで指を離しても・OSに中断されても全部の長押しを止める
function stopAllRepeats() {
  repeatStoppers.forEach((stop) => stop());
}
document.addEventListener('pointermove', (event) => {
  repeatCheckers.forEach((check) => check(event.clientX, event.clientY));
});
document.addEventListener('pointerup', stopAllRepeats);
document.addEventListener('pointercancel', stopAllRepeats);

// ============================================================
// ゲーム進行（スタート・一時停止・ゲームオーバー・リスタート）
// ============================================================

// 盤面に重ねるオーバーレイ（スタート・一時停止・ゲームオーバーで共用）
function showOverlay(message, buttonLabel) {
  overlayMessageEl.textContent = message;
  overlayButtonEl.textContent = buttonLabel;
  overlayEl.classList.remove('hidden');
}

function hideOverlay() {
  overlayEl.classList.add('hidden');
}

// ゲームの状態をまっさらに戻す（後始末の一覧）
function resetGame() {
  stopAllRepeats();                     // ① 長押しタイマーを全部止める
  gameState.board = createEmptyBoard(); // ② 盤面を空にする
  gameState.bag = [];                   // ③ 7-bag を作り直す
  gameState.currentPiece = null;
  gameState.nextPiece = null;
  gameState.heldPiece = null;
  gameState.hasHeldThisTurn = false;
  gameState.score = 0;                  // ④ スコア・レベル・ライン数を初期化
  gameState.level = 1;
  gameState.linesCleared = 0;
  gameState.lockDelayElapsed = 0;       // ⑤ ロック遅延・落下の経過時間を初期化
  gameState.lockDelayResets = 0;
  gameState.dropElapsed = 0;
  gameState.isGameOver = false;         // ⑥ フラグ・演出を初期化
  gameState.isPaused = false;
  gameState.isAnimating = false;
  gameState.lineFlash = null;
  gameState.shakeElapsed = null;
  spawnPiece();                         // ⑦ 最初のテトリミノを出す
}

// スタート（ゲームオーバー後のリスタートも同じ。まっさらにして開始）
function startGame() {
  resetGame();
  gameState.isStarted = true;
  hideOverlay();
}

// 一時停止 ⇔ 再開 を切り替える
function togglePause() {
  if (!gameState.isStarted || gameState.isGameOver) return;
  gameState.isPaused = !gameState.isPaused;
  if (gameState.isPaused) {
    stopAllRepeats(); // 長押し中だったら止める
    showOverlay('一時停止中', '▶ 再開');
  } else {
    hideOverlay();
  }
}

// ゲームオーバー処理
function gameOver() {
  gameState.isGameOver = true;
  stopAllRepeats();
  showOverlay('ゲームオーバー', 'リスタート');
}

// ============================================================
// ゲームループ（requestAnimationFrame に時間管理を一本化）
// ============================================================

function update(time) {
  // 初回フレームは経過時間が計算できないのでスキップする
  if (gameState.lastTime === 0) {
    gameState.lastTime = time;
    requestAnimationFrame(update);
    return;
  }

  // 前フレームからの経過時間（ms）。タブを切り替えて戻った時に
  // ブロックが瞬間移動しないよう、最大50msに制限する
  let delta = time - gameState.lastTime;
  gameState.lastTime = time;
  if (delta > 50) {
    delta = 50;
  }

  // ゲームが進行中の時だけ、落下とロック遅延の時間を進める
  // （開始前・一時停止中・ゲームオーバー中は描画だけ続ける）
  const isRunning =
    gameState.isStarted && !gameState.isPaused && !gameState.isGameOver;

  if (isRunning) {
    if (gameState.lineFlash !== null) {
      // ライン消去演出中：時間だけ進めて、200msたったら実際に消す
      gameState.lineFlash.elapsed += delta;
      if (gameState.lineFlash.elapsed >= FLASH_DURATION_MS) {
        applyLineClear(gameState.lineFlash.rows);
        gameState.lineFlash = null;
        gameState.isAnimating = false;
        spawnPiece();
      }
    } else {
      // 経過時間をためて、落下間隔を超えたら1マス落とす
      gameState.dropElapsed += delta;
      if (gameState.dropElapsed >= dropInterval()) {
        gameState.dropElapsed = 0;
        stepDown();
      }

      // ロック遅延：着地中だけ経過時間をためて、500msたったら固定する。
      // 空中にいる間は常に0に戻る（setTimeout を使わず rAF に一本化）
      if (gameState.currentPiece !== null && isGrounded()) {
        gameState.lockDelayElapsed += delta;
        if (gameState.lockDelayElapsed >= LOCK_DELAY_MS) {
          lockPiece();
        }
      } else {
        gameState.lockDelayElapsed = 0;
      }
    }

    // ハードドロップのぶれ演出：150msで終わる
    if (gameState.shakeElapsed !== null) {
      gameState.shakeElapsed += delta;
      if (gameState.shakeElapsed >= SHAKE_DURATION_MS) {
        gameState.shakeElapsed = null;
      }
    }
  }

  draw();
  updateStatus();
  requestAnimationFrame(update);
}

// ============================================================
// 起動処理
// ============================================================

function init() {
  gameState.board = createEmptyBoard();
  showOverlay('Block Drop', '▶ スタート'); // 開始前はスタート画面を出す
  requestAnimationFrame(update);
}

init();
