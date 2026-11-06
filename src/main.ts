import './styles.css';

type Phase = 'ready' | 'running' | 'paused' | 'complete';

const DURATION_MS = 60_000;
const RING_CIRCUMFERENCE = Math.PI * 40;
const MUSIC_VOLUME = 0.5;
const FADE_IN_MS = 3200;
const FADE_OUT_MS = 8000;

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
const fontButton = element<HTMLButtonElement>('font-toggle');
const moreButton = element<HTMLButtonElement>('show-more-thoughts');
const moreSuggestions = element<HTMLElement>('more-suggestions');
const musicButton = element<HTMLButtonElement>('session-music-toggle');
const entryPanel = element<HTMLElement>('entry-panel');
const sessionPanel = element<HTMLElement>('session-panel');
const finishPanel = element<HTMLElement>('finish-panel');
const thought = element<HTMLElement>('thought');
const light = element<HTMLElement>('light');
const scene = element<HTMLElement>('scene');
const caption = element<HTMLElement>('scene-caption');
const guidance = element<HTMLElement>('guidance');
const timer = element<HTMLElement>('time-left');
const stars = element<HTMLElement>('stars');
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
let currentElapsedMs = 0;
let fadeInFromElapsedMs = 0;
let frameId = 0;
let lastMessageIndex = -1;
let soundEnabled = true;
let audioUnavailable = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The visitor supplied /public/1.mp3. There are no third-party streams or requests.
// Playback is initiated synchronously by the same click that begins the exercise.
const soundtrack = new Audio('/1.mp3');
soundtrack.preload = 'metadata';
soundtrack.loop = true;
soundtrack.volume = 0;

function renderMusicButton(): void {
  musicButton.setAttribute('aria-pressed', String(soundEnabled && !audioUnavailable));
  if (audioUnavailable) {
    musicButton.textContent = '♫ Музика недоступна';
    musicButton.disabled = true;
    return;
  }
  musicButton.textContent = soundEnabled ? '♫ Вимкнути музику' : '♫ Увімкнути музику';
}

function playMusic(): void {
  if (!soundEnabled || audioUnavailable) return;
  // Calling play directly from the click/tap respects browser autoplay policies.
  void soundtrack.play().catch((error: unknown) => {
    // Pausing, ending the session, or switching tabs can abort a pending play().
    if (error instanceof DOMException && error.name === 'AbortError') return;
    soundEnabled = false;
    renderMusicButton();
  });
}

// Pause without seeking: the next one-minute meditation keeps the same position.
function pauseMusic(): void {
  soundtrack.pause();
  soundtrack.volume = 0;
}

function updateVolume(): void {
  if (!soundEnabled) return;
  const fadeIn = Math.min(1, Math.max(0, (currentElapsedMs - fadeInFromElapsedMs) / FADE_IN_MS));
  const fadeOut = Math.min(1, Math.max(0, (DURATION_MS - currentElapsedMs) / FADE_OUT_MS));
  soundtrack.volume = Math.max(0, Math.min(1, MUSIC_VOLUME * fadeIn * fadeOut));
}

soundtrack.addEventListener('error', () => {
  audioUnavailable = true;
  soundEnabled = false;
  renderMusicButton();
});

musicButton.addEventListener('click', () => {
  if (audioUnavailable) return;
  soundEnabled = !soundEnabled;
  renderMusicButton();
  if (!soundEnabled) {
    pauseMusic();
  } else if (phase === 'running') {
    fadeInFromElapsedMs = currentElapsedMs;
    soundtrack.volume = 0;
    playMusic();
  }
});

fontButton.addEventListener('click', () => {
  const isLarge = document.documentElement.classList.toggle('large-text');
  fontButton.setAttribute('aria-pressed', String(isLarge));
  const label = fontButton.querySelector('.control-button__label');
  if (label) label.textContent = isLarge ? 'Звичайний текст' : 'Більший текст';
  fontButton.title = isLarge ? 'Повернути звичайний розмір тексту' : 'Збільшити текст';
});

moreButton.addEventListener('click', () => {
  const expanded = moreButton.getAttribute('aria-expanded') === 'true';
  moreSuggestions.hidden = expanded;
  moreButton.setAttribute('aria-expanded', String(!expanded));
  moreButton.innerHTML = expanded
    ? 'Ще 9 варіантів <span aria-hidden="true">⌄</span>'
    : 'Менше варіантів <span aria-hidden="true">⌃</span>';
});

const thoughtChips = [...document.querySelectorAll<HTMLButtonElement>('[data-thought]')];

function updateChipSelection(): void {
  thoughtChips.forEach((button) => {
    button.setAttribute('aria-pressed', String(input.value === button.dataset.thought));
  });
}

thoughtChips.forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.thought ?? '';
    updateChipSelection();
    // Do not force the mobile software keyboard open after a quick choice.
  });
});
input.addEventListener('input', updateChipSelection);

function formatTime(seconds: number): string {
  const remaining = Math.max(0, seconds);
  return Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
}

function updateVisuals(elapsedMs: number): void {
  currentElapsedMs = Math.min(DURATION_MS, Math.max(0, elapsedMs));
  const progress = currentElapsedMs / DURATION_MS;
  const eased = progress * progress * (3 - 2 * progress);
  timer.textContent = formatTime(Math.ceil((DURATION_MS - currentElapsedMs) / 1000));
  timerProgress!.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  timerProgress!.style.strokeDashoffset = String(progress * RING_CIRCUMFERENCE);

  if (!reducedMotion) {
    const travel = -65 * eased;
    const scale = 1 - 0.986 * eased;
    light.style.transform = 'translate(-50%, -50%) translate3d(0,' + travel + 'px,0) scale(' + scale + ')';
    thought.style.transform = 'translate(-50%, -50%) translate3d(0,' + travel + 'px,0) scale(' + (1 - 0.67 * eased) + ')';
  } else {
    light.style.transform = 'translate(-50%, -50%)';
    thought.style.transform = 'translate(-50%, -50%)';
  }

  const fade = Math.min(1, Math.max(0, (progress - 0.71) / 0.29));
  light.style.opacity = String(1 - fade);
  thought.style.opacity = String(Math.max(0, 1 - progress * 2.35));
  updateVolume();

  const seconds = Math.floor(currentElapsedMs / 1000);
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
  scene.classList.toggle('scene--paused', next === 'paused');
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
  pauseMusic();
  // Do not rewind the MP3 here. "Ще одна хвилина" continues the same track.
  soundEnabled = !audioUnavailable;
  renderMusicButton();
  elapsedBeforePause = 0;
  currentElapsedMs = 0;
  fadeInFromElapsedMs = 0;
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
  // This is the button gesture: the music begins with the submitted thought.
  playMusic();
}

function pause(): void {
  if (phase !== 'running') return;
  elapsedBeforePause = Math.min(DURATION_MS, elapsedBeforePause + performance.now() - startedAt);
  updateVisuals(elapsedBeforePause);
  cancelAnimationFrame(frameId);
  pauseMusic();
  switchPhase('paused');
  pauseButton.textContent = 'Продовжити';
}

function resume(): void {
  if (phase !== 'paused') return;
  startedAt = performance.now();
  fadeInFromElapsedMs = elapsedBeforePause;
  soundtrack.volume = 0;
  switchPhase('running');
  pauseButton.textContent = 'Призупинити';
  frameId = requestAnimationFrame(tick);
  playMusic();
}

function finish(): void {
  cancelAnimationFrame(frameId);
  updateVisuals(DURATION_MS);
  // After the 8-second fade-out, freeze the long track at this position.
  pauseMusic();
  thought.hidden = true;
  caption.hidden = false;
  caption.textContent = 'Ця хвилина належала вам.';
  switchPhase('complete');
  againButton.focus({ preventScroll: true });
}

function reset(clearText = false): void {
  cancelAnimationFrame(frameId);
  pauseMusic();
  elapsedBeforePause = 0;
  currentElapsedMs = 0;
  lastMessageIndex = -1;
  if (clearText) input.value = '';
  updateChipSelection();
  thought.hidden = true;
  thought.textContent = '';
  thought.style.opacity = '1';
  thought.style.transform = 'translate(-50%, -50%)';
  light.style.opacity = '1';
  light.style.transform = 'translate(-50%, -50%)';
  caption.hidden = false;
  caption.textContent = 'Навіть маленьке світло залишається світлом.';
  switchPhase('ready');
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

// If someone checks an air-raid alert, switches apps or locks the phone,
// the exercise and the music stop together until the person resumes.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// Deterministic star layout prevents a jump on every rerender.
let seed = 2026;
function nextRandom(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const fragment = document.createDocumentFragment();
for (let i = 0; i < 136; i++) {
  const star = document.createElement('span');
  const depth = nextRandom();
  const size = depth > 0.92 ? 2.7 : depth > 0.58 ? 1.7 : 1;
  const drift = depth > 0.72 ? 26 : depth > 0.35 ? 17 : 10;
  star.className = 'scene-star';
  star.style.left = (2 + nextRandom() * 96).toFixed(2) + '%';
  star.style.top = (3 + nextRandom() * 94).toFixed(2) + '%';
  star.style.width = size + 'px';
  star.style.height = size + 'px';
  star.style.setProperty('--drift-x', ((nextRandom() - 0.5) * drift * 2).toFixed(1) + 'px');
  star.style.setProperty('--drift-y', ((nextRandom() - 0.5) * drift * 2).toFixed(1) + 'px');
  star.style.setProperty('--star-brightness', (0.24 + nextRandom() * 0.47).toFixed(2));
  star.style.setProperty('--drift-duration', (25 + nextRandom() * 38).toFixed(1) + 's');
  star.style.setProperty('--glow-duration', (6 + nextRandom() * 9).toFixed(1) + 's');
  star.style.animationDelay = '-' + (nextRandom() * 35).toFixed(1) + 's';
  fragment.appendChild(star);
}
stars.appendChild(fragment);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The exercise still works online if service workers are unavailable.
    });
  });
}
