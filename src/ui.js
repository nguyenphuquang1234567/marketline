import css from './ui.css?inline';

const KEYS = {
  forward: ['Move forward', 'KeyW'], back: ['Move back', 'KeyS'],
  left: ['Strafe left', 'KeyA'], right: ['Strafe right', 'KeyD'],
  sprint: ['Sprint', 'ShiftLeft'], crouch: ['Crouch', 'ControlLeft'],
  jump: ['Jump / mantle', 'Space'], reload: ['Reload', 'KeyR'],
  inspect: ['Inspect', 'KeyI'], mode: ['Fire mode', 'KeyB'],
  tactical: ['Smoke', 'KeyQ'], grenade: ['Frag', 'KeyG'],
};

const defaults = {
  sensitivity: 1, fov: 78, ads: 0.58, invert: false, volume: 0.65,
  quality: 'High', difficulty: 'Regular', blur: 'Low', shake: true,
  vignette: true, chromatic: false, dynamic: true,
};

export function loadSettings(touch = false) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('marketline.settings')) || {}; } catch { /* storage unavailable */ }
  return {
    ...defaults, quality: touch ? 'Low' : defaults.quality, ...saved,
    keys: Object.fromEntries(Object.entries(KEYS).map(([key, [, code]]) => [key, saved.keys?.[key] || code])),
  };
}

const shortKey = code => code.replace(/^(Key|Digit)/, '').replace(/Left$/, '').replace(/Right$/, '');
const html = `
<div id="hud" hidden>
  <div id="team-markers" class="team-markers"></div>
  <div class="map-stack"><div class="map-frame"><canvas id="minimap" width="160" height="160"></canvas><span>N</span></div><p id="zone">AL MARFA</p></div>
  <div class="match-hud">
    <div class="compass" id="compass"><span>NW</span><b>N</b><span>NE</span></div>
    <div class="score"><strong id="blue-score">00</strong><div><b id="timer">10:00</b><small>TEAM DEATHMATCH</small></div><strong id="red-score">00</strong></div>
  </div>
  <div id="feed" class="feed"></div>
  <div id="crosshair" class="crosshair"><i></i><i></i><i></i><i></i></div>
  <div id="hitmarker" class="hitmarker"><i></i><i></i><i></i><i></i></div>
  <div id="damage" class="damage"><i></i></div>
  <div id="kill-banner" class="kill-banner"><span id="hit-label"></span><strong>ENEMY ELIMINATED</strong><b id="xp">+100 XP</b></div>
  <div id="status" class="status"></div>
  <div class="health-hud"><div><span>✚ HEALTH</span><strong id="health">100</strong></div><i id="health-meter"></i></div>
  <div class="ammo-hud">
    <div class="loadout"><span id="weapon-mode">AUTO</span><span>MR-4 CARBINE</span></div>
    <div class="rounds"><strong id="ammo">30</strong><span>/</span><b id="reserve">120</b></div>
    <div class="ammo-track"><i id="ammo-meter"></i></div>
    <div class="equipment"><span id="smoke-slot"><kbd id="smoke-key">Q</kbd> SMOKE <b id="smoke-count">1</b></span><span id="frag-slot"><kbd id="frag-key">G</kbd> FRAG <b id="frag-count">1</b></span></div>
  </div>
  <div class="telemetry" id="telemetry" hidden></div>
</div>
<div id="touch-controls" hidden aria-label="Touch controls">
  <div class="touch-stick" hidden aria-hidden="true"><i></i></div>
  <div class="touch-movement">
    <button type="button" data-touch="sprint" aria-pressed="false">Sprint</button>
    <button type="button" data-touch="crouch" aria-pressed="false">Crouch</button>
  </div>
  <div class="touch-combat">
    <button type="button" data-touch="tactical">Smoke</button>
    <button type="button" data-touch="grenade">Frag</button>
    <button type="button" data-touch="reload">Reload</button>
    <button type="button" data-touch="jump">Jump</button>
    <button type="button" data-touch="ads" aria-pressed="false">Aim</button>
    <button type="button" data-touch="fire">Fire</button>
  </div>
  <button type="button" data-touch="pause" aria-label="Pause">Ⅱ</button>
</div>
<div class="overlay" id="menu">
  <div class="corner-mark" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="cover-meta"><i></i> OFFLINE <span></span> 4 VS 4</div>
  <main class="menu-content">
    <div class="eyebrow"><i></i><span id="eyebrow">AL MARFA / TEAM DEATHMATCH</span></div>
    <h1 id="menu-title">MARKETLINE</h1>
    <p id="menu-detail">Two teams. First to 30 eliminations.</p>
    <div class="menu-actions">
      <button id="deploy" class="primary" disabled><span id="deploy-label">Preparing district</span><span aria-hidden="true">↗</span></button>
      <button id="settings" class="secondary" hidden>Settings <span aria-hidden="true">＋</span></button>
      <button id="restart" class="secondary" hidden>Restart match <span aria-hidden="true">↻</span></button>
    </div>
  </main>
  <div class="menu-footer"><span><b>WASD</b> MOVE</span><span><b>MOUSE</b> AIM</span><span><b>RMB</b> ADS</span><span><b>ESC</b> PAUSE</span></div>
  <div class="menu-footer touch-help"><span><b>DRAG LEFT</b> MOVE</span><span><b>DRAG RIGHT</b> AIM</span></div>
  <div class="district"><i></i><span>MAP</span><b>AL MARFA</b></div>
  <aside class="settings-panel" id="settings-panel" hidden aria-label="Settings">
    <div class="settings-heading"><h2>SETTINGS</h2><button id="close-settings" class="secondary" aria-label="Close settings">×</button></div>
    <div id="settings-fields"></div>
  </aside>
</div>`;

export class Interface {
  constructor(settings, actions) {
    this.settings = settings;
    this.actions = actions;
    this.last = {};
    this.feed = [];
    this.tags = new Map();
    this.hitUntil = this.killUntil = this.damageUntil = 0;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const root = document.querySelector('#interface');
    root.innerHTML = html;
    this.el = Object.fromEntries([...root.querySelectorAll('[id]')].map(node => [node.id, node]));
    this.map = this.el.minimap.getContext('2d');
    this.footprint = document.createElement('canvas');
    this.footprint.width = this.footprint.height = 160;
    this.el.deploy.onclick = () => actions.deploy();
    this.el.restart.onclick = () => actions.restart();
    this.el.settings.onclick = () => this.toggleSettings(true);
    this.el['close-settings'].onclick = () => this.toggleSettings(false);
    root.addEventListener('pointerover', e => { if (e.target.closest('button')) actions.hover?.(); });
    this.createSettings();
  }

  set(id, value) {
    if (this.last[id] === value) return;
    this.last[id] = value;
    this.el[id].textContent = value;
  }

  phase(phase, detail) {
    const e = this.el;
    e.menu.dataset.phase = phase;
    e.menu.hidden = phase === 'play' || phase === 'dead';
    e.hud.hidden = phase !== 'play' && phase !== 'dead';
    e.deploy.disabled = phase === 'loading' || phase === 'error';
    e.settings.hidden = e.deploy.disabled;
    e.restart.hidden = phase !== 'pause';
    this.toggleSettings(false);
    this.set('eyebrow', phase === 'end' ? 'AL MARFA / AFTER ACTION' : 'AL MARFA / TEAM DEATHMATCH');
    this.set('menu-title', phase === 'pause' ? 'MATCH PAUSED' : phase === 'end' ? detail.title : 'MARKETLINE');
    this.set('menu-detail', phase === 'error' ? detail : phase === 'end' ? detail.detail : phase === 'pause'
      ? 'Resume the match or adjust your setup.' : 'Two teams. First to 30 eliminations.');
    this.set('deploy-label', {
      loading: 'Preparing district', ready: 'Deploy', pause: 'Resume match', end: 'Play again', error: 'Unable to start',
    }[phase] || 'Deploy');
  }

  progress(text) { this.set('deploy-label', text); }

  toggleSettings(show) {
    this.el['settings-panel'].hidden = !show;
    this.el.menu.classList.toggle('has-settings', show);
    if (!show) this.bindKey = null;
    else this.el['close-settings'].focus();
  }

  save() {
    try { localStorage.setItem('marketline.settings', JSON.stringify(this.settings)); } catch { /* ephemeral settings */ }
    this.actions.changed();
    this.set('smoke-key', shortKey(this.settings.keys.tactical));
    this.set('frag-key', shortKey(this.settings.keys.grenade));
  }

  createSettings() {
    const parent = this.el['settings-fields'];
    const addGroup = title => {
      const group = document.createElement('section');
      const heading = document.createElement('h3');
      heading.textContent = title;
      group.append(heading);
      parent.append(group);
      return group;
    };
    const add = (group, title, field, options) => {
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = title;
      label.append(text);
      const input = document.createElement(Array.isArray(options) ? 'select' : 'input');
      if (Array.isArray(options)) {
        for (const name of options) input.add(new Option(name, name));
        input.value = this.settings[field];
      } else if (options) {
        Object.assign(input, { type: 'range', ...options, value: this.settings[field] });
        const value = document.createElement('output');
        value.textContent = this.settings[field];
        input.addEventListener('input', () => { value.textContent = input.value; });
        label.append(value);
      } else {
        Object.assign(input, { type: 'checkbox', checked: this.settings[field] });
      }
      input.oninput = () => {
        this.settings[field] = input.type === 'checkbox' ? input.checked
          : input.type === 'range' ? Number(input.value) : input.value;
        this.save();
      };
      label.append(input);
      group.append(label);
    };
    const controls = addGroup('AIM');
    add(controls, document.documentElement.classList.contains('touch-mode') ? 'Swipe sensitivity' : 'Mouse sensitivity', 'sensitivity', { min: .15, max: 3, step: .05 });
    add(controls, 'ADS sensitivity', 'ads', { min: .2, max: 1, step: .02 });
    add(controls, 'Vertical field of view', 'fov', { min: 58, max: 100, step: 1 });
    add(controls, 'Invert Y', 'invert');
    const display = addGroup('DISPLAY');
    add(display, 'Graphics', 'quality', ['Low', 'Medium', 'High', 'Ultra']);
    add(display, 'Dynamic resolution', 'dynamic');
    add(display, 'Motion blur', 'blur', ['Off', 'Low', 'High']);
    add(display, 'Camera shake', 'shake');
    add(display, 'Vignette', 'vignette');
    add(display, 'Chromatic separation', 'chromatic');
    const fullscreen = document.createElement('button');
    fullscreen.className = 'secondary full';
    fullscreen.textContent = 'Toggle fullscreen';
    fullscreen.onclick = () => this.actions.fullscreen();
    display.append(fullscreen);
    const play = addGroup('MATCH & AUDIO');
    add(play, 'Bot difficulty', 'difficulty', ['Recruit', 'Regular', 'Veteran']);
    add(play, 'Master volume', 'volume', { min: 0, max: 1, step: .05 });
    const binds = addGroup('KEYBINDS');
    for (const [field, [name]] of Object.entries(KEYS)) {
      const row = document.createElement('div');
      row.className = 'binding';
      const title = document.createElement('span');
      title.textContent = name;
      const button = document.createElement('button');
      button.className = 'keybind';
      button.textContent = shortKey(this.settings.keys[field]);
      button.onclick = () => {
        if (this.bindKey) this.bindKey.button.textContent = shortKey(this.settings.keys[this.bindKey.field]);
        this.bindKey = { field, button };
        button.textContent = 'Press a key';
      };
      row.append(title, button);
      binds.append(row);
    }
    this.set('smoke-key', shortKey(this.settings.keys.tactical));
    this.set('frag-key', shortKey(this.settings.keys.grenade));
  }

  tryBind(code) {
    if (!this.bindKey) return false;
    const { field, button } = this.bindKey;
    if (!['Escape', 'Tab', 'Backquote', 'F11'].includes(code)) {
      this.settings.keys[field] = code;
      this.save();
    }
    button.textContent = shortKey(this.settings.keys[field]);
    this.bindKey = null;
    return true;
  }

  buildMap(world) {
    const ctx = this.footprint.getContext('2d');
    this.mapBounds = world.bounds;
    const { minX, maxX, minZ, maxZ } = world.bounds;
    this.mapX = x => 7 + 146 * (x - minX) / (maxX - minX);
    this.mapY = z => 7 + 146 * (z - minZ) / (maxZ - minZ);
    ctx.fillStyle = '#191d1b';
    ctx.fillRect(0, 0, 160, 160);
    ctx.strokeStyle = '#303830';
    ctx.lineWidth = 1;
    for (let x = 8; x <= 152; x += 12) {
      ctx.beginPath(); ctx.moveTo(x, 7); ctx.lineTo(x, 153); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(7, x); ctx.lineTo(153, x); ctx.stroke();
    }
    ctx.fillStyle = '#666958';
    for (const box of world.colliders) {
      if (box.max.y < 2 || box.min.y > 1.5) continue;
      const x = this.mapX(box.min.x), y = this.mapY(box.min.z);
      ctx.fillRect(x, y, this.mapX(box.max.x) - x, this.mapY(box.max.z) - y);
    }
  }

  drawMap(player, bots, yaw, elapsed) {
    const ctx = this.map;
    if (!this.mapBounds) return;
    ctx.drawImage(this.footprint, 0, 0);
    for (const bot of bots) {
      if (!bot.alive || (bot.team !== player.team && !(bot.revealedUntil > elapsed))) continue;
      ctx.fillStyle = bot.team === player.team ? '#86d5d6' : '#ff8265';
      ctx.beginPath();
      ctx.arc(this.mapX(bot.position.x), this.mapY(bot.position.z), 2.25, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(this.mapX(player.position.x), this.mapY(player.position.z));
    ctx.rotate(yaw);
    ctx.fillStyle = '#e5d29f33';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 20, -2.15, -.99); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f0dda9';
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 3); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  teamMarker(actor, friendly, x, y, distance) {
    let tag = this.tags.get(actor.id);
    if (!tag && x === undefined) return;
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'team-marker';
      tag.dataset.team = friendly ? 'friendly' : 'enemy';
      tag.textContent = friendly ? actor.name : 'ENEMY';
      this.el['team-markers'].append(tag);
      this.tags.set(actor.id, tag);
    }
    tag.hidden = x === undefined;
    if (tag.hidden) return;
    tag.style.left = x + '%';
    tag.style.top = y + '%';
    tag.style.opacity = friendly ? Math.max(.65, 1 - distance / 160) : 1;
  }

  hostileAim(active) {
    this.el.crosshair.classList.toggle('hostile', active);
  }

  elimination(killer, victim, head, time, player) {
    this.feed.unshift({ killer, victim, head, until: time + 6 });
    this.feed.length = Math.min(this.feed.length, 5);
    this.drawFeed();
    if (killer !== player) return;
    this.killUntil = time + 1.8;
    this.set('hit-label', head ? 'HEADSHOT' : '');
    this.set('xp', head ? '+150 XP' : '+100 XP');
  }

  drawFeed() {
    const nodes = this.feed.map(({ killer, victim, head }) => {
      const row = document.createElement('div');
      const a = document.createElement('b'), b = document.createElement('b'), weapon = document.createElement('i');
      a.className = killer.team ? 'red' : 'blue';
      b.className = victim.team ? 'red' : 'blue';
      a.textContent = killer.name;
      b.textContent = victim.name;
      weapon.textContent = head ? '◈' : '━╍';
      row.append(a, weapon, b);
      return row;
    });
    this.el.feed.replaceChildren(...nodes);
  }

  hit(type, time) {
    this.hitUntil = time + (type === 'kill' ? .24 : .13);
    this.el.hitmarker.dataset.type = type;
  }

  hurt(angle, time) {
    this.damageUntil = time + .48;
    this.el.damage.style.transform = 'translate(-50%,-50%) rotate(' + angle + 'rad)';
  }

  frame(game) {
    const { player, bots, remaining, elapsed, scores, yaw, ads, spread, status } = game;
    const e = this.el;
    this.set('timer', Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0'));
    this.set('blue-score', String(scores[0]).padStart(2, '0'));
    this.set('red-score', String(scores[1]).padStart(2, '0'));
    this.set('health', String(Math.ceil(player.health)));
    this.set('ammo', String(player.ammo).padStart(2, '0'));
    this.set('reserve', player.reserve);
    this.set('smoke-count', player.smoke);
    this.set('frag-count', player.frag);
    this.set('weapon-mode', player.auto ? 'AUTO' : 'SEMI');
    this.set('status', status);
    this.set('zone', Math.abs(player.position.x) > 18 ? 'SIDE STREETS' : player.position.z < -16 ? 'THE GATE' : player.position.z > 40 ? 'SOUTH APPROACH' : 'CENTRAL MARKET');
    e['health-meter'].style.width = player.health + '%';
    e['health-meter'].classList.toggle('critical', player.health < 32);
    e['ammo-meter'].style.width = (player.ammo / 30 * 100) + '%';
    e['smoke-slot'].classList.toggle('spent', !player.smoke);
    e['frag-slot'].classList.toggle('spent', !player.frag);
    e.crosshair.classList.toggle('visible', player.alive && ads < .5);
    e.crosshair.style.setProperty('--spread', (4 + spread) + 'px');
    e.hitmarker.classList.toggle('visible', elapsed < this.hitUntil);
    e.damage.classList.toggle('visible', elapsed < this.damageUntil);
    e['kill-banner'].classList.toggle('visible', elapsed < this.killUntil);
    if (this.feed.length && this.feed.at(-1).until < elapsed) {
      this.feed = this.feed.filter(item => item.until >= elapsed);
      this.drawFeed();
    }
    if (elapsed < this.mapTime || elapsed >= (this.mapTime || 0) + .075 || this.mapTime === undefined) {
      this.drawMap(player, bots, yaw, elapsed);
      this.mapTime = elapsed;
    }
    const degrees = ((Math.round(yaw * 180 / Math.PI) % 360) + 360) % 360;
    if (degrees !== this.last.degrees) {
      const bearing = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const index = Math.round(degrees / 45) % 8;
      const [left, center, right] = e.compass.children;
      left.textContent = bearing[(index + 7) % 8];
      center.textContent = bearing[index] + ' ' + String(degrees).padStart(3, '0');
      right.textContent = bearing[(index + 1) % 8];
      this.last.degrees = degrees;
    }
  }
}
