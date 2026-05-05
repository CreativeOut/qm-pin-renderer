/**
 * QM Pin Renderer — Puppeteer service.
 *
 * POST /render
 *   body: { html, viewport_width=1080, viewport_height=1920, ms_delay=1500 }
 *   response: image/png
 *
 * Self-healing: recycles the browser every RESTART_EVERY renders so Chromium
 * memory creep does not OOM the 512 MB Render instance.
 */

const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json({ limit: '15mb' }));

const RESTART_EVERY = Number(process.env.RESTART_EVERY || 5);
let browserPromise = null;
let renderCount = 0;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      args: [
        ...chromium.args,
        '--font-render-hinting=medium',
        '--disable-web-security',
        '--no-sandbox',
        '--disable-dev-shm-usage'
      ],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: null
    });
    const b = await browserPromise;
    b.on('disconnected', () => { browserPromise = null; renderCount = 0; });
  }
  return browserPromise;
}

async function recycleBrowserIfNeeded() {
  if (renderCount >= RESTART_EVERY && browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch (_) {}
    browserPromise = null;
    renderCount = 0;
  }
}

app.post('/render', async (req, res) => {
  const start = Date.now();
  await recycleBrowserIfNeeded();
  const {
    html,
    viewport_width = 1080,
    viewport_height = 1920,
    device_scale = 1,
    ms_delay = 1500
  } = req.body || {};

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'html (string) is required in request body' });
  }

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({
      width: Number(viewport_width),
      height: Number(viewport_height),
      deviceScaleFactor: Number(device_scale)
    });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    if (ms_delay > 0) {
      await new Promise(resolve => setTimeout(resolve, Number(ms_delay)));
    }
    const png = await page.screenshot({
      type: 'png',
      omitBackground: false,
      fullPage: false,
      clip: { x: 0, y: 0, width: Number(viewport_width), height: Number(viewport_height) }
    });
    renderCount++;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Render-Ms', String(Date.now() - start));
    res.setHeader('X-Render-Count', String(renderCount));
    res.send(png);
  } catch (err) {
    console.error('render error:', err);
    res.status(500).json({ error: String(err && err.message || err) });
  } finally {
    if (page) {
      try { await page.close(); } catch (_) {}
    }
  }
});

app.get('/healthz', async (req, res) => {
  try {
    const browser = await getBrowser();
    res.json({
      ok: true,
      browserConnected: browser.isConnected(),
      renderCount,
      restartEvery: RESTART_EVERY,
      ts: Date.now()
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err && err.message || err) });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'qm-pin-renderer',
    endpoints: { render: 'POST /render', health: 'GET /healthz' },
    config: { RESTART_EVERY }
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('QM Pin Renderer listening on port', port, '(recycle every', RESTART_EVERY, 'renders)');
});
