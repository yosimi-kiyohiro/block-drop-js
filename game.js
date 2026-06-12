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
// 描画
// ============================================================

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

// ============================================================
// 起動処理
// ============================================================

function init() {
  gameState.board = createEmptyBoard();
  drawBoard();
}

init();
