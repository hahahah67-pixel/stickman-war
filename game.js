// ============================================================
// Stickman War — rendering, input, animation, weapons, audio.
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
const WEAPON_ORDER = ['glock', 'ak47', 'minigun'];
const WEAPONS = {
  glock:   { name: 'GLOCK',   dmg: 22, cooldown: 0.32,  speed: 640, spread: 0.02, sound: { freq: 1500, q: 1.0, dur: 0.05,  gain: 0.5 } },
  ak47:    { name: 'AK-47',   dmg: 12, cooldown: 0.13,  speed: 760, spread: 0.05, sound: { freq: 900,  q: 0.8, dur: 0.075, gain: 0.55 } },
  minigun: { name: 'MINIGUN', dmg: 6,  cooldown: 0.045, speed: 820, spread: 0.09, sound: { freq: 1800, q: 1.4, dur: 0.028, gain: 0.4 } },
};
let currentWeaponKey = 'ak47';
let weaponCooldownTimer = 0;

// ---------------- World / level data (burned-city level 1) ----------------
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
  { x: 1040, y: 300, w: 40, h: 320, type: 1 }, // ladder
];
// burning wrecked cars — foreground, player can pass behind them
const wreckedCars = [
  { x: 300,  y: GROUND_Y - 46, w: 130, h: 46 },
  { x: 1350, y: GROUND_Y - 46, w: 130, h: 46 },
  { x: 2050, y: GROUND_Y - 46, w: 130, h: 46 },
  { x: 2750, y: GROUND_Y - 46, w: 130, h: 46 },
];
// broken buildings, background skyline (fixed jagged silhouette, drawn once per shape)
const buildings = [
  { x: 60,   w: 140, h: 260, broken: 0.15 },
  { x: 260,  w: 100, h: 340, broken: 0.35 },
  { x: 420,  w: 170, h: 220, broken: 0.05 },
  { x: 660,  w: 120, h: 300, broken: 0.4 },
  { x: 860,  w: 150, h: 260, broken: 0.2 },
  { x: 1100, w: 110, h: 360, broken: 0.5 },
  { x: 1300, w: 160, h: 240, broken: 0.1 },
  { x: 1560, w: 130, h: 320, broken: 0.3 },
  { x: 1780, w: 100, h: 280, broken: 0.45 },
  { x: 1980, w: 170, h: 230, broken: 0.15 },
  { x: 2250, w: 120, h: 340, broken: 0.35 },
  { x: 2480, w: 150, h: 260, broken: 0.25 },
  { x: 2730, w: 110, h: 300, broken: 0.4 },
  { x: 2950, w: 140, h: 250, broken: 0.2 },
];

// ---------------- Wasm loading ----------------
let wasm = null;
async function loadWasm() {
  const resp = await fetch('game.wasm');
  const bytes = await resp.arrayBuffer();
  const imports = { env: { abort: () => console.error('wasm abort') } };
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  wasm = instance.exports;
}

let playerTeam = 0; // 0 blue, 1 red
let enemyCount = 0;

function buildWorld() {
  wasm.resetWorld();
  for (const p of platforms) wasm.addPlatform(p.x, p.y, p.w, p.h, p.type);
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
// Move: Arrow Left/Right. Jump: Space. Climb: hold Arrow Up/Down on a ladder.
// Shoot: S. Switch weapon: A (cycles Glock -> AK-47 -> Minigun -> ...).
const keys = {};
const CAPTURED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyS', 'KeyA']);
window.addEventListener('keydown', (e) => {
  if (CAPTURED_KEYS.has(e.code)) e.preventDefault();
  if (e.code === 'KeyA' && !keys[e.code]) cycleWeapon();
  keys[e.code] = true;
});
window.addEventListener('keyup', (e) => keys[e.code] = false);
let mouseDown = false;
canvas.addEventListener('mousedown', () => mouseDown = true);
window.addEventListener('mouseup', () => mouseDown = false);
canvas.addEventListener('touchstart', () => mouseDown = true, { passive: true });
window.addEventListener('touchend', () => mouseDown = false);

function cycleWeapon() {
  const idx = WEAPON_ORDER.indexOf(currentWeaponKey);
  currentWeaponKey = WEAPON_ORDER[(idx + 1) % WEAPON_ORDER.length];
  showWeaponToast(currentWeaponKey);
}

// ---------------- Weapon switch toast ----------------
let weaponToastTimer = null;
function showWeaponToast(key) {
  const el = document.getElementById('weaponToast');
  document.getElementById('weaponToastName').textContent = WEAPONS[key].name;
  const iconCanvas = document.getElementById('weaponToastIcon');
  const ictx = iconCanvas.getContext('2d');
  ictx.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
  ictx.save();
  ictx.translate(6, iconCanvas.height / 2);
  paintGunShape(ictx, key, 0, 0);
  ictx.restore();
  el.classList.add('show');
  clearTimeout(weaponToastTimer);
  weaponToastTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

// ---------------- Smooth wobble (fixed: continuous, not a chaotic hash) ----------------
// The old jitter used sin(x)*bignum % 1, which is numerically unstable and
// jumps discontinuously frame to frame — that's what read as "shaky/weird".
// This version is a sum of two slow sines: continuous, small, and stable.
function wobble(seed, t, amp) {
  return Math.sin(t * 7.3 + seed * 3.1) * amp * 0.6 + Math.sin(t * 2.6 + seed * 1.4) * amp * 0.4;
}
function wobblyLine(x1, y1, x2, y2, seedA, seedB, t, amp) {
  const jx1 = wobble(seedA * 1.7, t, amp), jy1 = wobble(seedA * 2.3, t, amp);
  const jx2 = wobble(seedB * 1.3, t, amp), jy2 = wobble(seedB * 3.1, t, amp);
  const midx = (x1 + x2) / 2 + wobble(seedA + seedB, t, amp * 0.5);
  const midy = (y1 + y2) / 2 + wobble(seedA - seedB, t, amp * 0.5);
  ctx.beginPath();
  ctx.moveTo(x1 + jx1, y1 + jy1);
  ctx.quadraticCurveTo(midx, midy, x2 + jx2, y2 + jy2);
  ctx.stroke();
}

// ---------------- Cartoon gun rendering ----------------
// Local frame: (0,0) is the grip/hand point, gun points along +x.
// recoil: 0..1 pulse right after firing. spinAngle: minigun barrel rotation.
function paintGunShape(g, weaponKey, recoil, spinAngle) {
  const kick = -recoil * 4;
  g.save();
  g.translate(kick, 0);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  if (weaponKey === 'glock') {
    g.fillStyle = '#3b3f45'; g.strokeStyle = '#111'; g.lineWidth = 2;
    roundRectPath(g, -2, -5, 22, 7, 2); g.fill(); g.stroke();
    g.beginPath();
    g.moveTo(-3, 2); g.lineTo(-7, 15); g.lineTo(-1, 16); g.lineTo(2, 3);
    g.closePath(); g.fillStyle = '#1a1a1a'; g.fill(); g.stroke();
  } else if (weaponKey === 'ak47') {
    g.fillStyle = '#4a4d52'; g.strokeStyle = '#111'; g.lineWidth = 2;
    roundRectPath(g, -10, -4, 44, 7, 2); g.fill(); g.stroke(); // receiver/barrel
    g.fillStyle = '#8a5a2e';
    roundRectPath(g, 6, -2, 16, 6, 2); g.fill(); g.stroke(); // handguard
    roundRectPath(g, -24, -2, 15, 6, 2); g.fill(); g.stroke(); // stock
    g.beginPath(); // curved magazine
    g.moveTo(10, 3);
    g.quadraticCurveTo(16, 14, 12, 24);
    g.quadraticCurveTo(6, 22, 5, 10);
    g.closePath();
    g.fillStyle = '#2a2a2a'; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(34, -1); g.lineTo(34, -7); g.lineWidth = 2.4; g.stroke(); // front sight
  } else { // minigun
    g.fillStyle = '#2f2f33'; g.strokeStyle = '#111'; g.lineWidth = 2;
    roundRectPath(g, -8, -8, 14, 16, 3); g.fill(); g.stroke(); // housing/grip block
    g.save();
    g.translate(16, 0);
    g.rotate(spinAngle);
    g.fillStyle = '#55575c';
    const barrelCount = 6;
    for (let bIdx = 0; bIdx < barrelCount; bIdx++) {
      const ang = (Math.PI * 2 * bIdx) / barrelCount;
      const bx = Math.cos(ang) * 5, by = Math.sin(ang) * 5;
      g.beginPath();
      roundRectPathAt(g, bx - 1.6, by - 1.6, 18, 3.2, 1.4);
      g.fill();
    }
    g.strokeStyle = '#111'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fillStyle = '#1c1c1c'; g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#3a3a3a';
    roundRectPath(g, -10, 6, 10, 10, 2); g.fill(); g.stroke(); // ammo box hint
  }
  g.restore();
}
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function roundRectPathAt(g, x, y, w, h, r) { roundRectPath(g, x, y, w, h, r); }

function muzzleTip(weaponKey) {
  if (weaponKey === 'glock') return { x: 20, y: -1.5 };
  if (weaponKey === 'minigun') return { x: 34, y: 0 };
  return { x: 34, y: -1 }; // ak47
}

// ---------------- Particle system (muzzle smoke, embers, sparks) ----------------
let particles = [];
function spawnParticle(p) { if (particles.length < 260) particles.push(p); }
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.grow) p.size += p.grow * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}
function drawParticles(camX) {
  for (const p of particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a * (p.baseAlpha ?? 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - camX * (p.parallax ?? 1), p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------- Entity FX state (recoil pulse, minigun spin) ----------------
const fx = {}; // entity index -> { recoil, spin }
function getFx(i) { if (!fx[i]) fx[i] = { recoil: 0, spin: 0 }; return fx[i]; }

// ---------------- Stickman rendering ----------------
function drawStickman(cx, footY, facing, team, anim, t, isDead, weaponKey, hitFlash, entIndex, isFiringHeld) {
  const teamColor = team === 0 ? '#3aa0ff' : '#ff4d4d';
  const headR = 11;
  const bodyLen = 30;
  const legTotal = 26;
  const thigh = 13, shin = 13;

  ctx.save();
  if (hitFlash) ctx.filter = 'brightness(2.2) saturate(0)';

  if (isDead) {
    const hy = footY - 8;
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 22, hy); ctx.lineTo(cx + 22, hy); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 26, hy - 2, headR * 0.9, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    return;
  }

  const bob = anim === 1 ? Math.sin(t * 14) * 3 : (anim === 0 ? Math.sin(t * 2.4) * 0.8 : 0);
  const headCX = cx;
  const headCY = footY - legTotal - bodyLen - headR + bob;
  const shoulderY = headCY + headR + 4;
  const hipY = shoulderY + bodyLen;

  // team indicator: HORIZONTAL bar above the head
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(headCX - 9, headCY - headR - 9);
  ctx.lineTo(headCX + 9, headCY - headR - 9);
  ctx.stroke();

  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';

  // head — small stable wobble only, no chaotic jitter
  const headJX = wobble(entIndex + 1, t, 0.5), headJY = wobble(entIndex + 2, t, 0.5);
  ctx.beginPath();
  ctx.ellipse(headCX + headJX, headCY + headJY, headR, headR, 0, 0, Math.PI * 2);
  ctx.stroke();

  // ---- LEGS: clean deterministic two-segment cycle, zero jitter ----
  ctx.lineWidth = 3.4;
  function drawLeg(phase) {
    const lift = Math.max(0, Math.sin(phase));
    const swing = Math.sin(phase) * 15;
    const footX = cx + swing;
    const footYd = footY - lift * 9;
    const kneeX = cx + swing * 0.45;
    const kneeY = hipY + thigh + (1 - lift) * 2;
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footYd); ctx.stroke();
  }
  function drawStaticLeg(dx) {
    const kneeX = cx + dx * 0.5, kneeY = hipY + thigh;
    const footX = cx + dx, footYd = footY;
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footYd); ctx.stroke();
  }

  if (anim === 1) { // run
    const phase = t * 11;
    drawLeg(phase);
    drawLeg(phase + Math.PI);
  } else if (anim === 2) { // jump — tucked, static (no jitter, no shake)
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - 9, hipY + thigh * 0.7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 9, hipY + thigh * 0.7); ctx.lineTo(cx - 13, hipY + thigh + shin * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + 10, hipY + thigh * 0.75); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 10, hipY + thigh * 0.75); ctx.lineTo(cx + 15, hipY + thigh + shin * 0.6); ctx.stroke();
  } else if (anim === 4) { // climb — smooth alternating reach, no jitter
    const phase = t * 8;
    const l1 = Math.max(0, Math.sin(phase)) * 6, l2 = Math.max(0, Math.sin(phase + Math.PI)) * 6;
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - 8, hipY + thigh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 8, hipY + thigh); ctx.lineTo(cx - 6, footY - l1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + 8, hipY + thigh); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 8, hipY + thigh); ctx.lineTo(cx + 6, footY - l2); ctx.stroke();
  } else { // idle / shoot — static stable stance
    drawStaticLeg(-9);
    drawStaticLeg(9);
  }

  // torso — tiny stable wobble, not the old chaotic jitter
  ctx.lineWidth = 3.4;
  wobblyLine(headCX, shoulderY, cx, hipY, entIndex + 3, entIndex + 4, t, 0.5);

  // arms
  const gunShoulderX = headCX + facing * 4;
  const gunHandX = gunShoulderX + facing * 22;
  const gunHandY = shoulderY + 6;
  wobblyLine(gunShoulderX, shoulderY, gunHandX, gunHandY, entIndex + 5, entIndex + 6, t, 0.6);

  const swingPhase = anim === 1 ? Math.sin(t * 11 + Math.PI) * 12 : (anim === 4 ? Math.sin(t * 8) * 5 : 0);
  const backHandX = headCX - facing * 8 + swingPhase * 0.3;
  const backHandY = shoulderY + 14 + Math.abs(swingPhase) * 0.2;
  wobblyLine(headCX - facing * 4, shoulderY, backHandX, backHandY, entIndex + 7, entIndex + 8, t, 0.6);

  // gun — a real cartoon shape attached at the hand, not a stroke of the arm
  const fxState = getFx(entIndex);
  const justFired = anim === 3;
  if (justFired) fxState.recoil = 1.0;
  fxState.recoil = Math.max(0, fxState.recoil - 0.09);
  if (weaponKey === 'minigun' && isFiringHeld) fxState.spin += 0.55;
  else fxState.spin *= 0.9;

  ctx.save();
  ctx.translate(gunHandX, gunHandY);
  ctx.scale(facing, 1);
  paintGunShape(ctx, weaponKey, fxState.recoil, fxState.spin);
  if (justFired) {
    const tip = muzzleTip(weaponKey);
    ctx.fillStyle = 'rgba(255, 208, 70, 0.95)';
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x + 9 + Math.random() * 5, tip.y - 5 - Math.random() * 4);
    ctx.lineTo(tip.x + 14 + Math.random() * 5, tip.y);
    ctx.lineTo(tip.x + 9 + Math.random() * 5, tip.y + 5 + Math.random() * 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  if (justFired) {
    const tip = muzzleTip(weaponKey);
    const worldTipX = gunHandX + facing * tip.x;
    const worldTipY = gunHandY + tip.y;
    for (let s = 0; s < 3; s++) {
      spawnParticle({
        x: worldTipX + (Math.random() - 0.5) * 4, y: worldTipY + (Math.random() - 0.5) * 4,
        vx: -facing * 12 + (Math.random() - 0.5) * 10, vy: -14 - Math.random() * 10,
        life: 0.35, maxLife: 0.35, size: 2 + Math.random() * 1.5, color: 'rgba(180,180,180,0.6)', grow: 4,
      });
    }
  }

  ctx.restore();
}

// ---------------- Burned-city background ----------------
let smokePlumeSeeds = [];
for (let i = 0; i < 10; i++) smokePlumeSeeds.push({ phase: Math.random() * 10, x: Math.random() });

function drawBackground(camX, t) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#5b5a5f');
  sky.addColorStop(0.5, '#8a7060');
  sky.addColorStop(1, '#c99a6b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // dull orange fire-glow near the horizon
  const glow = ctx.createLinearGradient(0, H * 0.55, 0, H * 0.85);
  glow.addColorStop(0, 'rgba(255,120,40,0)');
  glow.addColorStop(1, 'rgba(255,110,30,0.28)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, H * 0.5, W, H * 0.4);

  // broken building skyline
  const farOffset = -camX * 0.2;
  ctx.fillStyle = '#332f31';
  for (const b of buildings) {
    const sx = ((b.x + farOffset) % (LEVEL_WIDTH + 400) + LEVEL_WIDTH + 400) % (LEVEL_WIDTH + 400) - 200;
    const topY = H * 0.62 - b.h * 0.55;
    ctx.fillRect(sx, topY, b.w, b.h);
    // jagged broken top
    ctx.beginPath();
    ctx.moveTo(sx, topY);
    ctx.lineTo(sx + b.w * (0.3 + b.broken * 0.2), topY - b.h * b.broken * 0.3);
    ctx.lineTo(sx + b.w * 0.55, topY + b.h * b.broken * 0.15);
    ctx.lineTo(sx + b.w, topY);
    ctx.closePath();
    ctx.fill();
    // dim broken windows
    ctx.fillStyle = 'rgba(255,160,70,0.10)';
    for (let wx = sx + 10; wx < sx + b.w - 10; wx += 22) {
      for (let wy = topY + 16; wy < topY + b.h - 12; wy += 30) {
        if (Math.sin(wx * 12.9 + wy * 3.7) > 0.3) ctx.fillRect(wx, wy, 10, 14);
      }
    }
    ctx.fillStyle = '#332f31';
  }

  // drifting smoke plumes
  ctx.fillStyle = 'rgba(70,66,64,0.35)';
  for (const s of smokePlumeSeeds) {
    const bx = ((s.x * (LEVEL_WIDTH + 600) + farOffset * 0.6) % (LEVEL_WIDTH + 600) + (LEVEL_WIDTH + 600)) % (LEVEL_WIDTH + 600) - 300;
    const by = H * 0.32 - Math.sin(t * 0.2 + s.phase) * 14;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(bx + k * 14 + Math.sin(t * 0.15 + k) * 6, by - k * 10, 22 - k * 2, 16 - k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawGroundAndPlatforms(camX) {
  for (const p of platforms) {
    if (p.type === 1) {
      ctx.strokeStyle = '#7a5c34'; ctx.lineWidth = 4;
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
    ctx.fillStyle = '#3d3a38'; // cracked asphalt / rubble
    ctx.fillRect(sx, p.y, p.w, p.h);
    ctx.fillStyle = '#4d4744';
    ctx.fillRect(sx, p.y, p.w, 9);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let gx = 12; gx < p.w; gx += 46) {
      ctx.beginPath();
      ctx.moveTo(sx + gx, p.y + 9);
      ctx.lineTo(sx + gx + 10 + Math.sin(gx) * 6, p.y + p.h * 0.5);
      ctx.stroke();
    }
    // scattered debris speckle
    ctx.fillStyle = 'rgba(20,20,20,0.4)';
    for (let dxk = 8; dxk < p.w; dxk += 27) {
      ctx.beginPath();
      ctx.arc(sx + dxk, p.y + 12 + (dxk % 7), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// fleeing civilians — pure background atmosphere, independent of camera/world,
// non-interactive (not part of the wasm entity/bullet system at all)
let civilians = [];
function initCivilians() {
  civilians = [];
  for (let i = 0; i < 5; i++) {
    civilians.push({
      x: Math.random() * (W + 400),
      y: H * 0.635 + (i % 2) * 8,
      speed: 70 + Math.random() * 55,
      phase: Math.random() * 10,
      scale: 0.7 + Math.random() * 0.25,
    });
  }
}
function drawFleeingCivilians(dt, t) {
  ctx.save();
  ctx.strokeStyle = 'rgba(15,14,16,0.55)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (const c of civilians) {
    c.x -= c.speed * dt;
    if (c.x < -60) { c.x = W + Math.random() * 200; c.y = H * 0.635 + Math.random() * 14; c.speed = 70 + Math.random() * 55; }
    const s = c.scale;
    const cx = c.x, footY = c.y;
    const legPhase = t * 16 + c.phase;
    const headR = 6 * s;
    const bodyLen = 16 * s, legLen = 14 * s;
    const headCY = footY - legLen - bodyLen - headR;
    const shoulderY = headCY + headR + 2;
    const hipY = shoulderY + bodyLen;
    ctx.beginPath(); ctx.arc(cx, headCY, headR, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, shoulderY); ctx.lineTo(cx, hipY); ctx.stroke();
    // legs — panicked sprint
    const sw = Math.sin(legPhase) * 10 * s;
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + sw, footY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - sw, footY); ctx.stroke();
    // arms raised — hands up
    ctx.beginPath(); ctx.moveTo(cx, shoulderY); ctx.lineTo(cx - 9 * s, shoulderY - 13 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, shoulderY); ctx.lineTo(cx + 9 * s, shoulderY - 13 * s); ctx.stroke();
  }
  ctx.restore();
}

// burning wrecked cars — foreground, occludes the player (walk-behind depth)
function drawWreckedCars(camX, dt, t) {
  for (const car of wreckedCars) {
    const sx = car.x - camX * 1.05;
    if (sx < -220 || sx > W + 220) continue;

    ctx.fillStyle = '#26221f';
    roundRectPath(ctx, sx, car.y, car.w, car.h, 8);
    ctx.fill();
    ctx.fillStyle = '#1a1715';
    roundRectPath(ctx, sx + car.w * 0.18, car.y - 20, car.w * 0.5, 24, 6);
    ctx.fill();
    ctx.fillStyle = '#0f0d0c';
    ctx.beginPath(); ctx.arc(sx + car.w * 0.22, car.y + car.h, 12, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx + car.w * 0.78, car.y + car.h, 12, 0, Math.PI * 2); ctx.fill();

    // flame — layered flicker shapes, continuously animated
    const baseX = sx + car.w * 0.35, baseY = car.y - 10;
    for (let f = 0; f < 3; f++) {
      const flick = Math.sin(t * 14 + f * 2.1 + car.x) * 4;
      const h = 26 - f * 6 + Math.sin(t * 9 + f) * 4;
      ctx.beginPath();
      ctx.moveTo(baseX + f * 14 - 8, baseY);
      ctx.quadraticCurveTo(baseX + f * 14 + flick, baseY - h, baseX + f * 14 + 6, baseY);
      ctx.closePath();
      ctx.fillStyle = f === 0 ? 'rgba(255,90,20,0.9)' : (f === 1 ? 'rgba(255,160,30,0.85)' : 'rgba(255,220,90,0.8)');
      ctx.fill();
    }

    if (Math.random() < 0.6) {
      spawnParticle({
        x: baseX + car.x - sx + (Math.random() - 0.5) * 20, y: baseY,
        vx: (Math.random() - 0.5) * 12, vy: -30 - Math.random() * 20,
        life: 1.6 + Math.random(), maxLife: 2.4, size: 5 + Math.random() * 4,
        color: 'rgba(90,88,86,0.35)', grow: 6, parallax: 1.05,
      });
    }
    if (Math.random() < 0.5) {
      spawnParticle({
        x: baseX + car.x - sx + (Math.random() - 0.5) * 10, y: baseY - 4,
        vx: (Math.random() - 0.5) * 20, vy: -60 - Math.random() * 30,
        life: 0.6 + Math.random() * 0.4, maxLife: 1.0, size: 1.4 + Math.random(),
        color: 'rgba(255,150,60,0.9)', baseAlpha: 1, parallax: 1.05,
      });
    }
  }
}

// ---------------- Bullets ----------------
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

// ---------------- Audio ----------------
let audioCtx = null;
let noiseBuffer = null;
function initAudio() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  const len = Math.floor(audioCtx.sampleRate * 1);
  noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  startAmbient();
}
function playNoiseBurst({ freq, q, dur, gain }) {
  if (!audioCtx) return;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer; src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q;
  const g = audioCtx.createGain();
  const now = audioCtx.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + dur);
  src.connect(filter).connect(g).connect(audioCtx.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}
function playGunSound(key) {
  const w = WEAPONS[key];
  if (w) playNoiseBurst({ freq: w.sound.freq, q: w.sound.q, dur: w.sound.dur, gain: w.sound.gain });
}
function startAmbient() {
  const osc = audioCtx.createOscillator();
  osc.type = 'sine'; osc.frequency.value = 46;
  const oscGain = audioCtx.createGain(); oscGain.gain.value = 0.05;
  osc.connect(oscGain).connect(audioCtx.destination);
  osc.start();

  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer; src.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = 750; filter.Q.value = 0.5;
  const g = audioCtx.createGain(); g.gain.value = 0.028;
  src.connect(filter).connect(g).connect(audioCtx.destination);
  src.start();

  scheduleDistantBoom();
}
function scheduleDistantBoom() {
  const delay = 6 + Math.random() * 9;
  setTimeout(() => {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(65, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.45);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.13, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(now); osc.stop(now + 0.7);
    scheduleDistantBoom();
  }, delay * 1000);
}

// ---------------- HUD / game state ----------------
let gameStarted = false;
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
  for (let i = 1; i <= enemyCount; i++) if (wasm.getEntAlive(i)) anyEnemyAlive = true;
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

  let wantFire = false;
  if (!playerDead && !levelWon) {
    const left = keys['ArrowLeft'] ? 1 : 0;
    const right = keys['ArrowRight'] ? 1 : 0;
    const jump = keys['Space'] ? 1 : 0;
    const up = keys['ArrowUp'] ? 1 : 0;
    const down = keys['ArrowDown'] ? 1 : 0;
    wasm.setPlayerInput(left, right, jump, up, down);

    wantFire = keys['KeyS'] || mouseDown;
    const weapon = WEAPONS[currentWeaponKey];
    weaponCooldownTimer -= dt;
    if (wantFire && weaponCooldownTimer <= 0) {
      weaponCooldownTimer = weapon.cooldown;
      const facing = wasm.getEntFacing(0);
      const spread = (Math.random() - 0.5) * weapon.spread;
      const vx = Math.cos(spread) * weapon.speed * facing;
      const vy = Math.sin(spread) * weapon.speed;
      const shotIdx = wasm.tryPlayerFire(vx, vy, weapon.dmg);
      if (shotIdx >= 0) playGunSound(currentWeaponKey);
    }

    wasm.step(dt);

    // enemy gunfire sound cue
    for (let i = 1; i <= enemyCount; i++) {
      if (wasm.getEntAlive(i) && wasm.getEntAnim(i) === 3) playGunSound('ak47');
    }
  }

  updateParticles(dt);
  render(dt, wantFire);
  updateHUD();
  checkWinLoss();
}

function render(dt, isFiringHeld) {
  const playerX = wasm.getEntX(0);
  let camX = playerX - W * 0.4;
  camX = Math.max(0, Math.min(LEVEL_WIDTH - W, camX));

  drawBackground(camX, elapsed);
  drawFleeingCivilians(dt, elapsed);
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
  entities.sort((a, b) => a.footY - b.footY);
  const hitIdx = wasm.getHitFlashEntity();
  for (const e of entities) {
    const weaponForThis = e.i === 0 ? currentWeaponKey : 'ak47';
    const firing = e.i === 0 ? isFiringHeld : (e.anim === 3);
    drawStickman(e.x, e.footY, e.facing, e.team, e.anim, elapsed, !e.alive, weaponForThis, hitIdx === e.i, e.i, firing);
  }

  drawBullets(camX);
  drawParticles(camX);
  drawWreckedCars(camX, dt, elapsed);
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
  buildWorld();
  initCivilians();
  particles = [];
  for (const k in fx) delete fx[k];
  playerDead = false; levelWon = false;
  document.getElementById('deathScreen').style.display = 'none';
  document.getElementById('winScreen').style.display = 'none';
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  currentWeaponKey = 'ak47';
  weaponCooldownTimer = 0;
  initAudio();
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
