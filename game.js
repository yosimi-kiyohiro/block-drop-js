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
};

// ============================================================
// Canvas の初期化（devicePixelRatio 対応）
// ============================================================

// CSSピクセルと物理ピクセルの違いを吸収する。
// 例：DPR=2 のスマホでは内部解像度を2倍にして、描画は2倍に拡大する。
// こうすると Retina などの高解像度画面でも線が滲まない。
function setupCanvas(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;   // 内部解像度（物理ピクセル）
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);             // 以降は CSS ピクセル感覚で描ける
  return ctx;
}

const boardCanvas = document.getElementById('board-canvas');
const boardCtx = setupCanvas(boardCanvas, COLS * CELL_SIZE, ROWS * CELL_SIZE);

const nextCanvas = document.getElementById('next-canvas');
const nextCtx = setupCanvas(nextCanvas, 100, 100);

const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = setupCanvas(holdCanvas, 100, 100);

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
  // ※ スポーン位置が埋まっていたらゲームオーバー（ステップ4で実装）
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
  // ※ ライン消去はステップ4で実装する
  spawnPiece();
}

// テトリミノを1マス下に動かす。動けなければ固定する
function stepDown() {
  const piece = gameState.currentPiece;
  if (!checkCollision(piece.shape, piece.row + 1, piece.col)) {
    piece.row++;
  } else {
    lockPiece();
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
  }
}

// ソフトドロップ：1マス下に落とす（自動落下のタイマーもリセット）
function softDrop() {
  stepDown();
  gameState.dropElapsed = 0;
}

// ハードドロップ：一番下まで一気に落として即固定する
// （ロック遅延はスキップする仕様。ぶれ演出はステップ5で追加）
function hardDrop() {
  const piece = gameState.currentPiece;
  while (!checkCollision(piece.shape, piece.row + 1, piece.col)) {
    piece.row++;
  }
  lockPiece();
  gameState.dropElapsed = 0;
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

// テトリミノを回転する。壁際で回転できない時は左右に
// 少しずらして試す（簡易ウォールキック）
function rotatePiece() {
  const piece = gameState.currentPiece;
  if (piece.type === 'O') return; // Oミノは回転しても形が同じ

  const rotated = rotateMatrix(piece.shape);

  // ずらして試す量。Iミノは横に長いので2マスずらしも試す
  const kicks = piece.type === 'I' ? [0, -1, 1, -2, 2] : [0, -1, 1];

  for (const kick of kicks) {
    if (!checkCollision(rotated, piece.row, piece.col + kick)) {
      piece.shape = rotated;
      piece.col += kick;
      return;
    }
  }
  // どこにもずらせなければ回転しない
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

// 1フレーム分の描画をまとめて行う
function draw() {
  drawBoard();        // 背景とグリッド
  drawLockedCells();  // 積まれたブロック
  drawGhost();        // ゴースト（落下先の影）
  drawCurrentPiece(); // 落下中のブロック
}

// ============================================================
// キーボード入力
// ============================================================

document.addEventListener('keydown', (event) => {
  // ゲームオーバー・一時停止・演出中は操作を受け付けない
  if (gameState.isGameOver || gameState.isPaused || gameState.isAnimating) {
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
      // ホールド（ステップ3bで実装する）
      break;
  }
});

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

  // 経過時間をためて、落下間隔を超えたら1マス落とす
  gameState.dropElapsed += delta;
  if (gameState.dropElapsed >= BASE_DROP_INTERVAL) {
    gameState.dropElapsed = 0;
    stepDown();
  }

  draw();
  requestAnimationFrame(update);
}

// ============================================================
// 起動処理
// ============================================================

function init() {
  gameState.board = createEmptyBoard();
  spawnPiece();
  requestAnimationFrame(update);
}

init();
