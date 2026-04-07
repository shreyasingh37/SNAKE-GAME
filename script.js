const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('highScore');
const finalScoreEl = document.getElementById('finalScore');

const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');

const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const menuBtn = document.getElementById('menuBtn');

const pauseBtn = document.getElementById('pauseBtn');
const soundBtn = document.getElementById('soundBtn');
const themeBtn = document.getElementById('themeBtn');
const wrapBtn = document.getElementById('wrapBtn');

const difficultySelect = document.getElementById('difficulty');
const wallsToggle = document.getElementById('wallsToggle');
const soundToggle = document.getElementById('soundToggle');
const themeToggle = document.getElementById('themeToggle');

const dpadButtons = document.querySelectorAll('.dpad-btn');

// Core game state (mutated by the loop).
const state = {
  running: false,
  paused: false,
  score: 0,
  highScore: Number(localStorage.getItem('snakeBallHighScore') || 0),
  wallMode: true,
  soundOn: true,
  theme: 'dark',
  difficulty: 'medium',
  lastTime: 0,
  speed: 160,
  baseSpeed: 160,
  speedIncrease: 10,
  pointsForSpeed: 4,
  segmentRadius: 10,
  headRadius: 13,
  spacing: 16,
  snake: [],
  targetDir: { x: 1, y: 0 },
  dir: { x: 1, y: 0 },
  desiredLength: 14,
  foods: [],
  particles: [],
  obstacles: [],
  nextFoodTime: 0,
  pulse: 1,
  viewWidth: 0,
  viewHeight: 0,
};

// Difficulty tuning knobs.
const difficultyPresets = {
  easy: { baseSpeed: 140, speedIncrease: 8, pointsForSpeed: 5, obstacleCount: 3, poisonScore: 8 },
  medium: { baseSpeed: 170, speedIncrease: 12, pointsForSpeed: 4, obstacleCount: 5, poisonScore: 6 },
  hard: { baseSpeed: 200, speedIncrease: 16, pointsForSpeed: 3, obstacleCount: 7, poisonScore: 4 },
};

// Food definitions and their effects.
const foodTypes = {
  normal: { color: '#36e69f', glow: 'rgba(54,230,159,0.5)', radius: 8, points: 1, growth: 1, ttl: null },
  bonus: { color: '#47c7ff', glow: 'rgba(71,199,255,0.6)', radius: 9, points: 3, growth: 3, ttl: 5000 },
  poison: { color: '#ff5c7a', glow: 'rgba(255,92,122,0.5)', radius: 9, points: -2, growth: -3, ttl: null },
};

class SoundFX {
  constructor() {
    this.ctx = null;
  }
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.ctx;
  }
  beep(freq, duration, type = 'sine', volume = 0.2) {
    if (!state.soundOn) return;
    const audio = this.ensure();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    osc.stop(audio.currentTime + duration);
  }
  eat() {
    this.beep(520, 0.15, 'triangle', 0.18);
  }
  bonus() {
    this.beep(740, 0.2, 'sine', 0.2);
  }
  poison() {
    this.beep(180, 0.25, 'square', 0.2);
  }
  gameOver() {
    this.beep(110, 0.5, 'sawtooth', 0.22);
  }
}

const sfx = new SoundFX();

function resizeCanvas() {
  const parent = canvas.parentElement || document.body;
  const rect = parent.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.viewWidth = width;
  state.viewHeight = height;
}

function resetSnake() {
  const centerX = state.viewWidth / 2;
  const centerY = state.viewHeight / 2;
  state.snake = [];
  for (let i = 0; i < state.desiredLength; i += 1) {
    state.snake.push({ x: centerX - i * state.spacing, y: centerY });
  }
  state.dir = { x: 1, y: 0 };
  state.targetDir = { x: 1, y: 0 };
}

function applyDifficulty() {
  const preset = difficultyPresets[state.difficulty];
  state.baseSpeed = preset.baseSpeed;
  state.speedIncrease = preset.speedIncrease;
  state.pointsForSpeed = preset.pointsForSpeed;
  state.speed = state.baseSpeed;
  state.segmentRadius = state.difficulty === 'hard' ? 9 : 10;
  state.headRadius = state.segmentRadius + 3;
  state.spacing = state.segmentRadius * 1.6;
}

function generateObstacles() {
  state.obstacles = [];
  const preset = difficultyPresets[state.difficulty];
  const tries = 80;
  for (let i = 0; i < preset.obstacleCount; i += 1) {
    let attempt = 0;
    let obstacle = null;
    while (attempt < tries && !obstacle) {
      const width = randRange(40, 110);
      const height = randRange(30, 80);
      const x = randRange(30, state.viewWidth - width - 30);
      const y = randRange(40, state.viewHeight - height - 30);
      const rect = { x, y, width, height, vx: 0, vy: 0 };
      if (!rectIntersectsSnake(rect)) {
        obstacle = rect;
      }
      attempt += 1;
    }
    if (obstacle) state.obstacles.push(obstacle);
  }
  if (state.difficulty === 'hard') {
    state.obstacles.push({
      x: state.viewWidth * 0.3,
      y: state.viewHeight * 0.2,
      width: 90,
      height: 24,
      vx: 60,
      vy: 50,
    });
  }
}

function startGame() {
  state.score = 0;
  state.desiredLength = 14;
  state.foods = [];
  state.particles = [];
  state.pulse = 1;
  resizeCanvas();
  applyDifficulty();
  resetSnake();
  generateObstacles();
  spawnFood('normal');
  if (Math.random() < 0.4) spawnFood('bonus');
  state.nextFoodTime = 0;
  state.lastTime = performance.now();
  state.running = true;
  state.paused = false;
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  updateHUD();
}

function endGame() {
  state.running = false;
  state.paused = false;
  finalScoreEl.textContent = state.score;
  gameOverScreen.classList.remove('hidden');
  sfx.gameOver();
  if (state.score > state.highScore) {
    state.highScore = state.score;
    localStorage.setItem('snakeBallHighScore', state.highScore);
  }
  updateHUD();
}

function updateHUD() {
  scoreEl.textContent = state.score;
  highScoreEl.textContent = state.highScore;
  pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  soundBtn.textContent = `Sound: ${state.soundOn ? 'On' : 'Off'}`;
  themeBtn.textContent = `Theme: ${state.theme === 'dark' ? 'Dark' : 'Light'}`;
  wrapBtn.textContent = `Walls: ${state.wallMode ? 'On' : 'Off'}`;
}

function setDirection(x, y) {
  const length = Math.hypot(x, y);
  if (!length) return;
  state.targetDir = { x: x / length, y: y / length };
}

function spawnFood(type) {
  const def = foodTypes[type];
  const tries = 60;
  for (let i = 0; i < tries; i += 1) {
    const x = randRange(def.radius + 20, state.viewWidth - def.radius - 20);
    const y = randRange(def.radius + 20, state.viewHeight - def.radius - 20);
    const candidate = { x, y, type, createdAt: performance.now(), alpha: 0 };
    if (!foodCollides(candidate)) {
      state.foods.push(candidate);
      return;
    }
  }
}

function foodCollides(candidate) {
  for (const seg of state.snake) {
    if (distance(candidate, seg) < state.segmentRadius + foodTypes[candidate.type].radius + 8) {
      return true;
    }
  }
  for (const food of state.foods) {
    if (distance(candidate, food) < 30) return true;
  }
  for (const rect of state.obstacles) {
    if (circleRectCollide(candidate, foodTypes[candidate.type].radius, rect)) return true;
  }
  return false;
}

function maybeSpawnFood(now) {
  if (now < state.nextFoodTime) return;
  const normalCount = state.foods.filter((f) => f.type === 'normal').length;
  const bonusCount = state.foods.filter((f) => f.type === 'bonus').length;
  const poisonCount = state.foods.filter((f) => f.type === 'poison').length;
  if (normalCount < 2) spawnFood('normal');
  if (bonusCount < 1 && Math.random() < 0.25) spawnFood('bonus');
  const preset = difficultyPresets[state.difficulty];
  if (state.score >= preset.poisonScore && poisonCount < 1 && Math.random() < 0.3) {
    spawnFood('poison');
  }
  state.nextFoodTime = now + randRange(1200, 2200);
}

function updateSnake(dt) {
  const turnEase = 6;
  state.dir.x += (state.targetDir.x - state.dir.x) * Math.min(dt * turnEase, 1);
  state.dir.y += (state.targetDir.y - state.dir.y) * Math.min(dt * turnEase, 1);
  const dirLen = Math.hypot(state.dir.x, state.dir.y) || 1;
  state.dir.x /= dirLen;
  state.dir.y /= dirLen;

  const head = state.snake[0];
  head.x += state.dir.x * state.speed * dt;
  head.y += state.dir.y * state.speed * dt;

  if (state.wallMode) {
    if (
      head.x < state.headRadius ||
      head.x > state.viewWidth - state.headRadius ||
      head.y < state.headRadius ||
      head.y > state.viewHeight - state.headRadius
    ) {
      endGame();
      return;
    }
  } else {
    if (head.x < -state.headRadius) head.x = state.viewWidth + state.headRadius;
    if (head.x > state.viewWidth + state.headRadius) head.x = -state.headRadius;
    if (head.y < -state.headRadius) head.y = state.viewHeight + state.headRadius;
    if (head.y > state.viewHeight + state.headRadius) head.y = -state.headRadius;
  }

  for (let i = 1; i < state.snake.length; i += 1) {
    const prev = state.snake[i - 1];
    const seg = state.snake[i];
    const dx = prev.x - seg.x;
    const dy = prev.y - seg.y;
    const dist = Math.hypot(dx, dy);
    if (dist > state.spacing) {
      const t = (dist - state.spacing) / dist;
      seg.x += dx * t;
      seg.y += dy * t;
    }
  }

  while (state.snake.length < state.desiredLength) {
    const tail = state.snake[state.snake.length - 1];
    state.snake.push({ x: tail.x, y: tail.y });
  }
}

function updateObstacles(dt) {
  for (const rect of state.obstacles) {
    if (!rect.vx && !rect.vy) continue;
    rect.x += rect.vx * dt;
    rect.y += rect.vy * dt;
    if (rect.x < 20 || rect.x + rect.width > state.viewWidth - 20) rect.vx *= -1;
    if (rect.y < 20 || rect.y + rect.height > state.viewHeight - 20) rect.vy *= -1;
  }
}

function checkCollisions() {
  const head = state.snake[0];
  for (let i = 6; i < state.snake.length; i += 1) {
    if (distance(head, state.snake[i]) < state.segmentRadius * 0.8) {
      endGame();
      return;
    }
  }
  for (const rect of state.obstacles) {
    if (circleRectCollide(head, state.headRadius, rect)) {
      endGame();
      return;
    }
  }

  for (let i = state.foods.length - 1; i >= 0; i -= 1) {
    const food = state.foods[i];
    const def = foodTypes[food.type];
    if (distance(head, food) < state.headRadius + def.radius) {
      consumeFood(food, def);
      state.foods.splice(i, 1);
    }
  }
}

function consumeFood(food, def) {
  if (food.type === 'poison') {
    state.desiredLength = Math.max(4, state.desiredLength + def.growth);
    state.score = Math.max(0, state.score + def.points);
    sfx.poison();
    if (state.desiredLength <= 4) {
      endGame();
      return;
    }
  } else {
    state.desiredLength += def.growth;
    state.score += def.points;
    state.pulse = 1.25;
    if (food.type === 'bonus') sfx.bonus();
    else sfx.eat();
  }
  createParticles(food.x, food.y, def.color);
  updateHUD();
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

function createParticles(x, y, color) {
  for (let i = 0; i < 16; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(40, 140);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: randRange(0.3, 0.6),
      color,
    });
  }
}

function updateFood(now) {
  for (let i = state.foods.length - 1; i >= 0; i -= 1) {
    const food = state.foods[i];
    const def = foodTypes[food.type];
    if (def.ttl && now - food.createdAt > def.ttl) {
      state.foods.splice(i, 1);
      continue;
    }
    food.alpha = Math.min(1, food.alpha + 0.05);
  }
}

function updateSpeed() {
  const level = Math.floor(state.score / state.pointsForSpeed);
  const targetSpeed = state.baseSpeed + level * state.speedIncrease;
  state.speed += (targetSpeed - state.speed) * 0.05;
}

function drawBackground() {
  ctx.clearRect(0, 0, state.viewWidth, state.viewHeight);
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  const step = 40;
  for (let x = 0; x <= state.viewWidth; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, state.viewHeight);
    ctx.stroke();
  }
  for (let y = 0; y <= state.viewHeight; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.viewWidth, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawObstacles() {
  for (const rect of state.obstacles) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }
}

function drawFood(now) {
  for (const food of state.foods) {
    const def = foodTypes[food.type];
    const pulse = food.type === 'bonus' ? 1 + Math.sin(now / 200) * 0.1 : 1;
    ctx.save();
    ctx.globalAlpha = food.alpha;
    ctx.fillStyle = def.color;
    ctx.shadowColor = def.glow;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(food.x, food.y, def.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawSnake() {
  ctx.save();
  const len = state.snake.length;
  for (let i = len - 1; i >= 0; i -= 1) {
    const seg = state.snake[i];
    const t = i / len;
    const hue = 140 + t * 40;
    const radius = i === 0 ? state.headRadius * state.pulse : state.segmentRadius * (0.9 + t * 0.2);
    ctx.fillStyle = `hsl(${hue}, 80%, 55%)`;
    ctx.beginPath();
    ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  drawEyes();
  ctx.restore();
  state.pulse += (1 - state.pulse) * 0.08;
}

function drawEyes() {
  const head = state.snake[0];
  const angle = Math.atan2(state.dir.y, state.dir.x);
  const eyeOffset = 6;
  const eyeRadius = 2.2;
  const left = angle - 0.5;
  const right = angle + 0.5;
  ctx.fillStyle = '#0b1017';
  ctx.beginPath();
  ctx.arc(head.x + Math.cos(left) * eyeOffset, head.y + Math.sin(left) * eyeOffset, eyeRadius, 0, Math.PI * 2);
  ctx.arc(head.x + Math.cos(right) * eyeOffset, head.y + Math.sin(right) * eyeOffset, eyeRadius, 0, Math.PI * 2);
  ctx.fill();
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / 0.6);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPaused() {
  if (!state.paused) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, state.viewWidth, state.viewHeight);
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 24px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.fillText('Paused', state.viewWidth / 2, state.viewHeight / 2);
  ctx.restore();
}

// Main render/update loop.
function gameLoop(now) {
  const dt = Math.min((now - state.lastTime) / 1000, 0.033);
  state.lastTime = now;

  if (state.running && !state.paused) {
    updateSpeed();
    updateSnake(dt);
    updateObstacles(dt);
    updateFood(now);
    maybeSpawnFood(now);
    updateParticles(dt);
    checkCollisions();
  }

  drawBackground();
  drawObstacles();
  drawFood(now);
  drawSnake();
  drawParticles();
  drawPaused();

  requestAnimationFrame(gameLoop);
}

function rectIntersectsSnake(rect) {
  for (const seg of state.snake) {
    if (circleRectCollide(seg, state.segmentRadius, rect)) return true;
  }
  return false;
}

function circleRectCollide(circle, radius, rect) {
  const closestX = clamp(circle.x, rect.x, rect.x + rect.width);
  const closestY = clamp(circle.y, rect.y, rect.y + rect.height);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function handleKey(e) {
  if (!state.running) return;
  switch (e.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      setDirection(0, -1);
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      setDirection(0, 1);
      break;
    case 'ArrowLeft':
    case 'a':
    case 'A':
      setDirection(-1, 0);
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      setDirection(1, 0);
      break;
    case 'p':
    case 'P':
    case ' ':
      togglePause();
      break;
    default:
      break;
  }
}

function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  updateHUD();
}

function setupTouchControls() {
  let startX = 0;
  let startY = 0;
  canvas.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
  });
  canvas.addEventListener(
    'touchend',
    (e) => {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.hypot(dx, dy) < 30) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        setDirection(dx > 0 ? 1 : -1, 0);
      } else {
        setDirection(0, dy > 0 ? 1 : -1);
      }
    },
    { passive: true }
  );
}

function setupDpad() {
  dpadButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.dataset.dir;
      if (dir === 'up') setDirection(0, -1);
      if (dir === 'down') setDirection(0, 1);
      if (dir === 'left') setDirection(-1, 0);
      if (dir === 'right') setDirection(1, 0);
    });
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  updateHUD();
}

function toggleSound(value) {
  state.soundOn = value;
  if (state.soundOn) {
    sfx.ensure();
    resumeAudio();
  }
  updateHUD();
}

function resumeAudio() {
  if (sfx.ctx && sfx.ctx.state === 'suspended') {
    sfx.ctx.resume();
  }
}
function initListeners() {
  window.addEventListener('resize', () => {
    resizeCanvas();
    generateObstacles();
  });
  window.addEventListener('keydown', handleKey);

  startBtn.addEventListener('click', () => {
    state.difficulty = difficultySelect.value;
    state.wallMode = wallsToggle.checked;
    state.soundOn = soundToggle.checked;
    state.theme = themeToggle.checked ? 'dark' : 'light';
    applyTheme(state.theme);
    toggleSound(state.soundOn);
    startGame();
  });

  restartBtn.addEventListener('click', () => {
    gameOverScreen.classList.add('hidden');
    startGame();
  });

  menuBtn.addEventListener('click', () => {
    gameOverScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
  });

  pauseBtn.addEventListener('click', togglePause);

  soundBtn.addEventListener('click', () => {
    toggleSound(!state.soundOn);
    soundToggle.checked = state.soundOn;
  });

  themeBtn.addEventListener('click', () => {
    const next = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    themeToggle.checked = next === 'dark';
  });

  wrapBtn.addEventListener('click', () => {
    state.wallMode = !state.wallMode;
    wallsToggle.checked = state.wallMode;
    updateHUD();
  });

  setupTouchControls();
  setupDpad();
}

function initIdleScene() {
  state.score = 0;
  state.desiredLength = 14;
  state.foods = [];
  state.particles = [];
  applyDifficulty();
  resetSnake();
  generateObstacles();
  spawnFood('normal');
  if (Math.random() < 0.4) spawnFood('bonus');
  updateHUD();
}

function init() {
  resizeCanvas();
  initListeners();
  applyTheme('dark');
  toggleSound(true);
  // Auto-start on load.
  startGame();
  requestAnimationFrame(gameLoop);
}

init();
