/**
 * QM Pin Renderer — Puppeteer service.
 *
 * POST /render
 *   body: { html, viewport_width=1440, viewport_height=2250, ms_delay=800 }
 *   response: image/png
 *
 * Runs on Render.com free tier (or any Node host). Reuses one browser
 * across requests to avoid the 1-2s Chrome startup cost per pin.
 */

const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json({ limit: '15mb' }));

let browserPromise = null;

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
    b.on('disconnected', () => { browserPromise = null; });
  }
  return browserPromise;
}

app.post('/render', async (req, res) => {
  const start = Date.now();
  const {
    html,
    viewport_width = 1440,
    viewport_height = 2250,
    device_scale = 1,
    ms_delay = 800
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
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Render-Ms', String(Date.now() - start));
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
    res.json({ ok: true, browserConnected: browser.isConnected(), ts: Date.now() });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err && err.message || err) });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'qm-pin-renderer',
    endpoints: { render: 'POST /render', health: 'GET /healthz' }
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('QM Pin Renderer listening on port', port);
});
