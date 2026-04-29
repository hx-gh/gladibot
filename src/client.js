import { config } from './config.js';
import { log } from './log.js';
import { refreshSession } from './browser.js';

export class SessionExpiredError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'SessionExpiredError';
  }
}

// HTTP client backed by Playwright's APIRequestContext (page.request),
// so cookies are shared with the browser and the session lives as long
// as the persistent context does.
export class GladiatusClient {
  constructor(page, session) {
    this.page = page;
    this.session = session; // { sh, csrf } — mutated on refresh
    this.base = config.baseUrl;
  }

  buildUrl(path, params = {}) {
    const u = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    if (!u.searchParams.has('sh')) u.searchParams.set('sh', this.session.sh);
    return u.toString();
  }

  async _exec(method, url, options, attempt = 0) {
    const fn = method === 'POST' ? 'post' : 'get';
    const finalOpts = {
      ...options,
      headers: {
        'x-csrf-token': this.session.csrf,
        'x-requested-with': 'XMLHttpRequest',
        ...(options.headers || {}),
      },
    };
    log.debug('HTTP', method, url);
    const res = await this.page.request[fn](url, finalOpts);
    const status = res.status();

    if ((status === 401 || status === 403) && attempt === 0) {
      log.warn(`HTTP ${status} — refreshing session and retrying once`);
      const fresh = await refreshSession(this.page);
      this.session.sh = fresh.sh;
      this.session.csrf = fresh.csrf;
      // Rebuild URL if it was using the old sh
      const rebuilt = url.replace(/([?&])sh=[^&]+/, `$1sh=${fresh.sh}`);
      return this._exec(method, rebuilt, options, 1);
    }
    if (status === 401 || status === 403) {
      throw new SessionExpiredError(`HTTP ${status} on ${url} after refresh attempt`);
    }
    if (!res.ok()) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${status} on ${url}: ${body.slice(0, 200)}`);
    }

    const text = await res.text();
    const ct = res.headers()['content-type'] || '';
    if (ct.includes('application/json') || /^\s*\{/.test(text)) {
      try { return JSON.parse(text); } catch { /* fall through to text */ }
    }
    return text;
  }

  async getHtml(path, params) {
    // For HTML pages we NAVIGATE (so the page's JS runs and the DOM is fully
    // populated). page.request is HTTP-only and would skip JS — that breaks
    // any field rendered client-side.
    const url = this.buildUrl(path, params);
    log.debug('NAVIGATE', url);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    const html = await this.page.content();
    if (config.logLevel === 'debug') {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const outDir = 'docs/wip';
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'last-overview.html'), html);
      } catch (_) { /* non-fatal */ }
    }
    return html;
  }

  // HTTP GET for HTML — does NOT navigate the active page. Use this for debug
  // / inspection so you don't race with the orchestrator's `getHtml` (which
  // would cause both navigations to abort each other). JS won't run, so any
  // client-side rendering is missing, but server-rendered markup is intact.
  async fetchRawHtml(path, params) {
    return this._exec('GET', this.buildUrl(path, params), {
      headers: { accept: 'text/html, */*' },
    });
  }

  getAjax(path, params) {
    return this._exec('GET', this.buildUrl(path, { ...params, a: Date.now() }), {
      headers: { accept: 'text/javascript, text/html, application/xml, text/xml, */*' },
    });
  }

  postForm(path, params, body = {}) {
    return this._exec('POST', this.buildUrl(path, params), {
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        origin: this.base,
      },
      form: { a: String(Date.now()), sh: this.session.sh, ...stringifyValues(body) },
    });
  }
}

function stringifyValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = String(v);
  return out;
}
