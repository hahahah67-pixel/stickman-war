// ============================================================
// Stickman War — rendering, input, animation, weapons.
// Physics/collision/AI all live in game.wasm (AssemblyScript).
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---------------- Weapons ----------------
const WEAPONS = {
  glock:   { name: 'GLOCK', dmg: 22, cooldown: 0.32, speed: 640, spread: 0.02, auto: false },
  ak47:    { name: 'AK-47', dmg: 12, cooldown: 0.13, speed: 760, spread: 0.05, auto: true },
  minigun: { name: 'MINIGUN', dmg: 6,  cooldown: 0.045, speed: 820, spread: 0.09, auto: true },
};
let currentWeaponKey = 'ak47';
let weaponCooldownTimer = 0;

// ---------------- World / level data ----------------
// Ground + platforms + one ladder zone. Coordinates in world space.
const GROUND_Y = 620;
const LEVEL_WIDTH = 3200;
const platforms = [
  { x: 0,    y: GROUND_Y, w: 900,  h: 200, type: 0 },
  { x: 950,  y: GROUND_Y, w: 500,  h: 200, type: 0 },
  { x: 1520, y: GROUND_Y, w: 1680, h: 200, type: 0 },
  { x: 500,  y: 470,      w: 160,  h: 26,  type: 0 },
  { x: 780,  y: 380,      w: 140,  h: 26,  type: 0 },
  { x: 1150, y: 500,      w: 180,  h: 26,  type: 0 },
  { x: 1900, y: 460,      w: 200,  h: 26,  type: 0 },
  { x: 2200, y: 360,      w: 160,  h: 26,  type: 0 },
  { x: 2500, y: 500,      w: 220,  h: 26,  type: 0 },
  // ladder
  { x: 1040, y: 300, w: 40, h: 320, type: 1 },
];
// foreground decorative silhouettes the player can pass behind (pure visual, no physics)
const foregroundDecor = [
  { x: 260, y: GROUND_Y - 40, w: 90, h: 140, kind: 'crate' },
  { x: 1300, y: GROUND_Y - 30, w: 70, h: 110, kind: 'crate' },
  { x: 1980, y: GROUND_Y - 200, w: 60, h: 260, kind: 'pillar' },
  { x: 2700, y: GROUND_Y - 40, w: 90, h: 140, kind: 'crate' },
];

// ---------------- Wasm loading ----------------
let wasm = null;
async function loadWasm() {
  const resp = await fetch('game.wasm');
  const bytes = await resp.arrayBuffer();
  const imports = { env: { abort: () => console.error('wasm abort') } };
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  wasm = instance.exports;
  wasm.resetWorld();
  for (const p of platforms) wasm.addPlatform(p.x, p.y, p.w, p.h, p.type);
}

let playerTeam = 0; // 0 blue, 1 red
let enemyCount = 0;

function buildEntities() {
  wasm.spawnEntity(120, GROUND_Y - 90, 26, 60, playerTeam, 100); // player idx 0
  const enemyTeam = playerTeam === 0 ? 1 : 0;
  const spots = [
    { x: 1250, y: GROUND_Y - 90 },
    { x: 2050, y: GROUND_Y - 90 },
    { x: 2650, y: GROUND_Y - 90 },
  ];
  for (const s of spots) wasm.spawnEntity(s.x, s.y, 26, 60, enemyTeam, 45);
  enemyCount = spots.length;
}

// ---------------- Input ----------------
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Digit1') switchWeapon('glock');
  if (e.code === 'Digit2') switchWeapon('ak47');
  if (e.code === 'Digit3') switchWeapon('minigun');
});
window.addEventListener('keyup', (e) => keys[e.code] = false);
let mouseDown = false;
canvas.addEventListener('mousedown', () => mouseDown = true);
window.addEventListener('mouseup', () => mouseDown = false);
canvas.addEventListener('touchstart', () => mouseDown = true, { passive: true });
window.addEventListener('touchend', () => mouseDown = false);

function switchWeapon(key) {
  currentWeaponKey = key;
  document.getElementById('weaponName').textContent = WEAPONS[key].name;
}

// ---------------- Hand-drawn stickman rendering ----------------
// Every stroke gets a tiny per-frame random jitter so linework
// feels hand-inked / flash-animated rather than a static vector.
function jit(seed) {
  return (Math.sin(seed * 12.9898) * 43758.5453 % 1) * 1.6;
}
let frameSeedBase = 0;

function wobblyLine(x1, y1, x2, y2, seedA, seedB) {
  const midx = (x1 + x2) / 2 + jit(seedA + frameSeedBase);
  const midy = (y1 + y2) / 2 + jit(seedB + frameSeedBase);
  ctx.beginPath();
  ctx.moveTo(x1 + jit(seedA * 1.7 + frameSeedBase), y1 + jit(seedA * 2.3 + frameSeedBase));
  ctx.quadraticCurveTo(midx, midy, x2 + jit(seedB * 1.3 + frameSeedBase), y2 + jit(seedB * 3.1 + frameSeedBase));
  ctx.stroke();
}

function drawGun(x, y, facing, weaponKey, muzzleFlash) {
  const dir = facing;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(dir, 1);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  if (weaponKey === 'glock') {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(16, 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(4, 10); ctx.stroke();
  } else if (weaponKey === 'ak47') {
    ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(30, 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(2, 16); ctx.stroke(); // curved mag approx
    ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(-6, 8); ctx.stroke(); // stock
  } else if (weaponKey === 'minigun') {
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(34, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(34, -4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(34, 4); ctx.stroke();
  }
  if (muzzleFlash) {
    const tipX = weaponKey === 'ak47' ? 30 : (weaponKey === 'minigun' ? 34 : 16);
    ctx.fillStyle = 'rgba(255, 210, 80, 0.9)';
    ctx.beginPath();
    ctx.moveTo(tipX, 0);
    ctx.lineTo(tipX + 10 + Math.random() * 5, -5 - Math.random() * 4);
    ctx.lineTo(tipX + 14 + Math.random() * 5, 0);
    ctx.lineTo(tipX + 10 + Math.random() * 5, 5 + Math.random() * 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// pose: procedurally animated stickman based on anim state (0 idle,1 run,2 jump,3 shoot,4 climb,5 dead)
function drawStickman(cx, footY, facing, team, anim, t, isDead, weaponKey, hitFlash) {
  const teamColor = team === 0 ? '#3aa0ff' : '#ff4d4d';
  const headR = 11;
  const bodyLen = 30;
  const legLen = 26;
  const armLen = 22;

  ctx.save();
  if (hitFlash) {
    ctx.filter = 'brightness(2.4) saturate(0)';
  }

  if (isDead) {
    // crumpled on the ground
    const hy = footY - 8;
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    wobblyLine(cx - 22, hy, cx + 22, hy, 1, 2);
    ctx.beginPath();
    ctx.arc(cx - 26, hy - 2, headR * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const bob = anim === 1 ? Math.sin(t * 14) * 3 : (anim === 0 ? Math.sin(t * 3) * 1 : 0);
  const headCX = cx;
  const headCY = footY - legLen - bodyLen - headR + bob;
  const shoulderY = headCY + headR + 4;
  const hipY = shoulderY + bodyLen;

  // team line above head
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(headCX, headCY - headR - 2);
  ctx.lineTo(headCX, headCY - headR - 16);
  ctx.stroke();

  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';

  // head (slightly wobbly circle via short arcs)
  ctx.beginPath();
  ctx.ellipse(headCX + jit(frameSeedBase), headCY + jit(frameSeedBase * 1.3), headR, headR, 0, 0, Math.PI * 2);
  ctx.stroke();

  // legs
  let lLegKnee, lFoot, rLegKnee, rFoot;
  if (anim === 1) { // run cycle
    const phase = t * 12;
    lLegKnee = { x: cx - 6 + Math.sin(phase) * 10, y: hipY + legLen * 0.5 };
    lFoot = { x: cx + Math.sin(phase) * 16, y: footY };
    rLegKnee = { x: cx - 6 + Math.sin(phase + Math.PI) * 10, y: hipY + legLen * 0.5 };
    rFoot = { x: cx + Math.sin(phase + Math.PI) * 16, y: footY };
  } else if (anim === 2) { // jump: legs tucked
    lLegKnee = { x: cx - 10, y: hipY + legLen * 0.35 };
    lFoot = { x: cx - 14, y: hipY + legLen * 0.75 };
    rLegKnee = { x: cx + 10, y: hipY + legLen * 0.4 };
    rFoot = { x: cx + 16, y: hipY + legLen * 0.85 };
  } else if (anim === 4) { // climb
    const phase = t * 10;
    lLegKnee = { x: cx - 8, y: hipY + legLen * 0.5 };
    lFoot = { x: cx - 6 + Math.sin(phase) * 6, y: footY - Math.abs(Math.sin(phase)) * 4 };
    rLegKnee = { x: cx + 8, y: hipY + legLen * 0.5 };
    rFoot = { x: cx + 6 + Math.sin(phase + Math.PI) * 6, y: footY - Math.abs(Math.sin(phase + Math.PI)) * 4 };
  } else { // idle / shoot
    lLegKnee = { x: cx - 7, y: hipY + legLen * 0.5 };
    lFoot = { x: cx - 9, y: footY };
    rLegKnee = { x: cx + 7, y: hipY + legLen * 0.5 };
    rFoot = { x: cx + 9, y: footY };
  }
  wobblyLine(cx, hipY, lLegKnee.x, lLegKnee.y, 4, 5);
  wobblyLine(lLegKnee.x, lLegKnee.y, lFoot.x, lFoot.y, 6, 7);
  wobblyLine(cx, hipY, rLegKnee.x, rLegKnee.y, 8, 9);
  wobblyLine(rLegKnee.x, rLegKnee.y, rFoot.x, rFoot.y, 10, 11);

  // torso
  wobblyLine(headCX, shoulderY, cx, hipY, 12, 13);

  // arms — one holds the gun forward, other swings
  const gunShoulderX = headCX + facing * 4;
  const gunHandX = gunShoulderX + facing * armLen;
  const gunHandY = shoulderY + 6;
  wobblyLine(gunShoulderX, shoulderY, gunHandX, gunHandY, 14, 15);

  const swingPhase = anim === 1 ? Math.sin(t * 12 + Math.PI) * 14 : (anim === 4 ? Math.sin(t * 10) * 6 : 0);
  const backHandX = headCX - facing * 8 + swingPhase * 0.3;
  const backHandY = shoulderY + 14 + Math.abs(swingPhase) * 0.2;
  wobblyLine(headCX - facing * 4, shoulderY, backHandX, backHandY, 16, 17);

  // gun
  const muzzleFlash = anim === 3 && (Math.floor(t * 30) % 2 === 0);
  drawGun(gunHandX, gunHandY, facing, weaponKey, muzzleFlash);

  ctx.restore();
}

// ---------------- Parallax background ----------------
function drawBackground(camX) {
  // sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#bfe3f7');
  sky.addColorStop(1, '#eaf6ea');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // far mountains (slow parallax)
  ctx.fillStyle = '#a9c7d8';
  const farOffset = -camX * 0.15;
  drawRepeatingHills(farOffset, H * 0.55, 260, 90);

  // mid hills
  ctx.fillStyle = '#8fae86';
  const midOffset = -camX * 0.4;
  drawRepeatingHills(midOffset, H * 0.68, 180, 70);

  // sun/cloud detail (very slow)
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const cloudOffset = (-camX * 0.08) % 500;
  for (let i = -1; i < 6; i++) {
    const cx = cloudOffset + i * 500 + 100;
    drawCloud(cx, 90 + (i % 3) * 30);
  }
}
function drawCloud(x, y) {
  ctx.beginPath();
  ctx.ellipse(x, y, 30, 16, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 22, y + 4, 22, 13, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 20, y + 5, 20, 12, 0, 0, Math.PI * 2);
  ctx.fill();
}
function drawRepeatingHills(offset, baseY, period, amp) {
  ctx.beginPath();
  ctx.moveTo(0, H);
  const start = -period;
  for (let x = start; x < W + period; x += period) {
    const localX = x + (offset % period);
    ctx.quadraticCurveTo(localX + period * 0.5, baseY - amp, localX + period, baseY);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawGroundAndPlatforms(camX) {
  ctx.strokeStyle = '#3a2a1c';
  ctx.fillStyle = '#6b4a30';
  for (const p of platforms) {
    if (p.type === 1) {
      // ladder
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 4;
      const sx = p.x - camX;
      ctx.beginPath(); ctx.moveTo(sx + 6, p.y); ctx.lineTo(sx + 6, p.y + p.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + p.w - 6, p.y); ctx.lineTo(sx + p.w - 6, p.y + p.h); ctx.stroke();
      ctx.lineWidth = 3;
      for (let ry = p.y + 10; ry < p.y + p.h; ry += 22) {
        ctx.beginPath(); ctx.moveTo(sx + 4, ry); ctx.lineTo(sx + p.w - 4, ry); ctx.stroke();
      }
      continue;
    }
    const sx = p.x - camX;
    ctx.fillStyle = '#7a5636';
    ctx.fillRect(sx, p.y, p.w, p.h);
    ctx.fillStyle = '#5f8f4a';
    ctx.fillRect(sx, p.y, p.w, 10);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < p.w; gx += 40) {
      ctx.beginPath(); ctx.moveTo(sx + gx, p.y + 10); ctx.lineTo(sx + gx, p.y + p.h); ctx.stroke();
    }
  }
}

function drawForegroundDecor(camX) {
  for (const d of foregroundDecor) {
    const sx = d.x - camX * 1.06; // slightly faster than camera = foreground depth
    if (d.kind === 'crate') {
      ctx.fillStyle = '#5a3d22';
      ctx.fillRect(sx, d.y, d.w, d.h);
      ctx.strokeStyle = '#2c1c0e';
      ctx.lineWidth = 3;
      ctx.strokeRect(sx, d.y, d.w, d.h);
      ctx.beginPath();
      ctx.moveTo(sx, d.y); ctx.lineTo(sx + d.w, d.y + d.h);
      ctx.moveTo(sx + d.w, d.y); ctx.lineTo(sx, d.y + d.h);
      ctx.stroke();
    } else if (d.kind === 'pillar') {
      ctx.fillStyle = '#4a4a52';
      ctx.fillRect(sx, d.y, d.w, d.h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(sx, d.y, 12, d.h);
    }
  }
}

// ---------------- Bullets / muzzle particles ----------------
function drawBullets(camX) {
  const maxB = wasm.getMaxBullets();
  for (let i = 0; i < maxB; i++) {
    if (!wasm.getBulActive(i)) continue;
    const bx = wasm.getBulX(i) - camX;
    const by = wasm.getBulY(i);
    const team = wasm.getBulTeam(i);
    ctx.fillStyle = team === 0 ? '#bfe0ff' : '#ffc7c7';
    ctx.beginPath();
    ctx.ellipse(bx, by, 4, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------- HUD / game state ----------------
let gameStarted = false;
let lastHitFlashTimer = {};
let playerDead = false;
let levelWon = false;

function updateHUD() {
  const hp = Math.max(0, wasm.getEntHP(0));
  document.getElementById('hpBarInner').style.width = hp + '%';
  const tag = document.getElementById('teamTag');
  tag.textContent = playerTeam === 0 ? 'BLUE TEAM' : 'RED TEAM';
  tag.style.color = playerTeam === 0 ? '#3aa0ff' : '#ff4d4d';
}

function checkWinLoss() {
  if (playerDead || levelWon) return;
  if (wasm.getEntHP(0) <= 0 || !wasm.getEntAlive(0)) {
    playerDead = true;
    document.getElementById('deathScreen').style.display = 'flex';
    return;
  }
  let anyEnemyAlive = false;
  for (let i = 1; i <= enemyCount; i++) {
    if (wasm.getEntAlive(i)) anyEnemyAlive = true;
  }
  if (!anyEnemyAlive) {
    levelWon = true;
    document.getElementById('winScreen').style.display = 'flex';
  }
}

// ---------------- Main loop ----------------
let lastTime = 0;
let elapsed = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (!gameStarted || !wasm) return;
  const dt = Math.min(0.033, (ts - lastTime) / 1000 || 0);
  lastTime = ts;
  elapsed += dt;
  frameSeedBase = elapsed * 37.0;

  if (!playerDead && !levelWon) {
    const left = keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0;
    const right = keys['KeyD'] || keys['ArrowRight'] ? 1 : 0;
    const jump = keys['KeyW'] || keys['ArrowUp'] || keys['Space'] ? 1 : 0;
    const up = keys['KeyW'] || keys['ArrowUp'] ? 1 : 0;
    const down = keys['KeyS'] || keys['ArrowDown'] ? 1 : 0;
    wasm.setPlayerInput(left, right, jump, up, down);

    const wantFire = keys['KeyJ'] || mouseDown;
    const weapon = WEAPONS[currentWeaponKey];
    weaponCooldownTimer -= dt;
    if (wantFire && weaponCooldownTimer <= 0) {
      weaponCooldownTimer = weapon.cooldown;
      const facing = wasm.getEntFacing(0);
      const spread = (Math.random() - 0.5) * weapon.spread;
      const vx = Math.cos(spread) * weapon.speed * facing;
      const vy = Math.sin(spread) * weapon.speed;
      wasm.tryPlayerFire(vx, vy, weapon.dmg);
    }

    wasm.step(dt);
    const killed = wasm.getKilledEntity();
    if (killed >= 0) { /* could trigger particle burst here later */ }
  }

  render();
  updateHUD();
  checkWinLoss();
}

function render() {
  const playerX = wasm.getEntX(0);
  let camX = playerX - W * 0.4;
  camX = Math.max(0, Math.min(LEVEL_WIDTH - W, camX));

  drawBackground(camX);
  drawGroundAndPlatforms(camX);

  const count = wasm.getEntCount();
  const entities = [];
  for (let i = 0; i < count; i++) {
    entities.push({
      i,
      x: wasm.getEntX(i) - camX + wasm.getEntW(i) / 2,
      footY: wasm.getEntY(i) + wasm.getEntH(i),
      facing: wasm.getEntFacing(i),
      team: wasm.getEntTeam(i),
      anim: wasm.getEntAnim(i),
      alive: wasm.getEntAlive(i),
    });
  }
  // sort by footY for pseudo-depth (further back drawn first)
  entities.sort((a, b) => a.footY - b.footY);
  for (const e of entities) {
    const hit = wasm.getHitFlashEntity() === e.i;
    drawStickman(e.x, e.footY, e.facing, e.team, e.anim, elapsed, !e.alive, e.i === 0 ? currentWeaponKey : 'ak47', hit);
  }

  drawBullets(camX);
  drawForegroundDecor(camX);
}

// ---------------- Team select / start wiring ----------------
document.getElementById('pickBlue').addEventListener('click', () => selectTeam(0));
document.getElementById('pickRed').addEventListener('click', () => selectTeam(1));
function selectTeam(team) {
  playerTeam = team;
  document.getElementById('pickBlue').style.outline = team === 0 ? '4px solid #fff' : 'none';
  document.getElementById('pickRed').style.outline = team === 1 ? '4px solid #fff' : 'none';
  document.getElementById('startBtn').style.display = 'inline-block';
}
document.getElementById('startBtn').addEventListener('click', startGame);

async function startGame() {
  if (!wasm) await loadWasm();
  wasm.resetWorld();
  for (const p of platforms) wasm.addPlatform(p.x, p.y, p.w, p.h, p.type);
  buildEntities();
  playerDead = false; levelWon = false;
  document.getElementById('deathScreen').style.display = 'none';
  document.getElementById('winScreen').style.display = 'none';
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  switchWeapon(currentWeaponKey);
  gameStarted = true;
  lastTime = performance.now();
}

document.getElementById('retryBtn').addEventListener('click', () => {
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
});
document.getElementById('winRetryBtn').addEventListener('click', () => {
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('hud').style.display = 'none';
});

loadWasm().catch(err => console.error('wasm load failed', err));
requestAnimationFrame(loop);
