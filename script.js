```javascript
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");

  const ui = {
    score: $("scoreHud"), combo: $("comboHud"), sector: $("sectorHud"),
    health: $("healthFill"), healthText: $("healthText"),
    bestSide: $("bestSide"), runsSide: $("runsSide"), energy: $("energySide"),
    kills: $("killsSide"), near: $("nearSide"), bestBottom: $("bestBottom"),
    runsBottom: $("runsBottom"), shardsBottom: $("shardsBottom"),
    state: $("runState"), status: $("statusText"), footer: $("footerState"),
    bars: $("threatBars"), missionProgress: $("missionProgress"),
    missionCount: $("missionCount"), missionTitle: $("missionTitle"),
    missionDesc: $("missionDesc"), start: $("startOverlay"),
    pause: $("pauseOverlay"), over: $("gameOverOverlay"),
    levelToast: $("levelToast"), modal: $("upgradeModal"),
    options: $("upgradeOptions"), toast: $("toast"),
    dashLabel: $("dashLabel"), dashFlash: $("dashFlash")
  };

  const STORE = "voidRushRecords_v1";
  const initialRecords = () => ({ best: 0, runs: 0, lifetimeShards: 0 });
  let records = initialRecords();
  try {
    records = { ...records, ...JSON.parse(localStorage.getItem(STORE) || "{}") };
  } catch (_) {}

  let W = 900, H = 560, dpr = 1, last = 0, raf = 0;
  let toastTimer = 0, levelTimer = 0;
  let mode = "menu", soundOn = true, audio = null;
  let keys = new Set(), touchDirs = new Set();
  let entities = [], particles = [], floaters = [];
  let player, score = 0, energy = 0, kills = 0, nearMisses = 0;
  let combo = 1, bestCombo = 1, elapsed = 0, sector = 1;
  let spawnTimer = 0, shardTimer = 0, screenShake = 0, lastNear = 0;
  let upgrades = { speed: 0, hull: 0, magnet: 0, dash: 0, score: 0 };

  const rand = (a, b) => Math.random() * (b - a) + a;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const pad = (n, size = 6) => String(Math.floor(n)).padStart(size, "0");
  const timeText = n => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  function saveRecords() {
    try { localStorage.setItem(STORE, JSON.stringify(records)); } catch (_) {}
    updateRecordUI();
  }

  function updateRecordUI() {
    ui.bestSide.textContent = pad(records.best);
    ui.bestBottom.textContent = pad(records.best);
    ui.runsSide.textContent = pad(records.runs, 2);
    ui.runsBottom.textContent = pad(records.runs, 2);
    ui.shardsBottom.textContent = pad(records.lifetimeShards, 3);
  }

  function setMode(next) {
    mode = next;
    const labels = {
      menu: ["STANDBY", "AWAITING PILOT INPUT"],
      playing: ["RUN IN PROGRESS", "VOID IS ACTIVE"],
      paused: ["PAUSED", "RUN SUSPENDED"],
      over: ["SIGNAL LOST", "RUN TERMINATED"],
      upgrade: ["EVOLUTION", "SELECT AN UPGRADE"]
    };
    ui.state.innerHTML = `<span class="live-dot"></span> ${labels[next][0]}`;
    ui.status.textContent = next === "playing" ? "SIGNAL STABLE" :
      next === "over" ? "SIGNAL LOST" : next === "paused" ? "SYSTEM PAUSED" : "SYSTEM ONLINE";
    ui.footer.textContent = labels[next][1];
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 1900);
  }

  function beep(freq = 440, duration = 0.07, type = "sine", volume = 0.035) {
    if (!soundOn) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audio.currentTime);
      gain.gain.setValueAtTime(volume, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
      osc.connect(gain); gain.connect(audio.destination);
      osc.start(); osc.stop(audio.currentTime + duration);
    } catch (_) {}
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (player) { player.x = clamp(player.x, 22, W - 22); player.y = clamp(player.y, 22, H - 22); }
    draw();
  }
  window.addEventListener("resize", resize);

  function resetRun() {
    entities = []; particles = []; floaters = []; keys.clear(); touchDirs.clear();
    score = 0; energy = 0; kills = 0; nearMisses = 0; combo = 1; bestCombo = 1;
    elapsed = 0; sector = 1; spawnTimer = 0.8; shardTimer = 1.3;
    screenShake = 0; lastNear = 0;
    upgrades = { speed: 0, hull: 0, magnet: 0, dash: 0, score: 0 };
    player = {
      x: W / 2, y: H / 2, r: 10, vx: 0, vy: 0, hp: 100, maxHp: 100,
      speed: 220, dashCooldown: 0, dashTime: 0, invuln: 1.2, trail: []
    };
    updateHUD(); updateMission(); draw();
  }

  function startRun() {
    if (mode === "playing") return;
    cancelAnimationFrame(raf); resetRun();
    ui.start.classList.add("hidden"); ui.pause.classList.add("hidden");
    ui.over.classList.add("hidden"); ui.modal.classList.add("hidden");
    setMode("playing"); beep(580, 0.1, "triangle");
    last = performance.now(); raf = requestAnimationFrame(loop);
  }

  function pauseRun() {
    if (mode === "playing") {
      setMode("paused"); ui.pause.classList.remove("hidden");
      keys.clear(); touchDirs.clear(); beep(260, 0.08);
    } else if (mode === "paused") {
      ui.pause.classList.add("hidden"); setMode("playing");
      last = performance.now(); raf = requestAnimationFrame(loop);
    }
  }

  function endRun() {
    if (mode !== "playing") return;
    setMode("over"); ui.over.classList.remove("hidden"); records.runs++;
    const newBest = score > records.best;
    if (newBest) records.best = score;
    records.lifetimeShards += energy; saveRecords();
    $("finalScore").textContent = pad(score);
    $("finalCombo").textContent = `x${bestCombo.toFixed(1)}`;
    $("finalTime").textContent = timeText(elapsed);
    $("newBest").classList.toggle("hidden", !newBest);
    if (newBest) beep(880, 0.3, "triangle", 0.05);
    else beep(160, 0.25, "sawtooth", 0.035);
    keys.clear(); touchDirs.clear(); draw();
  }

  function spawnEnemy() {
    const edge = Math.floor(rand(0, 4)); let x, y;
    if (edge === 0) { x = rand(0, W); y = -20; }
    else if (edge === 1) { x = W + 20; y = rand(0, H); }
    else if (edge === 2) { x = rand(0, W); y = H + 20; }
    else { x = -20; y = rand(0, H); }
    const roll = Math.random();
    const type = roll < 0.58 ? "seeker" : roll < 0.82 ? "drifter" : "hunter";
    const speed = (type === "hunter" ? rand(105, 145) : type === "drifter" ? rand(60, 95) : rand(75, 115)) *
      (1 + Math.min(sector - 1, 10) * 0.065);
    entities.push({
      kind: "enemy", type, x, y,
      r: type === "hunter" ? 12 : type === "drifter" ? 8 : 10,
      vx: 0, vy: 0, speed, age: 0, phase: rand(0, 7),
      color: type === "hunter" ? "#ff557a" : type === "drifter" ? "#c27aff" : "#ff8c6b",
      near: false
    });
  }

  function spawnShard(x = rand(25, W - 25), y = rand(25, H - 25), value = 1) {
    entities.push({ kind: "shard", x, y, r: 6, value, phase: rand(0, 7), life: 0 });
  }

  function burst(x, y, color, count = 10, power = 120) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2), s = rand(power * 0.25, power);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.65), max: 0.65, r: rand(1, 3), color });
    }
  }

  function addFloater(x, y, text, color) {
    floaters.push({ x, y, text, color, life: 0.8, max: 0.8 });
  }

  function activateDash() {
    if (mode !== "playing" || !player || player.dashCooldown > 0) return;
    let dx = (keys.has("ArrowRight") || keys.has("d") || keys.has("D") || touchDirs.has("right") ? 1 : 0) -
      (keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || touchDirs.has("left") ? 1 : 0);
    let dy = (keys.has("ArrowDown") || keys.has("s") || keys.has("S") || touchDirs.has("down") ? 1 : 0) -
      (keys.has("ArrowUp") || keys.has("w") || keys.has("W") || touchDirs.has("up") ? 1 : 0);
    if (!dx && !dy) {
      dx = player.vx; dy = player.vy;
      if (Math.hypot(dx, dy) < 1) { dx = 1; dy = 0; }
    }
    const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
    player.vx = dx * (560 + upgrades.dash * 45);
    player.vy = dy * (560 + upgrades.dash * 45);
    player.dashTime = 0.19;
    player.dashCooldown = Math.max(0.75, 1.65 - upgrades.dash * 0.18);
    player.invuln = 0.25;
    burst(player.x, player.y, "#42d9ff", 14, 170);
    ui.dashFlash.classList.remove("flash"); void ui.dashFlash.offsetWidth; ui.dashFlash.classList.add("flash");
    beep(260, 0.12, "sawtooth", 0.025);
  }

  function takeDamage(amount = 24) {
    if (player.invuln > 0 || mode !== "playing") return;
    player.hp = Math.max(0, player.hp - amount);
    player.invuln = 0.85; screenShake = 9; combo = 1;
    burst(player.x, player.y, "#ff557a", 15, 180);
    beep(100, 0.18, "sawtooth", 0.05); updateHUD();
    if (player.hp <= 0) endRun();
  }

  function collectShard(e) {
    energy++;
    score += Math.round(80 * combo * (1 + upgrades.score * 0.12));
    combo = Math.min(9.9, combo + 0.25); bestCombo = Math.max(bestCombo, combo);
    burst(e.x, e.y, "#42d9ff", 9, 100);
    addFloater(e.x, e.y - 8, `+${Math.round(80 * combo)}`, "#42d9ff");
    beep(520 + energy % 5 * 70, 0.055, "sine", 0.025);

    // Every collected shard restores 5 percentage points of hull integrity.
    if (player.hp < 100) {
      player.hp = Math.min(100, player.hp + 5);
      addFloater(player.x, player.y - 18, "HULL +5", "#60f4c5");
    }

    if (energy > 0 && energy % 10 === 0) openUpgrade();
    updateHUD();
  }

  function update(dt) {
    elapsed += dt;
    const targetSector = 1 + Math.floor(elapsed / 35);
    if (targetSector > sector) {
      sector = targetSector; ui.levelToast.classList.remove("hidden");
      clearTimeout(levelTimer);
      levelTimer = setTimeout(() => ui.levelToast.classList.add("hidden"), 1600);
      showToast(`SECTOR ${String(sector).padStart(2, "0")} — THREAT INCREASED`);
      beep(680, 0.18, "triangle", 0.04);
    }

    const up = keys.has("ArrowUp") || keys.has("w") || keys.has("W") || touchDirs.has("up");
    const down = keys.has("ArrowDown") || keys.has("s") || keys.has("S") || touchDirs.has("down");
    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || touchDirs.has("left");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D") || touchDirs.has("right");
    let dx = (right ? 1 : 0) - (left ? 1 : 0);
    let dy = (down ? 1 : 0) - (up ? 1 : 0);
    const mag = Math.hypot(dx, dy);
    if (mag) { dx /= mag; dy /= mag; }

    const accel = player.speed * (1 + upgrades.speed * 0.12);
    if (player.dashTime > 0) {
      player.dashTime -= dt;
      player.x += player.vx * dt; player.y += player.vy * dt;
      player.vx *= Math.pow(0.04, dt); player.vy *= Math.pow(0.04, dt);
    } else {
      player.vx += (dx * accel - player.vx) * Math.min(1, dt * 11);
      player.vy += (dy * accel - player.vy) * Math.min(1, dt * 11);
      player.x += player.vx * dt; player.y += player.vy * dt;
    }
    player.x = clamp(player.x, player.r + 4, W - player.r - 4);
    player.y = clamp(player.y, player.r + 4, H - player.r - 4);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.invuln = Math.max(0, player.invuln - dt);
    player.trail.unshift({ x: player.x, y: player.y, life: 0.3 });
    player.trail = player.trail.filter(t => (t.life -= dt) > 0);

    // Spawn intervals are 25% longer to ease the enemy pressure.
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = Math.max(0.32, (1.15 - Math.min(sector - 1, 12) * 0.055) * 1.25);
    }
    shardTimer -= dt;
    if (shardTimer <= 0) {
      spawnShard(); shardTimer = rand(2.2, 3.7);
    }

    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.kind === "shard") {
        e.phase += dt * 3; e.life += dt;
        const mx = player.x - e.x, my = player.y - e.y, dist = Math.hypot(mx, my);
        const magnetRange = 75 + upgrades.magnet * 48;
        if (dist < magnetRange && dist > 1) {
          const pull = (1 - dist / magnetRange) * (170 + upgrades.magnet * 35);
          e.x += mx / dist * pull * dt; e.y += my / dist * pull * dt;
        }
        if (dist < player.r + e.r + 3) {
          collectShard(e); entities.splice(i, 1); continue;
        }
        if (e.life > 15) { entities.splice(i, 1); continue; }
      } else {
        e.age += dt;
        const vx = player.x - e.x, vy = player.y - e.y, dist = Math.hypot(vx, vy) || 1;
        if (e.type === "drifter") {
          const sway = Math.sin(e.age * 2.6 + e.phase) * 0.8;
          e.vx += (vx / dist * e.speed + -vy / dist * e.speed * sway - e.vx) * Math.min(1, dt * 2.5);
          e.vy += (vy / dist * e.speed + vx / dist * e.speed * sway - e.vy) * Math.min(1, dt * 2.5);
        } else if (e.type === "hunter") {
          const burstSpeed = e.speed * (e.age % 2.8 < 0.7 ? 1.7 : 0.72);
          e.vx += (vx / dist * burstSpeed - e.vx) * Math.min(1, dt * 2.1);
          e.vy += (vy / dist * burstSpeed - e.vy) * Math.min(1, dt * 2.1);
        } else {
          e.vx += (vx / dist * e.speed - e.vx) * Math.min(1, dt * 3.2);
          e.vy += (vy / dist * e.speed - e.vy) * Math.min(1, dt * 3.2);
        }
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (!e.near && dist < player.r + e.r + 17 && dist > player.r + e.r + 2 && performance.now() - lastNear > 450) {
          e.near = true; lastNear = performance.now(); nearMisses++;
          combo = Math.min(9.9, combo + 0.35); bestCombo = Math.max(bestCombo, combo);
          score += Math.round(35 * combo);
          addFloater(player.x, player.y - 18, "NEAR MISS", "#c27aff");
          beep(760, 0.045, "sine", 0.02);
        }
        if (dist < player.r + e.r) {
          takeDamage(e.type === "hunter" ? 30 : 22);
          burst(e.x, e.y, e.color, 8, 100);
          entities.splice(i, 1); kills++; continue;
        }
        if (e.x < -60 || e.x > W + 60 || e.y < -60 || e.y > H + 60) entities.splice(i, 1);
      }
    }

    particles = particles.filter(p => {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.05, dt); p.vy *= Math.pow(0.05, dt);
      return (p.life -= dt) > 0;
    });
    floaters = floaters.filter(f => {
      f.y -= 25 * dt; return (f.life -= dt) > 0;
    });
    screenShake = Math.max(0, screenShake - 28 * dt);
    if (Math.floor(elapsed) % 2 === 0) score += Math.round(dt * 4 * combo);
    updateHUD(); updateMission();
  }

  function updateHUD() {
    ui.score.textContent = pad(score);
    ui.combo.textContent = `x${combo.toFixed(1)}`;
    ui.sector.textContent = String(sector).padStart(2, "0");
    ui.health.style.width = `${player.hp}%`;
    ui.healthText.textContent = `${Math.ceil(player.hp)}%`;
    ui.energy.textContent = pad(energy, 2);
    ui.kills.textContent = pad(kills, 2);
    ui.near.textContent = pad(nearMisses, 2);
    [...ui.bars.children].forEach((bar, i) => bar.classList.toggle("active", i < Math.min(5, Math.ceil(sector / 2))));
    ui.dashLabel.textContent = !player || player.dashCooldown <= 0 ? "READY" : `${player.dashCooldown.toFixed(1)}s`;
    $("dashBtn").style.opacity = !player || player.dashCooldown <= 0 ? "1" : "0.65";
  }

  function updateMission() {
    const progress = Math.min(100, elapsed / 30 * 100);
    ui.missionProgress.style.width = `${progress}%`;
    ui.missionCount.textContent = `${Math.min(30, Math.floor(elapsed))} / 30 seconds`;
    if (elapsed >= 30) {
      ui.missionTitle.textContent = "STAY ALIVE";
      ui.missionDesc.textContent = "The void grows more aggressive with every sector.";
    } else {
      ui.missionTitle.textContent = "SURVIVE";
      ui.missionDesc.textContent = "Outlast the collapse. Collect energy. Don't get caught.";
    }
  }

  function drawBackground() {
    // Bright neutral arena; colored gameplay objects and effects retain their original colors.
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
    grad.addColorStop(0, "#FFFFFF"); grad.addColorStop(1, "#D1D5DB");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    const step = 32, off = (elapsed * 8) % step;
    ctx.strokeStyle = "#4B556322"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = -step; x < W + step; x += step) { ctx.moveTo(x + off, 0); ctx.lineTo(x + off, H); }
    for (let y = -step; y < H + step; y += step) { ctx.moveTo(0, y + off); ctx.lineTo(W, y + off); }
    ctx.stroke();
    for (let i = 0; i < 55; i++) {
      const x = (i * 137.7 + Math.sin(i * 3.1) * 40) % W;
      const y = (i * 83.3 + elapsed * (4 + i % 3)) % H;
      ctx.fillStyle = i % 5 === 0 ? "#4B556344" : "#4B55631C";
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    const pulse = 1 + Math.sin(elapsed * 1.5) * 0.025;
    ctx.strokeStyle = `rgba(75,85,99,${0.09 + Math.sin(elapsed) * 0.025})`;
    ctx.lineWidth = 1; ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * 0.29 * pulse, H * 0.33 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function draw() {
    if (!ctx) return;
    ctx.save();
    if (screenShake > 0 && mode === "playing") ctx.translate(rand(-screenShake, screenShake), rand(-screenShake, screenShake));
    drawBackground();
    entities.forEach(e => {
      if (e.kind === "shard") {
        const pulse = 1 + Math.sin(e.phase) * 0.2;
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.phase * 0.3);
        ctx.shadowBlur = 17; ctx.shadowColor = "#42d9ff";
        ctx.strokeStyle = "#42d9ff"; ctx.fillStyle = "#42d9ff22"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(0, -e.r * pulse); ctx.lineTo(e.r * pulse, 0);
        ctx.lineTo(0, e.r * pulse); ctx.lineTo(-e.r * pulse, 0); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.restore();
      } else {
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(player ? player.y - e.y : 0, player ? player.x - e.x : 1));
        ctx.shadowBlur = 14; ctx.shadowColor = e.color; ctx.strokeStyle = e.color;
        ctx.fillStyle = e.color + "18"; ctx.lineWidth = 1.5;
        if (e.type === "drifter") {
          ctx.beginPath();
          for (let j = 0; j < 6; j++) {
            const a = j * Math.PI / 3, x = Math.cos(a) * e.r, y = Math.sin(a) * e.r;
            if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(e.r + 3, 0); ctx.lineTo(-e.r * 0.7, -e.r * 0.8);
          ctx.lineTo(-e.r * 0.45, 0); ctx.lineTo(-e.r * 0.7, e.r * 0.8);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    });
    particles.forEach(p => {
      ctx.globalAlpha = clamp(p.life / (p.max || 0.65), 0, 1);
      ctx.fillStyle = p.color; ctx.shadowBlur = 7; ctx.shadowColor = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    floaters.forEach(f => {
      ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
      ctx.font = "10px 'DM Mono', monospace"; ctx.textAlign = "center";
      ctx.fillStyle = f.color; ctx.shadowBlur = 8; ctx.shadowColor = f.color;
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (player) {
      player.trail.forEach(t => {
        ctx.globalAlpha = (t.life / 0.3) * 0.23; ctx.fillStyle = "#42d9ff";
        ctx.beginPath(); ctx.arc(t.x, t.y, player.r * (t.life / 0.3), 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      const flicker = player.invuln > 0 && Math.floor(elapsed * 16) % 2 === 0;
      if (!flicker) {
        ctx.save(); ctx.translate(player.x, player.y);
        ctx.rotate(Math.atan2(player.vy, player.vx) + Math.PI / 2);
        ctx.shadowBlur = 18; ctx.shadowColor = "#4B5563";
        ctx.fillStyle = "#D1D5DB"; ctx.strokeStyle = "#4B5563"; ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 9); ctx.lineTo(0, 5); ctx.lineTo(-9, 9);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        // Keep the original cyan engine effect.
        ctx.fillStyle = "#42d9ff"; ctx.beginPath();
        ctx.moveTo(-3, 8); ctx.lineTo(0, rand(12, 18)); ctx.lineTo(3, 8); ctx.fill();
        ctx.restore();
        // Keep the original cyan dash-ready indicator effect.
        ctx.strokeStyle = player.dashCooldown <= 0 ? "#42d9ff8a" : "#68809a50";
        ctx.lineWidth = 1; ctx.beginPath();
        ctx.arc(player.x, player.y, 17 + Math.sin(elapsed * 5) * 1.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function loop(now) {
    if (mode !== "playing") return;
    const dt = Math.min(0.033, (now - last) / 1000 || 0); last = now;
    update(dt); draw();
    if (mode === "playing") raf = requestAnimationFrame(loop);
  }

  const upgradePool = [
    { id: "speed", icon: "⚡", name: "PHASE DRIVE", desc: "Move 12% faster. Make the void chase you.", tag: "MOBILITY" },
    { id: "hull", icon: "◇", name: "REINFORCED HULL", desc: "Restore 35% hull integrity and reinforce your frame.", tag: "SURVIVAL" },
    { id: "magnet", icon: "✧", name: "SHARD MAGNET", desc: "Collect energy shards from farther away.", tag: "UTILITY" },
    { id: "dash", icon: "➤", name: "AFTERBURNER", desc: "Dash farther and recover it sooner.", tag: "MOBILITY" },
    { id: "score", icon: "✦", name: "OVERCHARGE", desc: "Earn 12% more score from every action.", tag: "SCORE" }
  ];

  function openUpgrade() {
    if (mode !== "playing") return;
    setMode("upgrade"); cancelAnimationFrame(raf);
    const choices = [...upgradePool].sort(() => Math.random() - 0.5).slice(0, 3);
    ui.options.innerHTML = "";
    choices.forEach(u => {
      const btn = document.createElement("button"); btn.className = "upgrade-option";
      btn.innerHTML = `<span class="option-icon">${u.icon}</span><strong>${u.name}</strong><p>${u.desc}</p><em>${u.tag}</em>`;
      btn.addEventListener("click", () => chooseUpgrade(u)); ui.options.appendChild(btn);
    });
    ui.modal.classList.remove("hidden"); beep(740, 0.13, "triangle", 0.035);
  }

  function chooseUpgrade(u) {
    upgrades[u.id]++;
    if (u.id === "hull") {
      player.hp = Math.min(100, player.hp + 35);
      addFloater(player.x, player.y - 20, "HULL REPAIRED", "#60f4c5");
    }
    if (u.id === "speed") player.speed += 22;
    ui.modal.classList.add("hidden"); setMode("playing"); updateHUD();
    showToast(`${u.name} PROTOCOL INSTALLED`);
    last = performance.now(); raf = requestAnimationFrame(loop);
  }

  $("startBtn").addEventListener("click", startRun);
  $("retryBtn").addEventListener("click", startRun);
  $("resumeBtn").addEventListener("click", pauseRun);
  $("quitBtn").addEventListener("click", () => {
    ui.pause.classList.add("hidden"); ui.start.classList.remove("hidden"); setMode("menu"); draw();
  });
  $("dashBtn").addEventListener("pointerdown", e => { e.preventDefault(); activateDash(); });
  $("soundBtn").addEventListener("click", () => {
    soundOn = !soundOn; $("soundLabel").textContent = soundOn ? "ON" : "OFF";
    $("soundBtn").style.opacity = soundOn ? "1" : "0.65";
    if (soundOn) beep(500, 0.06);
  });
  $("resetStatsBtn").addEventListener("click", () => {
    if (confirm("Reset all local VOID//RUSH records?")) {
      records = initialRecords(); saveRecords(); showToast("LOCAL RECORDS RESET");
    }
  });

  document.querySelectorAll("[data-dir]").forEach(btn => {
    const dir = btn.dataset.dir;
    const down = e => {
      e.preventDefault(); touchDirs.add(dir); btn.classList.add("pressed");
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const up = e => { e.preventDefault(); touchDirs.delete(dir); btn.classList.remove("pressed"); };
    btn.addEventListener("pointerdown", down); btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up); btn.addEventListener("lostpointercapture", up);
  });

  window.addEventListener("keydown", e => {
    const key = e.key;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) e.preventDefault();
    if (key === " " && !e.repeat) { activateDash(); return; }
    if (key === "p" || key === "P" || key === "Escape") {
      if (!e.repeat && ["playing", "paused"].includes(mode)) pauseRun();
      return;
    }
    keys.add(key);
    if ((key === "Enter" || key === " ") && mode === "menu") startRun();
    if (key === "Enter" && mode === "over") startRun();
  });
  window.addEventListener("keyup", e => keys.delete(e.key));
  window.addEventListener("blur", () => {
    keys.clear(); touchDirs.clear();
    document.querySelectorAll(".pad-btn").forEach(btn => btn.classList.remove("pressed"));
    if (mode === "playing") pauseRun();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "playing") pauseRun();
  });

  updateRecordUI(); resize(); resetRun(); setMode("menu"); draw();
})();
