export const touchDevice = matchMedia('(pointer: coarse)').matches
  || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 900);

const STICK_RADIUS = 52;
const STICK_DEAD_ZONE = 7;
const TOGGLES = ['ads', 'crouch', 'sprint'];

export class TouchControls {
  constructor(canvas, panel, { look, pause }) {
    this.panel = panel;
    this.stick = panel.querySelector('.touch-stick');
    this.knob = this.stick.firstElementChild;
    this.buttons = new Map([...panel.querySelectorAll('button[data-touch]')]
      .map(button => [button.dataset.touch, button]));
    this.pointers = new Map();
    this.held = new Set();
    this.pressed = new Set();
    this.clear();

    const start = (event, action) => {
      if (event.pointerType !== 'touch' || panel.hidden || this.held.has(action)) return;
      event.preventDefault();
      if (action === 'pause') { pause(); return; }
      if (panel.classList.contains('touch-dead')) return;

      const { pointerId, clientX, clientY, currentTarget } = event;
      currentTarget.setPointerCapture(pointerId);
      this.pointers.set(pointerId, { action, x: clientX, y: clientY });
      this.held.add(action);
      if (action === 'move') {
        this.stick.style.left = clientX + 'px';
        this.stick.style.top = clientY + 'px';
        this.stick.hidden = false;
      } else if (TOGGLES.includes(action)) {
        this[action] = !this[action];
        currentTarget.setAttribute('aria-pressed', this[action]);
      } else if (action !== 'look') {
        this.pressed.add(action);
        currentTarget.classList.add('active');
      }
    };

    canvas.addEventListener('pointerdown', event => start(event, event.clientX < innerWidth * .45 ? 'move' : 'look'));
    for (const [action, button] of this.buttons) {
      button.addEventListener('pointerdown', event => start(event, action));
    }

    document.addEventListener('pointermove', event => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (pointer.action === 'move') {
        const distance = Math.hypot(dx, dy);
        const travel = Math.min(1, STICK_RADIUS / (distance || 1));
        this.knob.style.transform = `translate(${dx * travel}px, ${dy * travel}px)`;
        const magnitude = Math.max(0, Math.min(1, (distance - STICK_DEAD_ZONE) / (STICK_RADIUS - STICK_DEAD_ZONE)));
        this.strafe = dx / (distance || 1) * magnitude;
        this.forward = -dy / (distance || 1) * magnitude;
      } else if (pointer.action === 'look' || pointer.action === 'fire') {
        look(dx, dy);
        pointer.x = event.clientX;
        pointer.y = event.clientY;
      }
    });

    const release = event => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer) return;
      this.pointers.delete(event.pointerId);
      this.held.delete(pointer.action);
      this.buttons.get(pointer.action)?.classList.remove('active');
      if (event.type === 'pointercancel') this.pressed.delete(pointer.action);
      if (pointer.action === 'move') this.resetStick();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      document.addEventListener(type, release);
    }
  }

  resetStick() {
    this.strafe = this.forward = 0;
    this.stick.hidden = true;
    this.knob.style.transform = '';
  }

  clear() {
    this.pointers.clear();
    this.held.clear();
    this.pressed.clear();
    this.resetStick();
    for (const action of TOGGLES) this[action] = false;
    for (const button of this.buttons.values()) {
      button.classList.remove('active');
      if (button.hasAttribute('aria-pressed')) button.setAttribute('aria-pressed', 'false');
    }
  }

  phase(state) {
    this.panel.hidden = state !== 'play' && state !== 'dead';
    if (state !== 'play') this.clear();
    this.panel.classList.toggle('touch-dead', state === 'dead');
  }
}
