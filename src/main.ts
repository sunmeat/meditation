import './styles.css';

type Phase = 'ready' | 'running' | 'paused' | 'complete';

const DURATION_MS = 60_000;
const RING_CIRCUMFERENCE = 2 * Math.PI * 20;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error('Відсутній елемент інтерфейсу: ' + id);
  return found as T;
}

const input = element<HTMLTextAreaElement>('thought-input');
const startButton = element<HTMLButtonElement>('start-button');
const pauseButton = element<HTMLButtonElement>('pause-button');
const stopButton = element<HTMLButtonElement>('stop-button');
const againButton = element<HTMLButtonElement>('again-button');
const newButton = element<HTMLButtonElement>('new-button');
const motionButton = element<HTMLButtonElement>('motion-toggle');
const fontButton = element<HTMLButtonElement>('font-toggle');
const entryPanel = element<HTMLElement>('entry-panel');
const sessionPanel = element<HTMLElement>('session-panel');
const finishPanel = element<HTMLElement>('finish-panel');
const thought = element<HTMLElement>('thought');
const light = element<HTMLElement>('light');
const scene = element<HTMLElement>('scene');
const caption = element<HTMLElement>('scene-caption');
const guidance = element<HTMLElement>('guidance');
const timer = element<HTMLElement>('time-left');
const timerProgress = document.getElementById('timer-progress') as SVGCircleElement | null;

if (!timerProgress) throw new Error('Відсутній індикатор часу');

const messages: ReadonlyArray<{ second: number; text: string }> = [
  { second: 0, text: 'Нехай ця хвилина буде вашою.' },
  { second: 9, text: 'Те, що зараз важко, має причину.' },
  { second: 19, text: 'Помітьте три звичайні речі навколо себе.' },
  { second: 30, text: 'Відчуйте, на що спирається ваше тіло.' },
  { second: 41, text: 'Не обов’язково позбуватися думки. Достатньо помітити її.' },
  { second: 52, text: 'Якщо вам зручно, зробіть один м’який видих.' },
];

let phase: Phase = 'ready';
let startedAt = 0;
let elapsedBeforePause = 0;
let frameId = 0;
let lastMessageIndex = -1;
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function renderMotionButton(): void {
  document.documentElement.classList.toggle('reduce-motion', reducedMotion);
  motionButton.setAttribute('aria-pressed', String(reducedMotion));
  const label = motionButton.querySelector('.control-button__label');
  if (label) label.textContent = reducedMotion ? 'Без анімацій' : 'Менше руху';
  motionButton.title = reducedMotion ? 'Увімкнути плавний рух' : 'Зменшити рух';
  if (reducedMotion) {
    light.style.transform = 'translate(-50%, -50%)';
    thought.style.transform = 'translate(-50%, -50%)';
  }
}

renderMotionButton();

motionButton.addEventListener('click', () => {
  reducedMotion = !reducedMotion;
  renderMotionButton();
});

fontButton.addEventListener('click', () => {
  const isLarge = document.documentElement.classList.toggle('large-text');
  fontButton.setAttribute('aria-pressed', String(isLarge));
  const label = fontButton.querySelector('.control-button__label');
  if (label) label.textContent = isLarge ? 'Звичайний текст' : 'Більший текст';
  fontButton.title = isLarge ? 'Повернути звичайний розмір тексту' : 'Збільшити текст';
});

document.querySelectorAll<HTMLButtonElement>('[data-thought]').forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.thought ?? '';
    input.focus();
  });
});

function formatTime(seconds: number): string {
  const remaining = Math.max(0, seconds);
  return Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
}

function updateVisuals(elapsedMs: number): void {
  const progress = Math.max(0, Math.min(1, elapsedMs / DURATION_MS));
  const remainingSeconds = Math.ceil((DURATION_MS - elapsedMs) / 1000);
  timer.textContent = formatTime(remainingSeconds);
  timerProgress!.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  timerProgress!.style.strokeDashoffset = String(progress * RING_CIRCUMFERENCE);

  if (!reducedMotion) {
    const offset = -92 * progress;
    const scale = 1 - progress * 0.73;
    light.style.transform = 'translate(-50%, -50%) translateY(' + offset + 'px) scale(' + scale + ')';
    thought.style.transform = 'translate(-50%, -50%) translateY(' + offset + 'px) scale(' + (1 - progress * 0.34) + ')';
  }

  thought.style.opacity = String(Math.max(0, 1 - progress * 2.1));
  light.style.opacity = String(Math.max(0.33, 1 - progress * 0.6));

  const seconds = Math.floor(elapsedMs / 1000);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (seconds >= messages[i].second) {
      if (i !== lastMessageIndex) {
        guidance.textContent = messages[i].text;
        lastMessageIndex = i;
      }
      break;
    }
  }
}

function switchPhase(next: Phase): void {
  phase = next;
  entryPanel.hidden = next !== 'ready';
  sessionPanel.hidden = next !== 'running' && next !== 'paused';
  finishPanel.hidden = next !== 'complete';
  scene.classList.toggle('scene--active', next === 'running' || next === 'paused');
  scene.classList.toggle('scene--complete', next === 'complete');
}

function tick(now: number): void {
  if (phase !== 'running') return;

  const elapsedMs = Math.min(DURATION_MS, elapsedBeforePause + now - startedAt);
  updateVisuals(elapsedMs);

  if (elapsedMs >= DURATION_MS) {
    finish();
    return;
  }
  frameId = requestAnimationFrame(tick);
}

function start(): void {
  cancelAnimationFrame(frameId);
  elapsedBeforePause = 0;
  lastMessageIndex = -1;
  startedAt = performance.now();
  const text = input.value.trim().slice(0, 160);

  thought.textContent = text;
  thought.hidden = text.length === 0;
  caption.hidden = true;
  thought.style.opacity = '1';
  light.style.opacity = '1';
  light.style.transform = 'translate(-50%, -50%)';
  thought.style.transform = 'translate(-50%, -50%)';
  pauseButton.textContent = 'Призупинити';

  switchPhase('running');
  updateVisuals(0);
  frameId = requestAnimationFrame(tick);
}

function pause(): void {
  if (phase !== 'running') return;
  elapsedBeforePause = Math.min(DURATION_MS, elapsedBeforePause + performance.now() - startedAt);
  cancelAnimationFrame(frameId);
  switchPhase('paused');
  pauseButton.textContent = 'Продовжити';
}

function resume(): void {
  if (phase !== 'paused') return;
  startedAt = performance.now();
  switchPhase('running');
  pauseButton.textContent = 'Призупинити';
  frameId = requestAnimationFrame(tick);
}

function finish(): void {
  cancelAnimationFrame(frameId);
  updateVisuals(DURATION_MS);
  thought.hidden = true;
  caption.hidden = false;
  caption.textContent = 'Ця хвилина належала вам.';
  switchPhase('complete');
  againButton.focus({ preventScroll: true });
}

function reset(clearText = false): void {
  cancelAnimationFrame(frameId);
  elapsedBeforePause = 0;
  lastMessageIndex = -1;
  if (clearText) input.value = '';
  thought.hidden = true;
  thought.textContent = '';
  thought.style.opacity = '1';
  thought.style.transform = 'translate(-50%, -50%)';
  light.style.opacity = '1';
  light.style.transform = 'translate(-50%, -50%)';
  caption.hidden = false;
  caption.textContent = 'Навіть маленьке світло залишається світлом.';
  switchPhase('ready');
  input.focus({ preventScroll: true });
}

startButton.addEventListener('click', start);
pauseButton.addEventListener('click', () => phase === 'running' ? pause() : resume());
stopButton.addEventListener('click', () => reset(false));
againButton.addEventListener('click', start);
newButton.addEventListener('click', () => reset(true));

input.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') start();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (phase === 'running' || phase === 'paused')) reset(false);
});

document.addEventListener('visibilitychange', () => {
  // Do not keep playing while someone checks alerts, switches apps, or locks the screen.
  if (document.hidden) pause();
});

const stars = element<HTMLElement>('stars');
let seed = 2026;

function nextRandom(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const fragment = document.createDocumentFragment();
for (let i = 0; i < 82; i++) {
  const star = document.createElement('span');
  const size = nextRandom() > 0.93 ? 2.5 : 1 + nextRandom() * 1.2;
  star.className = 'scene-star';
  star.style.left = (3 + nextRandom() * 94) + '%';
  star.style.top = (2 + nextRandom() * 94) + '%';
  star.style.width = size + 'px';
  star.style.height = size + 'px';
  star.style.opacity = String(0.13 + nextRandom() * 0.52);
  star.style.animationDelay = '-' + (nextRandom() * 10).toFixed(2) + 's';
  star.style.animationDuration = (4 + nextRandom() * 7).toFixed(2) + 's';
  fragment.appendChild(star);
}
stars.appendChild(fragment);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The experience still works online if an environment disables service workers.
    });
  });
}
