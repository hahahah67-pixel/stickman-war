// ============================================================
// Stickman War — core simulation, compiled to WebAssembly.
// Handles physics, platform collision, climbing, bullets, and
// enemy AI. Rendering/animation/input live in JS on top of this.
// ============================================================

const GRAVITY: f32 = 1400.0;
const MAX_FALL_SPEED: f32 = 900.0;
const MOVE_SPEED: f32 = 220.0;
const JUMP_SPEED: f32 = -520.0;
const CLIMB_SPEED: f32 = 160.0;

const MAX_ENTITIES: i32 = 16;
const MAX_BULLETS: i32 = 128;
const MAX_PLATFORMS: i32 = 96;

// ---- Entities (player = index 0, enemies fill the rest) ----
let entX: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entY: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entVX: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entVY: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entW: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entH: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entTeam: StaticArray<i32> = new StaticArray<i32>(MAX_ENTITIES); // 0=blue 1=red
let entAlive: StaticArray<i32> = new StaticArray<i32>(MAX_ENTITIES);
let entOnGround: StaticArray<i32> = new StaticArray<i32>(MAX_ENTITIES);
let entFacing: StaticArray<i32> = new StaticArray<i32>(MAX_ENTITIES); // 1 right, -1 left
let entHP: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entClimbing: StaticArray<i32> = new StaticArray<i32>(MAX_ENTITIES);
let entAnim: StaticArray<i32> = new StaticArray<i32>(MAX_ENTITIES); // 0 idle 1 run 2 jump 3 shoot 4 climb 5 dead
let entCooldown: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entAIState: StaticArray<i32> = new StaticArray<i32>(MAX_ENTITIES); // 0 patrol 1 alert/shoot
let entAITimer: StaticArray<f32> = new StaticArray<f32>(MAX_ENTITIES);
let entCount: i32 = 0;

// ---- Bullets ----
let bulX: StaticArray<f32> = new StaticArray<f32>(MAX_BULLETS);
let bulY: StaticArray<f32> = new StaticArray<f32>(MAX_BULLETS);
let bulVX: StaticArray<f32> = new StaticArray<f32>(MAX_BULLETS);
let bulVY: StaticArray<f32> = new StaticArray<f32>(MAX_BULLETS);
let bulActive: StaticArray<i32> = new StaticArray<i32>(MAX_BULLETS);
let bulTeam: StaticArray<i32> = new StaticArray<i32>(MAX_BULLETS);
let bulDamage: StaticArray<f32> = new StaticArray<f32>(MAX_BULLETS);
let bulLife: StaticArray<f32> = new StaticArray<f32>(MAX_BULLETS);

// ---- Platforms ----
// type: 0 = solid ground, 1 = climbable
let platX: StaticArray<f32> = new StaticArray<f32>(MAX_PLATFORMS);
let platY: StaticArray<f32> = new StaticArray<f32>(MAX_PLATFORMS);
let platW: StaticArray<f32> = new StaticArray<f32>(MAX_PLATFORMS);
let platH: StaticArray<f32> = new StaticArray<f32>(MAX_PLATFORMS);
let platType: StaticArray<i32> = new StaticArray<i32>(MAX_PLATFORMS);
let platCount: i32 = 0;

let inputLeft: i32 = 0;
let inputRight: i32 = 0;
let inputJump: i32 = 0;
let inputUp: i32 = 0;
let inputDown: i32 = 0;
let hitFlashEntity: i32 = -1; // last entity hit this step, for JS to react to
let killedEntity: i32 = -1;   // last entity killed this step

export function resetWorld(): void {
  entCount = 0;
  platCount = 0;
  for (let i = 0; i < MAX_BULLETS; i++) bulActive[i] = 0;
}

export function addPlatform(x: f32, y: f32, w: f32, h: f32, ptype: i32): i32 {
  if (platCount >= MAX_PLATFORMS) return -1;
  const i = platCount;
  platX[i] = x; platY[i] = y; platW[i] = w; platH[i] = h; platType[i] = ptype;
  platCount++;
  return i;
}

export function spawnEntity(x: f32, y: f32, w: f32, h: f32, team: i32, hp: f32): i32 {
  if (entCount >= MAX_ENTITIES) return -1;
  const i = entCount;
  entX[i] = x; entY[i] = y; entVX[i] = 0; entVY[i] = 0;
  entW[i] = w; entH[i] = h; entTeam[i] = team;
  entAlive[i] = 1; entOnGround[i] = 0; entFacing[i] = team == 0 ? 1 : -1;
  entHP[i] = hp; entClimbing[i] = 0; entAnim[i] = 0; entCooldown[i] = 0;
  entAIState[i] = 0; entAITimer[i] = 0;
  entCount++;
  return i;
}

export function setPlayerInput(left: i32, right: i32, jump: i32, up: i32, down: i32): void {
  inputLeft = left; inputRight = right; inputJump = jump; inputUp = up; inputDown = down;
}

export function fireBullet(x: f32, y: f32, vx: f32, vy: f32, team: i32, dmg: f32): i32 {
  for (let i = 0; i < MAX_BULLETS; i++) {
    if (!bulActive[i]) {
      bulX[i] = x; bulY[i] = y; bulVX[i] = vx; bulVY[i] = vy;
      bulActive[i] = 1; bulTeam[i] = team; bulDamage[i] = dmg; bulLife[i] = 1.6;
      return i;
    }
  }
  return -1;
}

function aabbOverlap(ax: f32, ay: f32, aw: f32, ah: f32, bx: f32, by: f32, bw: f32, bh: f32): bool {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function resolvePlatformCollision(i: i32): void {
  const x = entX[i], y = entY[i], w = entW[i], h = entH[i];
  entOnGround[i] = 0;
  let climbingHere = false;

  for (let p = 0; p < platCount; p++) {
    const px = platX[p], py = platY[p], pw = platW[p], ph = platH[p];
    if (platType[p] == 1) {
      if (aabbOverlap(x, y, w, h, px, py, pw, ph)) climbingHere = true;
      continue;
    }
    if (!aabbOverlap(x, y, w, h, px, py, pw, ph)) continue;
    const overlapX = min(x + w, px + pw) - max(x, px);
    const overlapY = min(y + h, py + ph) - max(y, py);
    if (overlapX < overlapY) {
      if (x < px) entX[i] = px - w; else entX[i] = px + pw;
      entVX[i] = 0;
    } else {
      if (y < py) {
        entY[i] = py - h;
        entVY[i] = 0;
        entOnGround[i] = 1;
      } else {
        entY[i] = py + ph;
        entVY[i] = 0;
      }
    }
  }

  if (i == 0 && inputUp && climbingHere) entClimbing[i] = 1;
  else if (!climbingHere) entClimbing[i] = 0;
}

function stepPlayer(dt: f32): void {
  const i = 0;
  if (!entAlive[i]) return;

  let vx: f32 = 0;
  if (inputLeft) { vx -= MOVE_SPEED; entFacing[i] = -1; }
  if (inputRight) { vx += MOVE_SPEED; entFacing[i] = 1; }
  entVX[i] = vx;

  if (entClimbing[i]) {
    entVY[i] = inputUp ? -CLIMB_SPEED : (inputDown ? CLIMB_SPEED : 0);
  } else {
    entVY[i] += GRAVITY * dt;
    if (entVY[i] > MAX_FALL_SPEED) entVY[i] = MAX_FALL_SPEED;
    if (inputJump && entOnGround[i]) entVY[i] = JUMP_SPEED;
  }

  entX[i] += entVX[i] * dt;
  entY[i] += entVY[i] * dt;
  resolvePlatformCollision(i);

  if (entCooldown[i] > 0) entCooldown[i] -= dt;

  if (entClimbing[i]) entAnim[i] = 4;
  else if (!entOnGround[i]) entAnim[i] = 2;
  else if (vx != 0) entAnim[i] = 1;
  else entAnim[i] = 0;
}

function stepEnemyAI(i: i32, dt: f32): void {
  if (!entAlive[i]) return;
  const px = entX[0], py = entY[0];
  const dx = px - entX[i];
  const dy = py - entY[i];
  const dist = sqrt(dx * dx + dy * dy);

  entAITimer[i] -= dt;

  if (dist < 420 && entAlive[0]) {
    entAIState[i] = 1;
    entFacing[i] = dx > 0 ? 1 : -1;
    entVX[i] = 0;
    if (entAITimer[i] <= 0) {
      const dirx: f32 = dx / (dist + 0.001);
      const diry: f32 = dy / (dist + 0.001);
      fireBullet(entX[i] + entW[i] * 0.5, entY[i] + entH[i] * 0.4, dirx * 480, diry * 480, entTeam[i], 8.0);
      entAnim[i] = 3;
      entAITimer[i] = 1.1;
    }
  } else {
    entAIState[i] = 0;
    entAnim[i] = 1;
    entVX[i] = <f32>entFacing[i] * MOVE_SPEED * 0.45;
    if (entAITimer[i] <= 0) {
      entFacing[i] = -entFacing[i];
      entAITimer[i] = 2.2;
    }
  }

  entVY[i] += GRAVITY * dt;
  if (entVY[i] > MAX_FALL_SPEED) entVY[i] = MAX_FALL_SPEED;
  entX[i] += entVX[i] * dt;
  entY[i] += entVY[i] * dt;
  resolvePlatformCollision(i);
  if (entOnGround[i] && entAIState[i] == 0) entAnim[i] = 1;

  if (entCooldown[i] > 0) entCooldown[i] -= dt;
}

function stepBullets(dt: f32): void {
  for (let b = 0; b < MAX_BULLETS; b++) {
    if (!bulActive[b]) continue;
    bulLife[b] -= dt;
    if (bulLife[b] <= 0) { bulActive[b] = 0; continue; }
    bulX[b] += bulVX[b] * dt;
    bulY[b] += bulVY[b] * dt;

    let hitWall = false;
    for (let p = 0; p < platCount; p++) {
      if (platType[p] != 0) continue;
      if (bulX[b] > platX[p] && bulX[b] < platX[p] + platW[p] &&
          bulY[b] > platY[p] && bulY[b] < platY[p] + platH[p]) {
        hitWall = true; break;
      }
    }
    if (hitWall) { bulActive[b] = 0; continue; }

    for (let e = 0; e < entCount; e++) {
      if (!entAlive[e]) continue;
      if (entTeam[e] == bulTeam[b]) continue;
      if (aabbOverlap(bulX[b], bulY[b], 2, 2, entX[e], entY[e], entW[e], entH[e])) {
        entHP[e] -= bulDamage[b];
        hitFlashEntity = e;
        if (entHP[e] <= 0) {
          entAlive[e] = 0;
          entAnim[e] = 5;
          killedEntity = e;
        }
        bulActive[b] = 0;
        break;
      }
    }
  }
}

export function step(dt: f32): void {
  hitFlashEntity = -1;
  killedEntity = -1;
  stepPlayer(dt);
  for (let i = 1; i < entCount; i++) stepEnemyAI(i, dt);
  stepBullets(dt);
}

export function tryPlayerFire(vx: f32, vy: f32, dmg: f32): i32 {
  if (entCooldown[0] > 0 || !entAlive[0]) return -1;
  entCooldown[0] = 0.14;
  entAnim[0] = 3;
  const ox = entX[0] + entW[0] * 0.5;
  const oy = entY[0] + entH[0] * 0.35;
  return fireBullet(ox, oy, vx, vy, entTeam[0], dmg);
}

// ---------------- Getters for JS-side rendering ----------------
export function getEntCount(): i32 { return entCount; }
export function getEntX(i: i32): f32 { return entX[i]; }
export function getEntY(i: i32): f32 { return entY[i]; }
export function getEntFacing(i: i32): i32 { return entFacing[i]; }
export function getEntTeam(i: i32): i32 { return entTeam[i]; }
export function getEntAlive(i: i32): i32 { return entAlive[i]; }
export function getEntAnim(i: i32): i32 { return entAnim[i]; }
export function getEntHP(i: i32): f32 { return entHP[i]; }
export function getEntOnGround(i: i32): i32 { return entOnGround[i]; }
export function getEntClimbing(i: i32): i32 { return entClimbing[i]; }
export function getEntW(i: i32): f32 { return entW[i]; }
export function getEntH(i: i32): f32 { return entH[i]; }

export function getBulX(i: i32): f32 { return bulX[i]; }
export function getBulY(i: i32): f32 { return bulY[i]; }
export function getBulActive(i: i32): i32 { return bulActive[i]; }
export function getBulTeam(i: i32): i32 { return bulTeam[i]; }
export function getMaxBullets(): i32 { return MAX_BULLETS; }

export function getHitFlashEntity(): i32 { return hitFlashEntity; }
export function getKilledEntity(): i32 { return killedEntity; }
