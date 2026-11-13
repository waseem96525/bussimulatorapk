/* ============================================================
   CITY BUS SIMULATOR 3D — gameplay loop, passengers, rules, HUD
   ============================================================ */
'use strict';

let stops = [];
let lastJunction = -1, speedingTime = 0, lastSpeedFine = 0;
let camX = 0, camY = 10, camZ = 0, camShake = 0, camYawOff = 0;
let route = [], routeTimer = 0, signTimer = 0;
let fuelCost = 0, mouseDrag = false;
const CAM_NAMES = ['Chase', 'Cockpit', 'High', 'Cinematic'];

// ================================================================
// START / RESET
// ================================================================
function startGame() {
  document.getElementById('gameCanvas').style.display = 'block';
  document.getElementById('gameHUD').classList.remove('hidden');
  showScreen(null);
  initAudio();
  initThree();
  resetGame();
  setupKeys();
  lastTS = performance.now();
  animFrame = requestAnimationFrame(gameLoop);
}

function restartGame() {
  cancelAnimationFrame(animFrame);
  document.getElementById('gameCanvas').style.display = 'block';
  document.getElementById('gameHUD').classList.remove('hidden');
  showScreen(null);
  resetGame();
  lastTS = performance.now();
  animFrame = requestAnimationFrame(gameLoop);
}

function goToMenu() {
  cancelAnimationFrame(animFrame);
  gameState = 'menu';
  stopAudio();
  document.getElementById('gameCanvas').style.display = 'none';
  document.getElementById('gameHUD').classList.add('hidden');
  showScreen('mainMenu');
}

function togglePause() {
  if (gameState === 'playing') {
    gameState = 'paused'; showScreen('pauseMenu'); stopAudio();
    document.getElementById('pauseBtn').textContent = '▶';
  } else if (gameState === 'paused') {
    gameState = 'playing'; showScreen(null);
    document.getElementById('pauseBtn').textContent = '⏸';
    lastTS = performance.now();
    animFrame = requestAnimationFrame(gameLoop);
  }
}

function resetGame() {
  const cfg = CFG[difficulty];
  const s0 = STOPS[0];
  const back = 30;
  bus.angle = s0.angle;
  bus.x = s0.x - Math.sin(s0.angle)*back;
  bus.z = s0.z - Math.cos(s0.angle)*back;
  bus.speed = 0; bus.steer = 0; bus.throttle = 0; bus.brake = 0;
  bus.fuel = cfg.startFuel; bus.health = 100;
  bus.passengers = []; bus.indicator = 0; bus.hazard = false; bus.handbrake = false; bus.lights = false;
  resetBusPhysics();

  gameTimer = cfg.timeLimit;
  money = 0; score = 0; fines = 0; repairs = 0; fuelCost = 0;
  totalPassengers = 0; totalTrips = 0; comfort = 100;
  clockMin = { morning:6*60+40, noon:12*60, evening:17*60+20, night:21*60 }[timeSel];
  doorOpen = false; doorAnim = 0; boardTimer = 0;
  notifications = []; notifTimer = 0; keys = {};
  camMode = 0; camShake = 0; camYawOff = 0;
  lastJunction = -1; speedingTime = 0;
  envTimer = 0; ENV.wet = weatherSel === 'rain' ? 1 : 0;

  stops = STOPS.map((s, i) => ({ ...s, waiting:[], spawnT:rand(2, 8) }));
  stops.forEach((s, i) => { for (let k=0;k<randi(2,6);k++) addWaiting(i); });
  syncStopPeople();

  spawnTraffic();

  camX = bus.x - Math.sin(bus.angle)*16; camY = 6; camZ = bus.z - Math.cos(bus.angle)*16;
  updateBusVisual(0.016, false);
  updateEnvironment(0.016);
  setBusSign(`42  ${STOPS[1].name.toUpperCase()}`);

  document.getElementById('notification').classList.add('hidden');
  document.getElementById('pauseBtn').textContent = '⏸';
  gameState = 'playing';
  notify(`🚌 Shift started — ${weatherSel === 'rain' ? 'Rain: braking distance longer!' : 'Drive safe, keep LEFT.'}`);
  notify('🚏 Stop in the yellow BUS STOP bay, then SPACE');
}

function addWaiting(si) {
  const s = stops[si];
  if (s.waiting.length >= 10) return;
  let d; do { d = randi(0, STOPS.length-1); } while (d === si);
  const meters = dist2(STOPS[si].x, STOPS[si].z, STOPS[d].x, STOPS[d].z) * 1.3;
  s.waiting.push({ dest:d, fare: Math.round((10 + meters/100*3)/5)*5 });
}
function syncStopPeople() {
  stops.forEach((s, i) => STOPS[i].people.forEach((p, k) => p.visible = k < s.waiting.length));
}

// ================================================================
// INPUT
// ================================================================
function setupKeys() {
  window.onkeydown = (e) => {
    if (gameState !== 'playing' && !(gameState === 'paused' && (e.code === 'Escape' || e.code === 'KeyP'))) return;
    if (e.repeat && e.code !== 'KeyF') { keys[e.code] = true; return; }
    keys[e.code] = true;
    switch (e.code) {
      case 'Space': e.preventDefault(); toggleDoors(); break;
      case 'Escape': case 'KeyP': togglePause(); break;
      case 'KeyC': camMode = (camMode+1) % CAM_NAMES.length; notify(`🎥 ${CAM_NAMES[camMode]} camera`); break;
      case 'KeyQ': bus.indicator = bus.indicator === -1 ? 0 : -1; break;
      case 'KeyE': bus.indicator = bus.indicator ===  1 ? 0 :  1; break;
      case 'KeyX': bus.hazard = !bus.hazard; break;
      case 'KeyL': bus.lights = !bus.lights; break;
      case 'KeyB': bus.handbrake = !bus.handbrake; notify(bus.handbrake ? '🅿️ Parking brake ON' : '🅿️ Parking brake OFF'); break;
      case 'KeyM': SFX.master && (SFX.master.gain.value = SFX.master.gain.value > 0 ? 0 : 0.55); break;
    }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  };
  window.onkeyup = (e) => { keys[e.code] = false; };

  // Mouse drag to look around in chase / cinematic cameras
  const cv = document.getElementById('gameCanvas');
  let lx = 0;
  cv.onmousedown = e => { mouseDrag = true; lx = e.clientX; };
  window.onmouseup = () => { mouseDrag = false; };
  window.onmousemove = e => { if (mouseDrag) { camYawOff -= (e.clientX - lx) * 0.005; lx = e.clientX; } };
}

function toggleDoors() {
  if (!doorOpen && Math.abs(bus.speed) > 0.8) { notify('⚠️ Stop the bus before opening doors!'); return; }
  doorOpen = !doorOpen;
  sfxHiss();
  boardTimer = 0.8;
}

// ================================================================
// LOOP
// ================================================================
function gameLoop(ts) {
  if (gameState !== 'playing') return;
  animFrame = requestAnimationFrame(gameLoop);
  const dt = Math.min((ts - lastTS)/1000, 0.05);
  lastTS = ts;

  update(dt);
  updateCamera(dt);
  updateEnvironment(dt);
  updateAudio(dt);
  renderer.render(scene, camera);
  drawMinimap();
}

function update(dt) {
  gameTimer -= dt;
  clockMin += dt * GAME_MIN_PER_SEC;
  if (gameTimer <= 0) { endGame('time'); return; }

  updateSignals(dt);
  updateBus(dt);
  updateTraffic(dt);
  updateWalkers(dt);
  checkRules(dt);
  updateStops(dt);
  updateRefuel(dt);

  if (bus.fuel <= 0 && Math.abs(bus.speed) < 0.1) { endGame('fuel'); return; }
  if (bus.health <= 0) { endGame('health'); return; }

  // passenger comfort: harsh braking/acceleration/cornering upsets riders
  const harsh = Math.max(0, Math.abs(bus.longG) - 0.3) + Math.max(0, Math.abs(bus.lateralG) - 0.28);
  if (bus.passengers.length && harsh > 0) comfort = Math.max(0, comfort - harsh*60*dt);
  else comfort = Math.min(100, comfort + 1.5*dt);

  if (CITY.blinkers) { const on = Math.sin(performance.now()/1000*3) > 0; CITY.blinkers.forEach(b => b.visible = on); }

  // notifications queue
  if (notifications.length > 0 && notifTimer <= 0) {
    const el = document.getElementById('notification');
    el.textContent = notifications.shift();
    el.classList.remove('hidden');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    notifTimer = 2.6;
  }
  if (notifTimer > 0) { notifTimer -= dt; if (notifTimer <= 0) document.getElementById('notification').classList.add('hidden'); }

  money = Math.round(score - fines - repairs - fuelCost);
  updateHUD();
}

// ================================================================
// TRAFFIC RULES: red lights + speed limit
// ================================================================
function addFine(amount, msg) {
  const a = Math.round(amount * CFG[difficulty].fineMul / 10) * 10;
  fines += a;
  notify(`${msg} — Fine ₹${a}`);
}

function checkRules(dt) {
  const ii = intersectionAt(bus.x, bus.z, -1);
  if (ii >= 0 && lastJunction < 0 && Math.abs(bus.speed) > 2) {
    const axis = Math.abs(Math.sin(bus.angle)) > Math.abs(Math.cos(bus.angle)) ? 'h' : 'v';
    if (signalState(ii, axis) === 'R') addFine(1000, '🚦 Red light jumped!');
  }
  lastJunction = ii;

  const kmh = Math.abs(bus.speed) * 3.6;
  if (kmh > SPEED_LIMIT_KMH + 3) {
    speedingTime += dt;
    if (speedingTime > 2 && performance.now() - lastSpeedFine > 8000) {
      lastSpeedFine = performance.now();
      addFine(kmh > SPEED_LIMIT_KMH + 20 ? 600 : 250, `📸 Speed camera: ${Math.round(kmh)} km/h`);
    }
  } else speedingTime = 0;
}

// ================================================================
// STOPS: boarding & alighting
// ================================================================
function busAtStop() {
  for (let i=0;i<STOPS.length;i++) {
    const s = STOPS[i];
    const f = { x:Math.sin(s.angle), z:Math.cos(s.angle) };
    const rx = bus.x - s.x, rz = bus.z - s.z;
    const along = rx*f.x + rz*f.z, lat = rx*f.z - rz*f.x;
    const aligned = Math.cos(bus.angle - s.angle) > 0.95;
    if (Math.abs(along) < 9 && Math.abs(lat) < 2.6 && aligned) return i;
  }
  return -1;
}

function updateStops(dt) {
  stops.forEach((s, i) => { s.spawnT -= dt; if (s.spawnT <= 0) { s.spawnT = rand(7, 16); addWaiting(i); syncStopPeople(); } });

  const si = busAtStop();
  const stopped = Math.abs(bus.speed) < 0.3;
  const info = document.getElementById('stopHint');
  if (si >= 0 && stopped) {
    info.classList.remove('hidden');
    info.textContent = doorOpen ? `🚏 ${STOPS[si].name}: boarding…` : `🚏 ${STOPS[si].name} — press SPACE to open doors`;
  } else if (si >= 0) {
    info.classList.remove('hidden'); info.textContent = `🚏 ${STOPS[si].name} — come to a full stop`;
  } else info.classList.add('hidden');

  if (!doorOpen || si < 0 || !stopped) return;
  boardTimer -= dt;
  if (boardTimer > 0) return;
  boardTimer = rand(0.6, 1.0);

  const s = stops[si];
  const alightIdx = bus.passengers.findIndex(p => p.dest === si);
  if (alightIdx >= 0) {
    const p = bus.passengers.splice(alightIdx, 1)[0];
    const tip = Math.round(p.fare * 0.4 * comfort/100);
    score += tip;
    totalPassengers++;
    if (tip > 0) sfxCoin();
    if (!bus.passengers.some(q => q.dest === si)) { totalTrips++; notify(`✅ Passengers dropped at ${STOPS[si].name}${tip ? ` · tips ₹${tip}` : ''}`); }
    return;
  }
  if (s.waiting.length && bus.passengers.length < bus.capacity) {
    const p = s.waiting.shift();
    p.boardTime = gameTimer;
    bus.passengers.push(p);
    score += p.fare;
    sfxBell();
    syncStopPeople();
    if (!s.waiting.length) notify(`🎟️ All aboard! ${bus.passengers.length}/${bus.capacity} · close doors (SPACE)`);
  }
}

function updateRefuel(dt) {
  const g = GAS.find(g => dist2(bus.x, bus.z, g.x, g.z) < 10);
  const hint = document.getElementById('fuelHint');
  if (!g) { hint.classList.add('hidden'); return; }
  hint.classList.remove('hidden');
  if (Math.abs(bus.speed) > 0.3) { hint.textContent = '⛽ Stop here to refuel'; return; }
  if (keys['KeyF'] && bus.fuel < TANK_SIZE - 0.1) {
    const add = Math.min(8*dt, TANK_SIZE - bus.fuel);
    bus.fuel += add; fuelCost += add * FUEL_PRICE;
    hint.textContent = `⛽ Refuelling… ${bus.fuel.toFixed(0)} L  (−₹${Math.round(fuelCost)})`;
  } else hint.textContent = `⛽ Hold F to refuel · ₹${FUEL_PRICE}/L`;
}

// ================================================================
// CAMERA
// ================================================================
function shakeCamera(k) { camShake = Math.max(camShake, k); }

function updateCamera(dt) {
  const a = bus.angle;
  const f = { x:Math.sin(a), z:Math.cos(a) };
  camShake = Math.max(0, camShake - dt*2);
  const sh = () => (Math.random()-0.5) * camShake * 0.6;

  if (camMode === 1) {   // cockpit: driver's eye, follows body roll/pitch
    const b = busParts.body;
    const eye = new THREE.Vector3(-0.7, 1.98, 5.25);
    b.localToWorld(eye);
    camera.position.set(eye.x + sh(), eye.y + sh(), eye.z);
    const look = new THREE.Vector3(-0.7 + Math.sin(camYawOff)*10, 1.15, 5.25 + Math.cos(camYawOff)*10);
    b.localToWorld(look);
    camera.lookAt(look);
    camera.fov = 75; camera.updateProjectionMatrix();
    return;
  }
  camera.fov = 60; camera.updateProjectionMatrix();

  let dist, height, lookH;
  if (camMode === 0) { dist = 17; height = 5.8; lookH = 2.2; }
  else if (camMode === 2) { dist = 34; height = 24; lookH = 0; }
  else { dist = 22; height = 3; lookH = 2; }

  const ya = a + camYawOff + (camMode === 3 ? performance.now()/6000 : 0);
  const tx = bus.x - Math.sin(ya)*dist, tz = bus.z - Math.cos(ya)*dist;
  const k = 1 - Math.exp(-dt * (camMode === 3 ? 1.5 : 4));
  camX = lerp(camX, tx, k); camZ = lerp(camZ, tz, k); camY = lerp(camY, height, k);
  if (!mouseDrag) camYawOff *= Math.exp(-dt*0.8);   // recentre slowly after looking around
  camera.position.set(camX + sh(), camY + sh(), camZ + sh());
  camera.lookAt(bus.x + f.x*4, lookH, bus.z + f.z*4);
}

// ================================================================
// ROUTE / GPS
// ================================================================
function nodeXZ(i, j) { return { x:V_ROADS[i], z:H_ROADS[j] }; }
function nearestNode(x, z) {
  let best = null, bd = 1e9;
  V_ROADS.forEach((vx, i) => H_ROADS.forEach((hz, j) => { const d = dist2(x, z, vx, hz); if (d < bd) { bd = d; best = [i, j]; } }));
  return best;
}
function computeRoute(destStop) {
  const s = STOPS[destStop];
  // arrive from the junction behind the stop so the bus faces the right way
  const cr = s.axis === 'h' ? V_ROADS : H_ROADS;
  const behind = s.dir > 0 ? Math.max(...cr.filter(c => c < s.at)) : Math.min(...cr.filter(c => c > s.at));
  const goal = s.axis === 'h' ? [V_ROADS.indexOf(behind), H_ROADS.indexOf(s.road)] : [V_ROADS.indexOf(s.road), H_ROADS.indexOf(behind)];
  const start = nearestNode(bus.x + Math.sin(bus.angle)*30, bus.z + Math.cos(bus.angle)*30);
  const key = (n) => n[0] + ',' + n[1];
  const prev = {}, q = [start], seen = new Set([key(start)]);
  while (q.length) {
    const n = q.shift();
    if (n[0] === goal[0] && n[1] === goal[1]) break;
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([di, dj]) => {
      const m = [n[0]+di, n[1]+dj];
      if (m[0] < 0 || m[1] < 0 || m[0] >= V_ROADS.length || m[1] >= H_ROADS.length || seen.has(key(m))) return;
      seen.add(key(m)); prev[key(m)] = n; q.push(m);
    });
  }
  const path = [];
  let n = goal;
  while (n) { path.unshift(nodeXZ(n[0], n[1])); n = prev[key(n)]; if (n && key(n) === key(start)) { path.unshift(nodeXZ(n[0], n[1])); break; } }
  path.unshift({ x:bus.x, z:bus.z });
  path.push({ x:s.x, z:s.z });
  return path;
}

function nextStopTarget() {
  if (bus.passengers.length) {
    let best = null, bd = 1e9;
    bus.passengers.forEach(p => { const d = dist2(bus.x, bus.z, STOPS[p.dest].x, STOPS[p.dest].z); if (d < bd) { bd = d; best = p.dest; } });
    return best;
  }
  let best = 0, bw = -1;
  stops.forEach((s, i) => { const sc = s.waiting.length*100 - dist2(bus.x, bus.z, s.x, s.z)*0.2; if (i !== busAtStop() && sc > bw) { bw = sc; best = i; } });
  return best;
}

// ================================================================
// HUD
// ================================================================
const $ = id => document.getElementById(id);
function updateHUD() {
  const kmh = Math.abs(bus.speed)*3.6;
  $('moneyDisplay').textContent = `₹${money.toLocaleString()}`;
  $('fareDisplay').textContent = `₹${score.toLocaleString()}`;
  $('fineDisplay').textContent = `₹${(fines + repairs).toLocaleString()}`;
  $('timeDisplay').textContent = fmtT(gameTimer);
  $('clockDisplay').textContent = fmtClock(clockMin);
  $('speedDisplay').textContent = Math.round(kmh);
  $('gearDisplay').textContent = gearMode === 'R' ? 'R' : (doorOpen || bus.handbrake) && Math.abs(bus.speed) < 0.2 ? 'P' : `D${bus.gear}`;
  $('rpmBar').style.width = `${clamp((bus.rpm-500)/(DRIVE.redline-500), 0, 1)*100}%`;
  $('rpmText').textContent = `${Math.round(bus.rpm/10)*10} rpm`;
  $('passengerDisplay').textContent = `${bus.passengers.length}/${bus.capacity}`;
  $('fuelBar').style.width = `${bus.fuel/TANK_SIZE*100}%`;
  $('fuelText').textContent = `${bus.fuel.toFixed(1)} L`;
  $('healthBar').style.width = `${bus.health}%`;
  $('comfortBar').style.width = `${comfort}%`;
  $('fuelBar').style.background = bus.fuel < 12 ? '#ff4444' : 'linear-gradient(90deg,#ff8800,#ffcc00)';
  $('healthBar').style.background = bus.health > 60 ? '#2ecc71' : bus.health > 30 ? '#f39c12' : '#e74c3c';
  $('comfortBar').style.background = comfort > 60 ? '#00d4ff' : comfort > 30 ? '#f39c12' : '#e74c3c';
  $('limitSign').classList.toggle('over', kmh > SPEED_LIMIT_KMH + 3);

  const arc = $('speedArc');
  arc.setAttribute('stroke-dasharray', `${clamp(kmh/90, 0, 1)*126} 126`);
  arc.setAttribute('stroke', kmh > SPEED_LIMIT_KMH + 3 ? '#ff4444' : '#00ff88');

  const blink = (performance.now() % 700) < 350;
  $('indL').classList.toggle('on', blink && (bus.indicator === -1 || bus.hazard));
  $('indR').classList.toggle('on', blink && (bus.indicator ===  1 || bus.hazard));
  $('lightIcon').classList.toggle('on', bus.lights || nightFactor > 0.4 || weatherSel !== 'clear');
  $('pbIcon').classList.toggle('on', bus.handbrake);
  $('doorStatus').textContent = doorOpen ? '🚪 Doors OPEN' : '🚪 Doors closed';
  $('doorStatus').classList.toggle('open', doorOpen);

  // destination info + LED sign
  const t = nextStopTarget();
  const ds = STOPS[t];
  const d = Math.round(dist2(bus.x, bus.z, ds.x, ds.z));
  $('nextStopName').textContent = ds.name;
  $('nextStopDist').textContent = d > 1000 ? `${(d/1000).toFixed(1)} km` : `${d} m`;
  $('nextStopLabel').textContent = bus.passengers.length ? `🏁 Drop-off (${bus.passengers.filter(p=>p.dest===t).length})` : `🧍 Pick-up (${stops[t].waiting.length} waiting)`;
  signTimer -= 1/60;
  if (signTimer <= 0) { signTimer = 3; setBusSign(`42  ${ds.name.toUpperCase()}`); }
  routeTimer -= 1/60;
  if (routeTimer <= 0) { routeTimer = 1; route = computeRoute(t); route.target = t; }

  const td = $('timeDisplay');
  td.style.color = gameTimer < 60 ? '#ff4444' : '';
}

// ================================================================
// MINIMAP (GPS, heading-up, centred on the bus)
// ================================================================
function drawMinimap() {
  const el = $('minimap'), mc = el.getContext('2d');
  const S = el.width, R = S/2, scale = S/360;    // ~360 m across
  mc.save();
  mc.clearRect(0, 0, S, S);
  mc.beginPath(); mc.arc(R, R, R, 0, Math.PI*2); mc.clip();
  mc.fillStyle = '#1d2a1f'; mc.fillRect(0, 0, S, S);
  mc.translate(R, R);
  mc.rotate(Math.PI + bus.angle);           // heading-up
  mc.scale(scale, scale);
  mc.translate(-bus.x, -bus.z);

  // blocks
  (CITY.blocks || []).forEach(b => { mc.fillStyle = b.park ? '#2f5a2a' : '#3a3f47'; mc.fillRect(b.x1, b.z1, b.x2-b.x1, b.z2-b.z1); });
  mc.fillStyle = '#525a64';
  CITY.colliders.forEach(c => mc.fillRect(c.x1, c.z1, c.x2-c.x1, c.z2-c.z1));
  // roads
  mc.strokeStyle = '#11151a'; mc.lineWidth = RW*2;
  H_ROADS.forEach(z => { mc.beginPath(); mc.moveTo(V_ROADS[0]-RW, z); mc.lineTo(V_ROADS[5]+RW, z); mc.stroke(); });
  V_ROADS.forEach(x => { mc.beginPath(); mc.moveTo(x, H_ROADS[0]-RW); mc.lineTo(x, H_ROADS[5]+RW); mc.stroke(); });
  // signals
  CITY.signals.forEach((sg, ii) => {
    const i = ii % V_ROADS.length, j = Math.floor(ii / V_ROADS.length);
    ['h','v'].forEach(ax => {
      const st = signalState(ii, ax);
      mc.fillStyle = st === 'G' ? '#2ecc71' : st === 'Y' ? '#f1c40f' : '#e74c3c';
      const o = ax === 'h' ? [ -RW-3, 0 ] : [ 0, -RW-3 ];
      mc.fillRect(V_ROADS[i] + o[0] - 2, H_ROADS[j] + o[1] - 2, 4, 4);
    });
  });
  // route
  if (route.length > 1) {
    mc.strokeStyle = 'rgba(0,212,255,0.85)'; mc.lineWidth = 5; mc.lineJoin = 'round';
    mc.beginPath(); mc.moveTo(route[0].x, route[0].z); route.forEach(p => mc.lineTo(p.x, p.z)); mc.stroke();
  }
  // fuel + stops
  GAS.forEach(g => { mc.fillStyle = '#ff8800'; mc.fillRect(g.x-5, g.z-5, 10, 10); });
  STOPS.forEach((s, i) => {
    const tgt = route.target === i;
    mc.fillStyle = tgt ? '#ffcc00' : s.cs;
    mc.beginPath(); mc.arc(s.x, s.z, tgt ? 9 : 6, 0, Math.PI*2); mc.fill();
  });
  // traffic
  mc.fillStyle = '#e0e0e0';
  TRAFFIC.cars.forEach(c => { mc.save(); mc.translate(c.x, c.z); mc.rotate(-c.angle); mc.fillRect(-c.wid/2, -c.len/2, c.wid, c.len); mc.restore(); });
  mc.restore();

  // bus arrow fixed at centre, pointing up
  mc.fillStyle = '#00d4ff'; mc.strokeStyle = '#002'; mc.lineWidth = 1.5;
  mc.beginPath(); mc.moveTo(R, R-9); mc.lineTo(R+6, R+7); mc.lineTo(R, R+3); mc.lineTo(R-6, R+7); mc.closePath(); mc.fill(); mc.stroke();
  mc.fillStyle = 'rgba(255,255,255,0.7)'; mc.font = 'bold 10px Arial'; mc.textAlign = 'center';
  // north (world -z) indicator on the rim
  mc.fillText('N', R - Math.sin(bus.angle)*(R-10), R + Math.cos(bus.angle)*(R-10) + 4);
}

// ================================================================
// GAME OVER
// ================================================================
function endGame(reason) {
  gameState = 'gameover';
  cancelAnimationFrame(animFrame);
  stopAudio();
  const ico = { time:'🏁', fuel:'⛽', health:'💀' };
  const ttl = { time:'Shift Complete!', fuel:'Out of Diesel!', health:'Bus Wrecked!' };
  $('gameOverIcon').textContent = ico[reason] || '💀';
  $('gameOverTitle').textContent = ttl[reason] || 'Game Over!';
  const final = Math.max(0, money);
  $('finalScore').textContent = `₹${final.toLocaleString()}`;
  $('finalMoney').textContent = `₹${score.toLocaleString()}`;
  $('finalFines').textContent = `−₹${(fines + repairs + Math.round(fuelCost)).toLocaleString()}`;
  $('finalPassengers').textContent = totalPassengers;
  $('finalTrips').textContent = totalTrips;
  $('finalComfort').textContent = `${Math.round(comfort)}%`;
  const scores = getHiScores();
  const isNew = final > 0 && (scores.length < 10 || final > (scores[scores.length-1]?.score || 0));
  $('newHighScore').classList.toggle('hidden', !isNew);
  if (isNew) saveHiScore(final);
  showScreen('gameOverScreen');
  $('gameHUD').classList.add('hidden');
}

window.addEventListener('DOMContentLoaded', () => showScreen('mainMenu'));
