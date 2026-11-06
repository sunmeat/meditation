import { test, expect } from '@playwright/test';

const viewports = [
  { width: 320, height: 700 },
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test.describe('Екран ' + viewport.width + 'px', () => {
    test.use({
      viewport,
      isMobile: viewport.width < 768,
      hasTouch: viewport.width < 768,
    });

    test('доступний інтерфейс, без горизонтального скролу, хвилина з MP3', async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto('/');
      await expect(page.getByRole('heading', { name: /Коли навколо гучно/ })).toBeVisible();
      await expect(page.locator('#entry-panel')).toBeVisible();
      await expect(page.locator('#motion-toggle')).toHaveCount(0);
      await expect(page.getByText('ПРОСТІР ДЛЯ ОДНІЄЇ ХВИЛИНИ')).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Відкритий код/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /sunmeat.dev/ })).toBeVisible();

      await page.getByRole('button', { name: /Ще 9 варіантів/ }).click();
      await expect(page.locator('#more-suggestions [data-thought]')).toHaveCount(9);
      await expect(page.locator('#more-suggestions')).toBeVisible();

      await page.locator('[data-thought="Мені страшно"]').click();
      await expect(page.locator('#thought-input')).toHaveValue('Мені страшно');
      await page.getByRole('button', { name: /Почати хвилину/ }).click();

      await expect(page.locator('#session-panel')).toBeVisible();
      await expect(page.getByRole('button', { name: /Вимкнути музику/ })).toBeVisible();
      await expect(page.locator('#thought')).toHaveText('Мені страшно');

      const sizes = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.viewport + 1);

      await page.getByRole('button', { name: /Призупинити/ }).click();
      await expect(page.getByRole('button', { name: /Продовжити/ })).toBeVisible();
      await page.getByRole('button', { name: /Продовжити/ }).click();
      await page.getByRole('button', { name: /Вимкнути музику/ }).click();
      await expect(page.getByRole('button', { name: /Увімкнути музику/ })).toBeVisible();

      await page.getByRole('button', { name: /Завершити зараз/ }).click();
      await expect(page.locator('#entry-panel')).toBeVisible();
      expect(pageErrors).toEqual([]);
    });
  });
}

test('трек 1.mp3 доступний і має підтримку байтових запитів', async ({ request }) => {
  const response = await request.get('/1.mp3', {
    headers: { Range: 'bytes=0-1023' },
    timeout: 30_000,
  });
  expect([200, 206]).toContain(response.status());
  expect(response.headers()['content-type']).toMatch(/audio|mpeg|octet-stream/);
});


test('музика зберігає позицію між хвилинами та плавно відновлює гучність', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = function (src?: string): HTMLAudioElement {
      const player = new NativeAudio(src);
      let position = 0;
      const seeks: number[] = [];
      Object.defineProperty(player, 'currentTime', {
        configurable: true,
        get: () => position,
        set: (value: number) => { seeks.push(value); position = value; },
      });
      player.play = async () => {};
      player.pause = () => {};
      Object.assign(window, { __trackTest: { player, seeks } });
      return player;
    } as typeof Audio;
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Почати хвилину/ }).click();
  await page.evaluate(() => {
    const data = (window as unknown as { __trackTest: { player: HTMLAudioElement } }).__trackTest;
    data.player.currentTime = 51.5;
  });

  await page.clock.fastForward(60_050);
  await expect(page.locator('#finish-panel')).toBeVisible();
  const first = await page.evaluate(() => {
    const { player, seeks } = (window as unknown as {
      __trackTest: { player: HTMLAudioElement; seeks: number[] }
    }).__trackTest;
    return { position: player.currentTime, volume: player.volume, seeks };
  });
  expect(first.position).toBe(51.5);
  expect(first.volume).toBe(0);
  expect(first.seeks).toEqual([51.5]);

  await page.getByRole('button', { name: /Ще одна хвилина/ }).click();
  const second = await page.evaluate(() => {
    const { player } = (window as unknown as { __trackTest: { player: HTMLAudioElement } }).__trackTest;
    return { position: player.currentTime, volume: player.volume };
  });
  expect(second.position).toBe(51.5);
  expect(second.volume).toBe(0);

  await page.clock.runFor(3_500);
  const fade = await page.evaluate(() => {
    const { player } = (window as unknown as { __trackTest: { player: HTMLAudioElement } }).__trackTest;
    return player.volume;
  });
  expect(fade).toBeGreaterThan(0.35);
  expect(fade).toBeLessThanOrEqual(0.5);
});

test('призупинення та завершення плавно зменшують гучність, зберігаючи позицію', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = function (src?: string): HTMLAudioElement {
      const player = new NativeAudio(src);
      let position = 38.25;
      let isPaused = true;
      Object.defineProperty(player, 'currentTime', {
        configurable: true,
        get: () => position,
        set: (value: number) => { position = value; },
      });
      Object.defineProperty(player, 'paused', { configurable: true, get: () => isPaused });
      player.play = async () => { isPaused = false; };
      player.pause = () => { isPaused = true; };
      Object.assign(window, { __trackTest: { player } });
      return player;
    } as typeof Audio;
  });

  const audio = () => page.evaluate(() => {
    const { player } = (window as unknown as { __trackTest: { player: HTMLAudioElement } }).__trackTest;
    return { paused: player.paused, position: player.currentTime, volume: player.volume };
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Почати хвилину/ }).click();
  await page.clock.runFor(5_000);
  const beforePause = await audio();
  expect(beforePause.paused).toBe(false);
  expect(beforePause.volume).toBeGreaterThan(0.4);

  await page.getByRole('button', { name: /Призупинити/ }).click();
  await expect(page.getByRole('button', { name: /Продовжити/ })).toBeVisible();
  const immediately = await audio();
  expect(immediately.paused).toBe(false);
  expect(immediately.volume).toBeGreaterThan(0.35);

  await page.clock.runFor(650);
  const duringFade = await audio();
  expect(duringFade.volume).toBeGreaterThan(0);
  expect(duringFade.volume).toBeLessThan(immediately.volume);

  // Resume before the 2-second fade finishes: no obsolete callback may stop the audio.
  await page.getByRole('button', { name: /Продовжити/ }).click();
  await page.clock.runFor(2_300);
  const afterResume = await audio();
  expect(afterResume.paused).toBe(false);
  expect(afterResume.position).toBe(38.25);
  expect(afterResume.volume).toBeGreaterThan(0.25);

  await page.getByRole('button', { name: /Завершити зараз/ }).click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  const afterStopClick = await audio();
  expect(afterStopClick.paused).toBe(false);
  expect(afterStopClick.volume).toBeGreaterThan(0.2);
  await page.clock.runFor(1050);
  const nearEnd = await audio();
  expect(nearEnd.volume).toBeGreaterThan(0);
  expect(nearEnd.volume).toBeLessThan(afterStopClick.volume);
  await page.clock.runFor(1150);
  const ended = await audio();
  expect(ended.paused).toBe(true);
  expect(ended.volume).toBe(0);
  expect(ended.position).toBe(38.25);

  await page.getByRole('button', { name: /Почати хвилину/ }).click();
  await page.clock.runFor(3500);
  const restarted = await audio();
  expect(restarted.paused).toBe(false);
  expect(restarted.position).toBe(38.25);
  expect(restarted.volume).toBeGreaterThan(0.4);
});

test('український опис при поширенні та відсутність думок у метаданих', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Тихо поруч/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://tyho.vercel.app/');
  const meta = await page.locator('meta[property="og:description"]').getAttribute('content');
  expect(meta?.length).toBeGreaterThan(250);
  expect(meta).toContain('війни в Україні');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /безкоштовний/);
  await page.locator('#thought-input').fill('Тестова приватна думка');
  const content = await page.locator('head').innerText();
  expect(content).not.toContain('Тестова приватна думка');
});
