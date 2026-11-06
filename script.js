
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const canvas = $("gameCanvas");
  const ctx = canvas.getContext("2d");

  const ui = {
    score: $("scoreHud"),
    combo: $("comboHud"),
    sector: $("sectorHud"),
    health: $("healthFill"),
    healthText: $("healthText"),
    bestSide: $("bestSide"),
    runsSide: $("runsSide"),
    energy: $("energySide"),
    kills: $("killsSide"),
    near: $("nearSide"),
    bestBottom: $("bestBottom"),
    runsBottom: $("runsBottom"),
    shardsBottom: $("shardsBottom"),
    state: $("runState"),
    status: $("statusText"),
    footer: $("footerState"),
    bars: $("threatBars"),
    missionProgress: $("missionProgress"),
    missionCount: $("missionCount"),
    missionTitle: $("missionTitle"),
    missionDesc: $("missionDesc"),
    start: $("startOverlay"),
    pause: $("pauseOverlay"),
    over: $("gameOverOverlay"),
    levelToast: $("levelToast"),
    modal: $("upgradeModal"),
    options: $("upgradeOptions"),
    toast: $("toast"),
    dashLabel: $("dashLabel"),
    dashFlash: $("dashFlash")
  };

  const STORE = "voidRushRecords_v1";

  const initialRecords = () => ({
    best: 0,
    runs: 0,
    lifetimeShards: 0
  });

  let records = initialRecords();

  try {
    records = {
      ...records,
      ...JSON.parse(localStorage.getItem(STORE) || "{}")
    };
  } catch (_) {}

  let W = 900;
  let H = 560;
  let dpr = 1;
  let last = 0;
  let raf = 0;
  let toastTimer = 0;
  let levelTimer = 0;

  let mode = "menu";
  let soundOn = true;
  let audio = null;

  let keys = new Set();
  let touchDirs = new Set();
  let entities = [];
  let particles = [];
  let floaters = [];

  let player;
  let score = 0;
  let energy = 0;
  let kills = 0;
  let nearMisses = 0;
  let combo = 1;
  let bestCombo = 1;
  let elapsed = 0;
  let sector = 1;
  let spawnTimer = 0;
  let shardTimer = 0;
  let screenShake = 0;
  let lastNear = 0;

  let upgrades = {
    speed: 0,
    hull: 0,
    magnet: 0,
    dash: 0,
    score: 0
  };

  const rand = (a, b) => Math.random() * (b - a) + a;

  const clamp = (n, a, b) =>
    Math.max(a, Math.min(b, n));

  const pad = (n, size = 6) =>
    String(Math.floor(n)).padStart(size, "0");

  const timeText = n =>
    `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  function saveRecords() {
    try {
      localStorage.setItem(STORE, JSON.stringify(records));
    } catch (_) {}

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

    ui.state.innerHTML =
      `<span class="live-dot"></span> ${labels[next][0]}`;

    ui.status.textContent =
      next === "playing" ? "SIGNAL STABLE" :
      next === "over" ? "SIGNAL LOST" :
      next === "paused" ? "SYSTEM PAUSED" :
      "SYSTEM ONLINE";

    ui.footer.textContent = labels[next][1];
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      ui.toast.classList.remove("show");
    }, 1900);
  }

  function beep(freq = 440, duration = 0.07, type = "sine", volume = 0.035) {
    if (!soundOn) return;

    try {
      audio ||= new (
        window.AudioContext || window.webkitAudioContext
      )();

      if (audio.state === "suspended") audio.resume();

      const osc = audio.createOscillator();
      const gain = audio.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, audio.currentTime);

      gain.gain.setValueAtTime(volume, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.currentTime + duration
      );

      osc.connect(gain);
      gain.connect(audio.destination);

      osc.start();
      osc.stop(audio.currentTime + duration);
    } catch (_) {}
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (player) {
      player.x = clamp(player.x, 22, W - 22);
      player.y = clamp(player.y, 22, H - 22);
    }

    draw();
  }

  window.addEventListener("resize", resize);

  function resetRun() {
    entities = [];
    particles = [];
    floaters = [];
    keys.clear();
    touchDirs.clear();

    score = 0;
    energy = 0;
    kills = 0;
    nearMisses = 0;
    combo = 1;
    bestCombo = 1;
    elapsed = 0;
    sector = 1;

    spawnTimer = 0.8;
    shardTimer = 1.3;
    screenShake = 0;
    lastNear = 0;

    upgrades = {
      speed: 0,
      hull: 0,
      magnet: 0,
      dash: 0,
      score: 0
    };

    player = {
      x: W / 2,
      y: H / 2,
      r: 10,
      vx: 0,
      vy: 0,
      hp: 100,
      maxHp: 100,
      speed: 220,
      dashCooldown: 0,
      dashTime: 0,
      invuln: 1.2,
      trail: []
    };

    updateHUD();
    updateMission();
    draw();
  }

  function startRun() {
    if (mode === "playing") return;

    cancelAnimationFrame(raf);
    resetRun();

    ui.start.classList.add("hidden");
    ui.pause.classList.add("hidden");
    ui.over.classList.add("hidden");
    ui.modal.classList.add("hidden");

    setMode("playing");
    beep(580, 0.1, "triangle");

    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function pauseRun() {
    if (mode === "playing") {
      setMode("paused");
      ui.pause.classList.remove("hidden");
      keys.clear();
      touchDirs.clear();
      beep(260, 0.08);
    } else if (mode === "paused") {
      ui.pause.classList.add("hidden");
      setMode("playing");
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

  function endRun() {
    if (mode !== "playing") return;

    setMode("over");
    ui.over.classList.remove("hidden");

    records.runs++;

    const newBest = score > records.best;

    if (newBest) records.best = score;

    records.lifetimeShards += energy;
    saveRecords();

    $("finalScore").textContent = pad(score);
    $("finalCombo").textContent = `x${bestCombo.toFixed(1)}`;
    $("finalTime").textContent = timeText(elapsed);
    $("newBest").classList.toggle("hidden", !newBest);

    if (newBest) {
      beep(880, 0.3, "triangle", 0.05);
    } else {
      beep(160, 0.25, "sawtooth", 0.035);
    }

    keys.clear();
    touchDirs.clear();
    draw();
  }

  function spawnEnemy() {
    const edge = Math.floor(rand(0, 4));
    let x, y;

    if (edge === 0) {
      x = rand(0, W);
      y = -20;
    } else if (edge === 1) {
      x = W + 20;
      y = rand(0, H);
    } else if (edge === 2) {
      x = rand(0, W);
      y = H + 20;
    } else {
      x = -20;
      y = rand(0, H);
    }

    const roll = Math.random();

    const type =
      roll < 0.58 ? "seeker" :
      roll < 0.82 ? "drifter" :
      "hunter";

    const speed =
      (type === "hunter" ? rand(105, 145) :
       type === "drifter" ? rand(60, 95) :
       rand(75, 115)) *
      (1 + Math.min(sector - 1, 10) * 0.065);

    entities.push({
      kind: "enemy",
      type,
      x,
      y,
      r: type === "hunter" ? 12 :
         type === "drifter" ? 8 : 10,
      vx: 0,
      vy: 0,
      speed,
      age: 0,
      phase: rand(0, 7),
      color: type === "hunter" ? "#ff557a" :
             type === "drifter" ? "#c27aff" :
             "#ff8c6b",
      near: false
    });
  }

  function spawnShard(x = rand(25, W - 25), y = rand(25, H - 25), value = 1) {
    entities.push({
      kind: "shard",
      x,
      y,
      r: 6,
      value,
      phase: rand(0, 7),
      life: 0
    });
  }

  function burst(x, y, color, count = 10, power = 120) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(power * 0.25, power);

      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.2, 0.65),
        max: 0.65,
        r: rand(1, 3),
        color
      });
    }
  }

  function addFloater(x, y, text, color) {
    floaters.push({
      x,
      y,
      text,
      color,
      life: 0.8,
      max: 0.8
    });
  }

  function activateDash() {
    if (mode !== "playing" || !player || player.dashCooldown > 0) return;

    let dx =
      (keys.has("ArrowRight") || keys.has("d") || keys.has("D") || touchDirs.has("right") ? 1 : 0) -
      (keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || touchDirs.has("left") ? 1 : 0);

    let dy =
      (keys.has("ArrowDown") || keys.has("s") || keys.has("S") || touchDirs.has("down") ? 1 : 0) -
      (keys.has("ArrowUp") || keys.has("w") || keys.has("W") || touchDirs.has("up") ? 1 : 0);

    if (!dx && !dy) {
      dx = player.vx;
      dy = player.vy;

      if (Math.hypot(dx, dy) < 1) {
        dx = 1;
        dy = 0;
      }
    }

    const m = Math.hypot(dx, dy) || 1;
    dx /= m;
    dy /= m;

    player.vx = dx * (560 + upgrades.dash * 45);
    player.vy = dy * (560 + upgrades.dash * 45);
    player.dashTime = 0.19;
    player.dashCooldown = Math.max(0.75, 1.65 - upgrades.dash * 0.18);
    player.invuln = 0.25;

    burst(player.x, player.y, "#42d9ff", 14, 170);

    ui.dashFlash.classList.remove("flash");
    void ui.dashFlash.offsetWidth;
    ui.dashFlash.classList.add("flash");

    beep(260, 0.12, "sawtooth", 0.025);
  }

  function takeDamage(amount = 24) {
    if (player.invuln > 0 || mode !== "playing") return;

    player.hp = Math.max(0, player.hp - amount);
    player.invuln = 0.85;
    screenShake = 9;
    combo = 1;

    burst(player.x, player.y, "#ff557a", 15, 180);
    beep(100, 0.18, "sawtooth", 0.05);
    updateHUD();

    if (player.hp <= 0) endRun();
  }

  function collectShard(e) {
    energy++;

    score += Math.round(80 * combo * (1 + upgrades.score * 0.12));

    combo = Math.min(9.9, combo + 0.25);
    bestCombo = Math.max(bestCombo, combo);

    burst(e.x, e.y, "#42d9ff", 9, 100);
    addFloater(e.x, e.y - 8, `+${Math.round(80 * combo)}`, "#42d9ff");

    beep(520 + energy % 5 * 70, 0.055, "sine", 0.025);

    if (energy % 8 === 0 && player.hp < 100) {
      player.hp = Math.min(100, player.hp + 5);
      addFloater(player.x, player.y - 18, "HULL +5", "#60f4c5");
    }

    if (energy > 0 && energy % 10 === 0) {
      openUpgrade();
    }

    updateHUD();
  }

  function update(dt) {
    elapsed += dt;

    const newSector = 1 + Math.floor(elapsed / 22);

    if (newSector > sector) {
      sector = newSector;
      showLevelToast();
    }

    let ix =
      (keys.has("ArrowRight") || keys.has("d") || keys.has("D") || touchDirs.has("right") ? 1 : 0) -
      (keys.has("ArrowLeft") || keys.has("a") || keys.has("A") || touchDirs.has("left") ? 1 : 0);

    let iy =
      (keys.has("ArrowDown") || keys.has("s") || keys.has("S") || touchDirs.has("down") ? 1 : 0) -
      (keys.has("ArrowUp") || keys.has("w") || keys.has("W") || touchDirs.has("up") ? 1 : 0);

    const mag = Math.hypot(ix, iy);

    if (mag > 0) {
      ix /= mag;
      iy /= mag;
    }

    const targetSpeed = player.speed + upgrades.speed * 22;

    if (player.dashTime > 0) {
      player.dashTime -= dt;
      player.x += player.vx * dt;
      player.y += player.vy * dt;

      player.vx *= Math.pow(0.05, dt);
      player.vy *= Math.pow(0.05, dt);
    } else {
      const smooth = 1 - Math.pow(0.001, dt);

      player.vx += (ix * targetSpeed - player.vx) * smooth;
      player.vy += (iy * targetSpeed - player.vy) * smooth;

      player.x += player.vx * dt;
      player.y += player.vy * dt;
    }

    player.x = clamp(player.x, 14, W - 14);
    player.y = clamp(player.y, 14, H - 14);

    player.invuln = Math.max(0, player.invuln - dt);
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);

    player.trail.push({
      x: player.x,
      y: player.y,
      life: 0.3
    });

    if (player.trail.length > 12) player.trail.shift();

    player.trail.forEach(t => t.life -= dt);
    player.trail = player.trail.filter(t => t.life > 0);

    spawnTimer -= dt;

    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = Math.max(0.28, 1.18 - elapsed * 0.009) * rand(0.7, 1.25);
    }

    shardTimer -= dt;

    if (shardTimer <= 0) {
      spawnShard();
      shardTimer = rand(1.3, 2.4);
    }

    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];

      e.age = (e.age || 0) + dt;

      if (e.kind === "enemy") {
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const d = Math.hypot(dx, dy) || 1;

        if (e.type === "drifter") {
          e.x += Math.cos(e.age * 2 + e.phase) * 22 * dt + dx / d * e.speed * 0.45 * dt;
          e.y += Math.sin(e.age * 2 + e.phase) * 22 * dt + dy / d * e.speed * 0.45 * dt;
        } else if (e.type === "hunter") {
          e.x += dx / d * e.speed * dt;
          e.y += dy / d * e.speed * dt;
        } else {
          e.vx += (dx / d * e.speed - e.vx) * Math.min(1, dt * 1.7);
          e.vy += (dy / d * e.speed - e.vy) * Math.min(1, dt * 1.7);

          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }

        const gap = Math.hypot(player.x - e.x, player.y - e.y);

        if (gap < e.r + player.r + 1) {
          if (player.dashTime <= 0) {
            takeDamage(e.type === "hunter" ? 30 : 22);
          }

          burst(e.x, e.y, e.color, 8, 90);
          entities.splice(i, 1);
          kills++;
          score += 35;
          continue;
        }

        if (
          !e.near &&
          gap < e.r + player.r + 18 &&
          gap > e.r + player.r + 1 &&
          elapsed - lastNear > 0.12
        ) {
          e.near = true;
          lastNear = elapsed;
          nearMisses++;
          combo = Math.min(9.9, combo + 0.15);
          score += Math.round(35 * combo);

          addFloater(player.x, player.y - 22, "NEAR MISS", "#c27aff");
        }

        if (e.x < -55 || e.x > W + 55 || e.y < -55 || e.y > H + 55) {
          entities.splice(i, 1);
        }
      } else {
        e.phase += dt * 3;

        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const d = Math.hypot(dx, dy) || 1;

        if (d < 115 + upgrades.magnet * 35) {
          e.x += dx / d * (90 + upgrades.magnet * 40) * dt;
          e.y += dy / d * (90 + upgrades.magnet * 40) * dt;
        }

        if (d < e.r + player.r + 3) {
          collectShard(e);
          entities.splice(i, 1);
        } else if (e.age > 13) {
          entities.splice(i, 1);
        }
      }

      if (mode !== "playing") return;
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.18, dt);
      p.vy *= Math.pow(0.18, dt);
      p.life -= dt;

      if (p.life <= 0) particles.splice(i, 1);
    }

    for (let i = floaters.length - 1; i >= 0; i--) {
      floaters[i].y -= 30 * dt;
      floaters[i].life -= dt;

      if (floaters[i].life <= 0) floaters.splice(i, 1);
    }

    screenShake = Math.max(0, screenShake - dt * 24);

    score += dt * (5 + sector * 1.8) * (1 + upgrades.score * 0.12);

    updateHUD();
    updateMission();
  }

  function showLevelToast() {
    ui.levelToast.innerHTML = `SECTOR ${pad(sector, 2)} <b>+1</b>`;
    ui.levelToast.classList.remove("hidden");

    clearTimeout(levelTimer);

    levelTimer = setTimeout(() => {
      ui.levelToast.classList.add("hidden");
    }, 1400);

    addFloater(W / 2, H / 2, `SECTOR ${pad(sector, 2)}`, "#42d9ff");
    beep(680, 0.15, "triangle", 0.03);
  }

  function updateHUD() {
    ui.score.textContent = pad(score);
    ui.combo.textContent = `x${combo.toFixed(1)}`;
    ui.sector.textContent = pad(sector, 2);

    ui.health.style.width = `${player ? player.hp : 100}%`;
    ui.healthText.textContent = `${Math.round(player ? player.hp : 100)}%`;

    ui.energy.textContent = pad(energy, 2);
    ui.kills.textContent = pad(kills, 2);
    ui.near.textContent = pad(nearMisses, 2);

    const bars = ui.bars.children;

    for (let i = 0; i < bars.length; i++) {
      bars[i].classList.toggle(
        "active",
        i < Math.min(5, Math.ceil(sector / 2))
      );
    }

    ui.dashLabel.textContent =
      !player || player.dashCooldown <= 0
        ? "READY"
        : `${player.dashCooldown.toFixed(1)}s`;

    $("dashBtn").style.opacity =
      !player || player.dashCooldown <= 0 ? "1" : "0.65";
  }

  function updateMission() {
    const progress = Math.min(100, elapsed / 30 * 100);

    ui.missionProgress.style.width = `${progress}%`;
    ui.missionCount.textContent =
      `${Math.min(30, Math.floor(elapsed))} / 30 seconds`;

    if (elapsed >= 30) {
      ui.missionTitle.textContent = "STAY ALIVE";
      ui.missionDesc.textContent =
        "The void grows more aggressive with every sector.";
    } else {
      ui.missionTitle.textContent = "SURVIVE";
      ui.missionDesc.textContent =
        "Outlast the collapse. Collect energy. Don't get caught.";
    }
  }

  function drawBackground() {
    ctx.fillStyle = "#070d1b";
    ctx.fillRect(0, 0, W, H);

    const grad = ctx.createRadialGradient(
      W * 0.5, H * 0.5, 0,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.7
    );

    grad.addColorStop(0, "#101d35");
    grad.addColorStop(1, "#050914");

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const step = 32;
    const off = (elapsed * 8) % step;

    ctx.strokeStyle = "#3a5b8020";
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = -step; x < W + step; x += step) {
      ctx.moveTo(x + off, 0);
      ctx.lineTo(x + off, H);
    }

    for (let y = -step; y < H + step; y += step) {
      ctx.moveTo(0, y + off);
      ctx.lineTo(W, y + off);
    }

    ctx.stroke();

    for (let i = 0; i < 55; i++) {
      const x = (i * 137.7 + Math.sin(i * 3.1) * 40) % W;
      const y = (i * 83.3 + elapsed * (4 + i % 3)) % H;

      ctx.fillStyle = i % 5 === 0 ? "#74dfff77" : "#9bb9e033";
      ctx.fillRect(x, y, 1.3, 1.3);
    }

    const pulse = 1 + Math.sin(elapsed * 1.5) * 0.025;

    ctx.strokeStyle = `rgba(66,217,255,${0.08 + Math.sin(elapsed) * 0.025})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * 0.29 * pulse, H * 0.33 * pulse, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function draw() {
    if (!ctx) return;

    ctx.save();

    if (screenShake > 0 && mode === "playing") {
      ctx.translate(rand(-screenShake, screenShake), rand(-screenShake, screenShake));
    }

    drawBackground();

    entities.forEach(e => {
      if (e.kind === "shard") {
        const pulse = 1 + Math.sin(e.phase) * 0.2;

        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.phase * 0.3);
        ctx.shadowBlur = 17;
        ctx.shadowColor = "#42d9ff";
        ctx.strokeStyle = "#42d9ff";
        ctx.fillStyle = "#42d9ff22";
        ctx.lineWidth = 1.4;

        ctx.beginPath();
        ctx.moveTo(0, -e.r * pulse);
        ctx.lineTo(e.r * pulse, 0);
        ctx.lineTo(0, e.r * pulse);
        ctx.lineTo(-e.r * pulse, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(player ? player.y - e.y : 0, player ? player.x - e.x : 1));
        ctx.shadowBlur = 14;
        ctx.shadowColor = e.color;
        ctx.strokeStyle = e.color;
        ctx.fillStyle = e.color + "18";
        ctx.lineWidth = 1.5;

        if (e.type === "drifter") {
          ctx.beginPath();

          for (let j = 0; j < 6; j++) {
            const a = j * Math.PI / 3;
            const x = Math.cos(a) * e.r;
            const y = Math.sin(a) * e.r;

            if (j) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }

          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(e.r + 3, 0);
          ctx.lineTo(-e.r * 0.7, -e.r * 0.8);
          ctx.lineTo(-e.r * 0.45, 0);
          ctx.lineTo(-e.r * 0.7, e.r * 0.8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      }
    });

    particles.forEach(p => {
      ctx.globalAlpha = clamp(p.life / (p.max || 0.65), 0, 1);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 7;
      ctx.shadowColor = p.color;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    floaters.forEach(f => {
      ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
      ctx.font = "10px 'DM Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = f.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = f.color;
      ctx.fillText(f.text, f.x, f.y);
    });

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (player) {
      player.trail.forEach(t => {
        ctx.globalAlpha = (t.life / 0.3) * 0.23;
        ctx.fillStyle = "#42d9ff";
        ctx.beginPath();
        ctx.arc(t.x, t.y, player.r * (t.life / 0.3), 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalAlpha = 1;

      const flicker =
        player.invuln > 0 && Math.floor(elapsed * 16) % 2 === 0;

      if (!flicker) {
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(Math.atan2(player.vy, player.vx) + Math.PI / 2);
        ctx.shadowBlur = 22;
        ctx.shadowColor = "#42d9ff";
        ctx.fillStyle = "#dffaff";
        ctx.strokeStyle = "#42d9ff";
        ctx.lineWidth = 1.7;

        ctx.beginPath();
        ctx.moveTo(0, -13);
        ctx.lineTo(9, 9);
        ctx.lineTo(0, 5);
        ctx.lineTo(-9, 9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#42d9ff";
        ctx.beginPath();
        ctx.moveTo(-3, 8);
        ctx.lineTo(0, rand(12, 18));
        ctx.lineTo(3, 8);
        ctx.fill();

        ctx.restore();

        ctx.strokeStyle =
          player.dashCooldown <= 0 ? "#42d9ff8a" : "#68809a50";

        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(player.x, player.y, 17 + Math.sin(elapsed * 5) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function loop(now) {
    if (mode !== "playing") return;

    const dt = Math.min(0.033, (now - last) / 1000 || 0);
    last = now;

    update(dt);
    draw();

    if (mode === "playing") {
      raf = requestAnimationFrame(loop);
    }
  }

  const upgradePool = [
    {
      id: "speed",
      icon: "⚡",
      name: "PHASE DRIVE",
      desc: "Move 12% faster. Make the void chase you.",
      tag: "MOBILITY"
    },
    {
      id: "hull",
      icon: "◇",
      name: "REINFORCED HULL",
      desc: "Restore 35% hull integrity and reinforce your frame.",
      tag: "SURVIVAL"
    },
    {
      id: "magnet",
      icon: "✧",
      name: "SHARD MAGNET",
      desc: "Collect energy shards from farther away.",
      tag: "UTILITY"
    },
    {
      id: "dash",
      icon: "➤",
      name: "AFTERBURNER",
      desc: "Dash farther and recover it sooner.",
      tag: "MOBILITY"
    },
    {
      id: "score",
      icon: "✦",
      name: "OVERCHARGE",
      desc: "Earn 12% more score from every action.",
      tag: "SCORE"
    }
  ];

  function openUpgrade() {
    if (mode !== "playing") return;

    setMode("upgrade");
    cancelAnimationFrame(raf);

    const choices = [...upgradePool]
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    ui.options.innerHTML = "";

    choices.forEach(u => {
      const btn = document.createElement("button");
      btn.className = "upgrade-option";

      btn.innerHTML = `
        <span class="option-icon">${u.icon}</span>
        <strong>${u.name}</strong>
        <p>${u.desc}</p>
        <em>${u.tag}</em>
      `;

      btn.addEventListener("click", () => chooseUpgrade(u));
      ui.options.appendChild(btn);
    });

    ui.modal.classList.remove("hidden");
    beep(740, 0.13, "triangle", 0.035);
  }

  function chooseUpgrade(u) {
    upgrades[u.id]++;

    if (u.id === "hull") {
      player.hp = Math.min(100, player.hp + 35);
      addFloater(player.x, player.y - 20, "HULL REPAIRED", "#60f4c5");
    }

    if (u.id === "speed") {
      player.speed += 22;
    }

    ui.modal.classList.add("hidden");
    setMode("playing");
    updateHUD();

    showToast(`${u.name} PROTOCOL INSTALLED`);

    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  $("startBtn").addEventListener("click", startRun);
  $("retryBtn").addEventListener("click", startRun);
  $("resumeBtn").addEventListener("click", pauseRun);

  $("quitBtn").addEventListener("click", () => {
    ui.pause.classList.add("hidden");
    ui.start.classList.remove("hidden");
    setMode("menu");
    draw();
  });

  $("dashBtn").addEventListener("pointerdown", e => {
    e.preventDefault();
    activateDash();
  });

  $("soundBtn").addEventListener("click", () => {
    soundOn = !soundOn;
    $("soundLabel").textContent = soundOn ? "ON" : "OFF";
    $("soundBtn").style.opacity = soundOn ? "1" : "0.65";

    if (soundOn) beep(500, 0.06);
  });

  $("resetStatsBtn").addEventListener("click", () => {
    if (confirm("Reset all local VOID//RUSH records?")) {
      records = initialRecords();
      saveRecords();
      showToast("LOCAL RECORDS RESET");
    }
  });

  document.querySelectorAll("[data-dir]").forEach(btn => {
    const dir = btn.dataset.dir;

    const down = e => {
      e.preventDefault();
      touchDirs.add(dir);
      btn.classList.add("pressed");

      try {
        btn.setPointerCapture(e.pointerId);
      } catch (_) {}
    };

    const up = e => {
      e.preventDefault();
      touchDirs.delete(dir);
      btn.classList.remove("pressed");
    };

    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("lostpointercapture", up);
  });

  window.addEventListener("keydown", e => {
    const key = e.key;

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) {
      e.preventDefault();
    }

    if (key === " " && !e.repeat) {
      activateDash();
      return;
    }

    if (key === "p" || key === "P" || key === "Escape") {
      if (!e.repeat && ["playing", "paused"].includes(mode)) {
        pauseRun();
      }
      return;
    }

    keys.add(key);

    if ((key === "Enter" || key === " ") && mode === "menu") {
      startRun();
    }

    if (key === "Enter" && mode === "over") {
      startRun();
    }
  });

  window.addEventListener("keyup", e => {
    keys.delete(e.key);
  });

  window.addEventListener("blur", () => {
    keys.clear();
    touchDirs.clear();

    document.querySelectorAll(".pad-btn").forEach(btn => {
      btn.classList.remove("pressed");
    });

    if (mode === "playing") pauseRun();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && mode === "playing") {
      pauseRun();
    }
  });

  updateRecordUI();
  resize();
  resetRun();
  setMode("menu");
  draw();
})();
