(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const ui = {
    hud: $('hud'),
    menu: $('menu-overlay'),
    pause: $('pause-overlay'),
    result: $('result-overlay'),
    controls: $('mobile-controls'),
    footer: $('game-footer'),
    announcement: $('announcement'),
    announceKicker: $('announce-kicker'),
    announceTitle: $('announce-title'),
    announceLine: $('announce-line'),
    timer: $('timer'),
    roundNumber: $('round-number'),
    playerHealth: $('player-health'),
    cpuHealth: $('cpu-health'),
    playerHp: $('player-hp-text'),
    cpuHp: $('cpu-hp-text'),
    playerEnergy: $('player-energy'),
    cpuEnergy: $('cpu-energy'),
    playerEnergyText: $('player-energy-text'),
    cpuEnergyText: $('cpu-energy-text'),
    playerRounds: $('player-rounds'),
    cpuRounds: $('cpu-rounds'),
    trainingLabel: $('training-label'),
    portraitWarning: $('portrait-warning')
  };

  const W = 1280;
  const H = 720;
  const TAU = Math.PI * 2;

  let cw = 0, ch = 0, dpr = 1;
  let viewScale = 1, offX = 0, offY = 0;
  let last = 0, elapsed = 0;
  let mode = 'menu', training = false, muted = false;
  let audioCtx = null, shake = 0, flash = 0;
  let roundPause = 0, gameTime = 90, roundNum = 1;
  let playerWins = 0, cpuWins = 0;
  let combo = 0, comboTimer = 0;
  let announcerTimer = 0, announceHold = 0;
  let matchWinner = '';

  const held = new Set();
  const touchHeld = new Set();
  const effects = [];
  const projectiles = [];
  const particles = [];

  const keys = {
    left: ['ArrowLeft', 'a', 'A'],
    right: ['ArrowRight', 'd', 'D'],
    up: ['ArrowUp', 'w', 'W'],
    down: ['ArrowDown', 's', 'S'],
    jump: [' ', 'Space'],
    punch: ['j', 'J'],
    kick: ['k', 'K'],
    guard: ['l', 'L'],
    aura: ['i', 'I']
  };

  const camera = { x: 0, y: 0 };

  function fighter({ name, x, z, color, aura, player }) {
    return {
      name, x, z, color, aura, player,
      hp: 100, maxHp: 100,
      energy: player ? 35 : 22,
      vx: 0, vy: 0, jump: 0, groundY: 0,
      facing: player ? 1 : -1,
      attack: null, guard: false,
      stun: 0, invuln: 0, flash: 0,
      hitStop: 0, aiThink: 0, aiAction: 0,
      aiLane: 0, walk: 0, ko: false,
      roundDamage: 0, landSlam: false,
      superGlow: 0, trail: [],
      lastAction: '', specialCooldown: 0
    };
  }

  let p1 = fighter({
    name: 'VOLT', x: 390, z: 0.16,
    color: '#eaf8ff', aura: '#39d8ff', player: true
  });

  let p2 = fighter({
    name: 'SHADE', x: 890, z: -0.12,
    color: '#ffeaf5', aura: '#ff4caa', player: false
  });

  function resize() {
    const rect = canvas.getBoundingClientRect();

    cw = Math.max(1, rect.width);
    ch = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);

    viewScale = Math.min(cw / W, ch / H);
    offX = (cw - W * viewScale) / 2;
    offY = (ch - H * viewScale) / 2;
  }

  window.addEventListener('resize', resize, { passive: true });

  function seededNoise(n) {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  function playTone(freq = 180, duration = 0.08, type = 'sine', gain = 0.035) {
    if (muted) return;

    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();

      o.type = type;
      o.frequency.setValueAtTime(freq, audioCtx.currentTime);
      o.frequency.exponentialRampToValueAtTime(
        Math.max(35, freq * 0.48),
        audioCtx.currentTime + duration
      );

      g.gain.setValueAtTime(gain, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime + duration
      );

      o.connect(g);
      g.connect(audioCtx.destination);

      o.start();
      o.stop(audioCtx.currentTime + duration);
    } catch (_) {}
  }

  function announce(kicker, title, line, seconds = 1.55) {
    ui.announceKicker.textContent = kicker;
    ui.announceTitle.textContent = title;
    ui.announceLine.textContent = line;
    ui.announcement.hidden = false;
    announcerTimer = seconds;
  }

  function hideAnnouncement() {
    ui.announcement.hidden = true;
  }

  function initMatch(isTraining = false) {
    training = isTraining;
    mode = 'playing';

    document.body.classList.add('in-game');

    ui.menu.hidden = true;
    ui.pause.hidden = true;
    ui.result.hidden = true;
    ui.hud.hidden = false;
    ui.controls.hidden = false;
    ui.footer.hidden = false;
    ui.trainingLabel.hidden = !training;

    p1 = fighter({
      name: 'VOLT', x: 400, z: 0.1,
      color: '#eaf8ff', aura: '#39d8ff', player: true
    });

    p2 = fighter({
      name: 'SHADE', x: 880, z: -0.1,
      color: '#fff0f7', aura: '#ff4caa', player: false
    });

    gameTime = 90;
    roundNum = 1;
    playerWins = 0;
    cpuWins = 0;
    combo = 0;
    comboTimer = 0;

    effects.length = 0;
    projectiles.length = 0;
    particles.length = 0;

    held.clear();
    touchHeld.clear();

    roundPause = 0;
    shake = 0;
    flash = 0;
    matchWinner = '';

    last = performance.now();

    ui.playerRounds.textContent = '0';
    ui.cpuRounds.textContent = '0';

    announce(
      training ? 'TRAINING SIMULATION' : 'FIRST TO TWO ROUNDS',
      'READY?',
      'FIND YOUR RANGE. MASTER YOUR AURA.',
      1.7
    );

    playTone(440, 0.08, 'triangle', 0.02);
    requestLandscape();
  }

  function requestLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_) {}
  }

  function toMenu() {
    mode = 'menu';

    document.body.classList.remove('in-game');

    ui.menu.hidden = false;
    ui.pause.hidden = true;
    ui.result.hidden = true;
    ui.hud.hidden = true;
    ui.controls.hidden = true;
    ui.footer.hidden = true;
    ui.announcement.hidden = true;

    held.clear();
    touchHeld.clear();
  }

  function pauseGame() {
    if (mode === 'playing') {
      mode = 'paused';
      ui.pause.hidden = false;
      held.clear();
      touchHeld.clear();
    } else if (mode === 'paused') {
      mode = 'playing';
      ui.pause.hidden = true;
      last = performance.now();
    }
  }

  function endMatch(winner) {
    mode = 'result';
    matchWinner = winner;

    ui.result.hidden = false;
    ui.controls.hidden = true;
    ui.footer.hidden = true;

    ui.announceTitle.textContent =
      winner === 'player' ? 'VICTORY' : 'DEFEAT';

    $('result-title').innerHTML =
      winner === 'player'
        ? 'VICTORY<span>.</span>'
        : 'DEFEAT<span>.</span>';

    $('result-kicker').textContent =
      training ? 'TRAINING COMPLETE' : 'MATCH COMPLETE';

    $('result-copy').textContent =
      winner === 'player'
        ? 'You own this arena. Your aura speaks for itself.'
        : 'The arena has spoken. Reclaim your power and try again.';

    $('result-round-score').textContent =
      `${playerWins} — ${cpuWins}`;

    $('result-style').textContent =
      combo >= 5
        ? 'COMBO ARTIST'
        : (p1.energy >= 65 ? 'AURA MASTER' : 'WARRIOR');

    $('result-emblem').textContent =
      winner === 'player' ? '✦' : '◈';

    playTone(winner === 'player' ? 620 : 100, 0.32, 'sawtooth', 0.045);
  }

  function nextRound(winner) {
    if (winner === 'player') {
      playerWins++;
    } else {
      cpuWins++;
    }

    ui.playerRounds.textContent = playerWins;
    ui.cpuRounds.textContent = cpuWins;

    roundPause = 2.1;
    mode = 'roundbreak';

    if (!training && (playerWins >= 2 || cpuWins >= 2)) {
      setTimeout(() => {
        endMatch(playerWins >= 2 ? 'player' : 'cpu');
      }, 1700);

      announce(
        'MATCH DECIDED',
        playerWins >= 2 ? 'VICTORY' : 'DEFEAT',
        playerWins >= 2
          ? 'THE ARENA BELONGS TO YOU'
          : 'SHADE TAKES THE MATCH',
        1.55
      );

      return;
    }

    const msg = winner === 'player' ? 'ROUND WON' : 'ROUND LOST';

    announce(
      `ROUND ${String(roundNum).padStart(2, '0')}`,
      msg,
      winner === 'player'
        ? 'KEEP THE PRESSURE ON'
        : 'ADAPT. FIND THE OPENING.',
      1.8
    );

    roundNum++;

    p1.hp = 100;
    p2.hp = 100;

    p1.energy = Math.max(25, p1.energy);
    p2.energy = Math.max(20, p2.energy);

    p1.x = 400;
    p2.x = 880;

    p1.z = 0.1;
    p2.z = -0.1;

    p1.vx = p2.vx = 0;
    p1.vy = p2.vy = 0;

    p1.attack = p2.attack = null;
    p1.stun = p2.stun = 0;
    p1.ko = p2.ko = false;

    p1.roundDone = p2.roundDone = false;
    p1.fallY = p2.fallY = 0;
    p1.airY = p2.airY = 0;
    p1.yVel = p2.yVel = 0;

    gameTime = 90;

    ui.roundNumber.textContent = String(roundNum).padStart(2, '0');
  }

  function resetRoundVisual() {
    p1.x = 400;
    p2.x = 880;

    p1.hp = p2.hp = 100;
    p1.vx = p2.vx = 0;
    p1.vy = p2.vy = 0;
    p1.jump = p2.jump = 0;
    p1.stun = p2.stun = 0;
    p1.attack = p2.attack = null;
    p1.ko = p2.ko = false;
  }

  function keyDown(e) {
    const relevant = [...Object.values(keys)].flat().includes(e.key)
      || e.code === 'Space';

    if (relevant) e.preventDefault();
    if (e.repeat) return;

    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (mode === 'playing' || mode === 'paused') {
        pauseGame();
      }
      return;
    }

    if (mode !== 'playing') return;

    for (const [a, list] of Object.entries(keys)) {
      if (list.includes(e.key) || list.includes(e.code)) {
        if (['punch', 'kick', 'aura', 'jump'].includes(a)) {
          triggerAction(p1, a);
        } else if (a === 'guard') {
          held.add('guard');
        } else {
          held.add(a);
        }
      }
    }
  }

  function keyUp(e) {
    for (const [a, list] of Object.entries(keys)) {
      if (list.includes(e.key) || list.includes(e.code)) {
        held.delete(a);

        if (a === 'guard') {
          held.delete('guard');
        }
      }
    }
  }

  window.addEventListener('keydown', keyDown, { passive: false });
  window.addEventListener('keyup', keyUp);

  window.addEventListener('blur', () => {
    held.clear();
    touchHeld.clear();

    if (mode === 'playing') {
      pauseGame();
    }
  });

  function mobileMove(key, down, el) {
    if (down) {
      touchHeld.add(key);
      el?.classList.add('pressed');
    } else {
      touchHeld.delete(key);
      el?.classList.remove('pressed');
    }
  }

  document.querySelectorAll('[data-key]').forEach(btn => {
    const key = btn.dataset.key;

    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      mobileMove(key, true, btn);
    });

    const release = e => {
      e.preventDefault?.();
      mobileMove(key, false, btn);
    };

    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => {
      btn.addEventListener(ev, release);
    });
  });

  document.querySelectorAll('[data-action]').forEach(btn => {
    const action = btn.dataset.action;

    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      btn.classList.add('pressed');
      btn.setPointerCapture?.(e.pointerId);

      if (action === 'guard') {
        touchHeld.add('guard');
      } else {
        triggerAction(p1, action);
      }
    });

    const release = e => {
      e.preventDefault?.();
      btn.classList.remove('pressed');
      touchHeld.delete('guard');
    };

    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => {
      btn.addEventListener(ev, release);
    });
  });

  $('fight-button').addEventListener('click', () => initMatch(false));
  $('training-button').addEventListener('click', () => initMatch(true));
  $('pause-button').addEventListener('click', pauseGame);
  $('resume-button').addEventListener('click', pauseGame);
  $('restart-button').addEventListener('click', () => initMatch(training));
  $('menu-button').addEventListener('click', toMenu);
  $('rematch-button').addEventListener('click', () => initMatch(false));
  $('result-menu-button').addEventListener('click', toMenu);

  $('sound-button').addEventListener('click', () => {
    muted = !muted;

    $('sound-button').textContent = muted ? '♩' : '♫';
    $('sound-button').style.color =
      muted ? '#7182a6' : 'var(--blue)';

    if (!muted) {
      playTone(520, 0.06, 'sine', 0.02);
    }
  });

  function isHeld(k) {
    return held.has(k) || touchHeld.has(k);
  }

  function triggerAction(f, action) {
    if (
      mode !== 'playing' ||
      f.ko ||
      f.stun > 0.22 ||
      f.hitStop > 0
    ) {
      return;
    }

    if (action === 'jump') {
      if (f.jump < 1 && f.vy >= 0) {
        f.vy = -625;
        f.jump = 1;
        f.landSlam = false;
        playTone(255, 0.07, 'triangle', 0.015);
      }
      return;
    }

    if (action === 'guard') {
      f.guard = true;
      return;
    }

    if (f.attack && f.attack.time < f.attack.duration * 0.78) {
      return;
    }

    if (action === 'punch' || action === 'kick') {
      const duration = action === 'punch' ? 0.32 : 0.48;

      f.attack = {
        type: action,
        time: 0,
        duration,
        hit: false
      };

      f.guard = false;
      f.lastAction = action;

      playTone(
        action === 'punch' ? 260 : 145,
        0.07,
        'triangle',
        0.025
      );

      return;
    }

    if (
      action === 'aura' &&
      f.energy >= 35 &&
      f.specialCooldown <= 0
    ) {
      f.energy -= 35;

      f.attack = {
        type: 'aura',
        time: 0,
        duration: 0.6,
        hit: true
      };

      f.guard = false;
      f.specialCooldown = 1.45;

      projectiles.push({
        owner: f,
        x: f.x + f.facing * 38,
        y: baseY(f) - 95 - f.vy * 0.08,
        z: f.z,
        vx: f.facing * 630,
        life: 1.55,
        r: 27,
        hit: false,
        color: f.aura
      });

      spawnBurst(f.x + f.facing * 35, baseY(f) - 100, f.aura, 16);
      playTone(340, 0.28, 'sawtooth', 0.035);
      f.superGlow = 0.65;
    }
  }

  function baseY(f) {
    return 508 + f.z * 88;
  }

  function updateFighter(f, dt) {
    f.invuln = Math.max(0, f.invuln - dt);
    f.stun = Math.max(0, f.stun - dt);
    f.flash = Math.max(0, f.flash - dt);
    f.hitStop = Math.max(0, f.hitStop - dt);
    f.superGlow = Math.max(0, f.superGlow - dt);
    f.specialCooldown = Math.max(0, f.specialCooldown - dt);

    f.facing = f.player
      ? (Math.sign(p2.x - f.x) || 1)
      : (Math.sign(p1.x - f.x) || -1);

    if (f.attack) {
      f.attack.time += dt;

      if (f.attack.time > f.attack.duration) {
        f.attack = null;
      }
    }

    if (f.player) {
      f.guard = isHeld('guard');
    }

    if (f.stun > 0 || f.ko) {
      f.vx *= Math.pow(0.025, dt);
      f.x += f.vx * dt;
      f.energy = Math.min(100, f.energy + 1.2 * dt);
      return;
    }

    let dx = 0;
    let dz = 0;

    if (f.player) {
      dx = (isHeld('right') ? 1 : 0)
        - (isHeld('left') ? 1 : 0);

      dz = (isHeld('down') ? 1 : 0)
        - (isHeld('up') ? 1 : 0);

      if (Math.abs(dx) + Math.abs(dz) > 0) {
        f.walk += dt * 11;
        f.vx = dx * 300;
        f.z += dz * dt * 1.05;
      } else {
        f.vx *= Math.pow(0.001, dt);
        f.walk *= Math.max(0, 1 - dt * 2.4);
      }
    } else {
      const xDist = p1.x - f.x;
      const zDist = p1.z - f.z;
      const ax = Math.abs(xDist);
      const inRange = ax < 190 && Math.abs(zDist) < 0.34;

      f.aiThink -= dt;

      if (training) {
        f.guard = false;
        f.aiAction = 0;

        if (ax > 155) {
          f.vx = Math.sign(xDist) * 175;
        } else {
          f.vx *= Math.pow(0.01, dt);
        }

        if (Math.abs(zDist) > 0.12) {
          f.z += Math.sign(zDist) * dt * 0.48;
        }
      } else {
        if (f.aiAction === 'guard' && f.aiThink > 0) {
          f.guard = true;
          f.vx *= Math.pow(0.02, dt);
        } else {
          f.guard = false;

          if (ax > 138) {
            f.vx = Math.sign(xDist) * 225;
          } else {
            f.vx *= Math.pow(0.001, dt);
          }

          if (Math.abs(zDist) > 0.11) {
            f.z += Math.sign(zDist) * dt * 0.55;
          }

          if (f.aiThink <= 0) {
            if (inRange) {
              const r = Math.random();

              if (p1.attack && Math.random() < 0.34) {
                f.aiAction = 'guard';
                f.guard = true;
                f.aiThink = 0.26 + Math.random() * 0.16;
              } else if (f.energy >= 35 && ax > 150 && r < 0.2) {
                triggerAction(f, 'aura');
                f.aiAction = 0;
                f.aiThink = 0.8 + Math.random() * 0.3;
              } else {
                triggerAction(f, r < 0.54 ? 'punch' : 'kick');
                f.aiAction = 0;
                f.aiThink = 0.43 + Math.random() * 0.38;
              }
            } else {
              f.aiAction = 0;
              f.aiThink = 0.13 + Math.random() * 0.16;
            }
          }
        }
      }

      f.walk += Math.abs(f.vx) * dt * 0.035;
    }

    f.x += f.vx * dt;
    f.z = Math.max(-0.78, Math.min(0.78, f.z));
    f.x = Math.max(90, Math.min(1190, f.x));

    f.energy = Math.min(100, f.energy + (f.attack ? 0 : 3.2) * dt);
  }

  function updateBody(f, dt) {
    if (f.stun > 0) return;

    if (
      f.attack &&
      f.attack.type !== 'aura' &&
      !f.attack.hit
    ) {
      const a = f.attack;
      const t = a.time / a.duration;
      const hitAt = a.type === 'punch' ? 0.38 : 0.43;

      if (t >= hitAt) {
        a.hit = true;

        const target = f.player ? p2 : p1;
        const dx = target.x - f.x;

        const close =
          Math.abs(dx) < (a.type === 'punch' ? 154 : 178) &&
          Math.abs(target.z - f.z) < 0.33 &&
          dx * f.facing > -18;

        if (close && !target.ko) {
          dealDamage(
            f,
            target,
            a.type === 'punch' ? 8 : 12,
            a.type
          );
        }
      }
    }
  }

  function dealDamage(attacker, target, damage, type) {
    if (target.invuln > 0) return;

    const blocked = target.guard;
    const dealt = blocked
      ? Math.max(1, Math.round(damage * 0.22))
      : damage;

    target.hp = Math.max(0, target.hp - dealt);
    target.roundDamage += dealt;
    target.flash = 0.13;
    target.invuln = 0.08;

    target.vx = attacker.facing * (
      blocked ? 90 : (type === 'kick' ? 350 : 250)
    );

    target.stun = blocked
      ? 0.08
      : (type === 'kick' ? 0.28 : 0.18);

    target.hitStop = blocked ? 0.025 : 0.06;

    if (!blocked) {
      target.airY = Math.min(target.airY || 0, -38);
      target.vy = Math.min(target.vy || 0, -80);
    } else {
      spawnBurst(
        target.x,
        targetBase(target) - 75,
        '#b6d6ff',
        5
      );
    }

    attacker.energy = Math.min(
      100,
      attacker.energy + (blocked ? 3 : 10)
    );

    if (attacker.player) {
      combo++;
      comboTimer = 2.2;
    }

    shake = blocked ? 2 : 5;
    flash = blocked ? 0.025 : 0.06;

    spawnBurst(
      target.x,
      targetBase(target) - 65,
      blocked ? '#a9d3ff' : attacker.aura,
      blocked ? 6 : 11
    );

    playTone(
      blocked ? 125 : (type === 'kick' ? 105 : 190),
      blocked ? 0.055 : 0.09,
      blocked ? 'square' : 'sawtooth',
      blocked ? 0.02 : 0.04
    );

    if (target.hp <= 0 && !target.ko) {
      target.ko = true;
      target.stun = 1.5;
      target.vx = attacker.facing * 430;

      spawnBurst(
        target.x,
        targetBase(target) - 65,
        target.aura,
        30
      );
    }
  }

  function targetBase(f) {
    return baseY(f) - (f.airY || 0);
