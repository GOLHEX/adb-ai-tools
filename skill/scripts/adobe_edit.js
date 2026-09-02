#!/usr/bin/env node
/**
 * Adobe Stock — правка метаданных опубликованных работ по media_id.
 * Без зависимостей. Node >= 22. Говорит с Chrome по CDP через встроенный WebSocket.
 *
 * Механика (выяснена 25.08.2026 на живом аккаунте):
 *   сохранение   = POST /en/content/{id}/details
 *   заголовки    = csrf-token, X-Requested-With: XMLHTTPRequest, Content-Type: application/json
 *   тело         = {"title":..., "contentUuid":..., "category":<число>, "keywords":[...]}
 *   contentUuid  — СВОЙ у каждой работы, берётся из листинга портфеля
 *
 * Команды:
 *   node adobe_edit.js --harvest 1 5           выгрузить страницы 1..5 портфеля в portfolio_dump.csv
 *   node adobe_edit.js --apply updates.csv --dry     показать, что уйдёт, ничего не отправляя
 *   node adobe_edit.js --apply updates.csv           боевой прогон
 *
 * updates.csv: media_id,title,keywords,category
 *   keywords — через запятую в кавычках; пустая колонка = не трогать это поле
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const has = k => argv.includes('--' + k);
const val = (k, d) => { const i = argv.indexOf('--' + k); return i === -1 ? d : argv[i + 1]; };
const CFG = {
  browser: val('browser', 'http://127.0.0.1:9222'),
  host: 'contributor.stock.adobe.com',
  dry: has('dry'),
  delay: Number(val('delay', 3000)),
  limit: Number(val('limit', 0)),
  tpl: path.join(__dirname, 'template.json'),
  dump: path.join(__dirname, 'portfolio_dump.csv'),
  out: path.join(__dirname, 'apply_report.json'),
  sold: val('soldlist', path.join(__dirname, '..', '02_data', 'assets_lifetime_2y.csv')),
  noSkipSold: has('no-skip-sold'),
  prevDir: val('previews', path.join(__dirname, '..', '05_previews')),
  edited: val('editedlog', path.join(__dirname, 'edited_log.csv')),
  redo: has('redo'),
  noPrev: has('no-previews'),
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── CDP ─────────────────────────────────────────────────────
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  static async attach(browserURL, host) {
    const list = await (await fetch(browserURL.replace(/\/$/, '') + '/json/list')).json();
    const t = list.filter(x => x.type === 'page').find(p => (p.url || '').includes(host));
    if (!t) throw new Error(`нет вкладки с ${host}. Открой портфель в Chrome с --remote-debugging-port=9222`);
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS не подключился')); });
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const { res, rej } = c.pending.get(m.id); c.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method && c.handlers.has(m.method)) {
        for (const fn of c.handlers.get(m.method)) { try { fn(m.params) } catch (e) {} }
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('таймаут ' + method)); } }, 60000);
    });
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async goto(url) {
    await this.send('Page.enable').catch(() => {});
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const n = await this.evaluate(`document.querySelectorAll('[data-t="portfolio-single-asset-wrapper"]').length`).catch(() => 0);
      if (n > 0) return n;
    }
    return 0;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

// извлечение всех работ текущей страницы из React-фибера
const EXTRACT = `(() => {
  const out = [];
  document.querySelectorAll('[data-t="portfolio-single-asset-wrapper"]').forEach(el => {
    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    let f = el[fk], a = null, h = 0;
    while (f && h < 8) { if (f.memoizedProps && f.memoizedProps.asset) { a = f.memoizedProps.asset; break } f = f.return; h++ }
    if (a) {
      // 500px превью — этого хватает для визуального разбора; 220px миниатюра как запасной
      let thumb = a.largePreviewUrl || a.thumbnailUrl || a.thumbnail_url || '';
      if (!thumb) { const img = el.querySelector('img'); if (img) thumb = img.currentSrc || img.src || ''; }
      if (thumb && thumb.startsWith('//')) thumb = location.protocol + thumb;
      out.push({ id: a.id, uuid: a.uuid, title: a.title || '', category: a.category || '',
                 filename: a.originalName || a.original_name || a.fileName || a.filename || '',
                 thumb,
                 keywords: Array.isArray(a.keywords) ? a.keywords : [] });
    }
  });
  return out;
})()`;

// диагностика: какие вообще поля есть у работы (нужно, чтобы найти имя файла)
const FIELDS = `(() => {
  const el = document.querySelector('[data-t="portfolio-single-asset-wrapper"]');
  if (!el) return 'нет работ на странице';
  const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  let f = el[fk], a = null, h = 0;
  while (f && h < 8) { if (f.memoizedProps && f.memoizedProps.asset) { a = f.memoizedProps.asset; break } f = f.return; h++ }
  if (!a) return 'asset не найден';
  const out = { '#карточек на странице': document.querySelectorAll('[data-t="portfolio-single-asset-wrapper"]').length };
  for (const k of Object.keys(a)) {
    const v = a[k];
    out['asset.' + k] = v === null ? 'null' : Array.isArray(v) ? 'array[' + v.length + ']'
           : typeof v === 'object' ? 'object' : String(v).slice(0, 90);
  }
  const imgs = el.querySelectorAll('img');
  out['#img в карточке'] = imgs.length;
  imgs.forEach((im, i) => {
    out['img' + i + '.src'] = (im.currentSrc || im.src || '').slice(0, 120) || '(пусто)';
    out['img' + i + '.data-src'] = (im.getAttribute('data-src') || '(нет)').slice(0, 120);
    out['img' + i + '.srcset'] = (im.getAttribute('srcset') || '(нет)').slice(0, 120);
  });
  out['первые 400 символов HTML карточки'] = el.innerHTML.slice(0, 400);
  return out;
})()`;

const csvEsc = s => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);

// ─── свежий csrf-token ───────────────────────────────────────
// Токен живёт недолго, поэтому брать его из template.json нельзя — он протухает.
// Ищем прямо в живой странице, по всем известным местам сразу.
const FIND_CSRF = `(async () => {
  const found = {};
  const good = v => typeof v === 'string' && /^[A-Za-z0-9_\\-]{16,80}$/.test(v);

  document.querySelectorAll('meta').forEach(m => {
    const n = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
    if (n.includes('csrf') || n.includes('xsrf')) found['meta:' + n] = m.content;
  });

  document.cookie.split(';').forEach(c => {
    const i = c.indexOf('='); if (i < 0) return;
    const k = c.slice(0, i).trim(), v = c.slice(i + 1);
    if (/csrf|xsrf/i.test(k)) { try { found['cookie:' + k] = decodeURIComponent(v); } catch (e) { found['cookie:' + k] = v; } }
  });

  const seen = new Set();
  const walk = (o, p, d) => {
    if (!o || d > 4 || seen.has(o)) return;
    if (typeof o === 'object') { seen.add(o); if (seen.size > 4000) return; }
    for (const k in o) {
      let v; try { v = o[k]; } catch (e) { continue }
      if (/csrf|xsrf/i.test(k) && good(v)) found['js:' + p + '.' + k] = v;
      else if (v && typeof v === 'object' && !(v instanceof Node) && !(v instanceof Window)) walk(v, p + '.' + k, d + 1);
    }
  };
  for (const k of Object.keys(window)) {
    let v; try { v = window[k]; } catch (e) { continue }
    if (/csrf|xsrf/i.test(k) && good(v)) found['win.' + k] = v;
    else if (v && typeof v === 'object' && !(v instanceof Node) && !(v instanceof Window)) walk(v, k, 0);
  }

  try {
    const html = await (await fetch('/en/portfolio', { credentials: 'include' })).text();
    const re = /["']?(?:csrf[_-]?token|csrfToken|xsrfToken)["']?\\s*[:=]\\s*["']([A-Za-z0-9_\\-]{16,80})["']/gi;
    let m, n = 0;
    while ((m = re.exec(html)) && n < 5) { found['html#' + (++n)] = m[1]; }
  } catch (e) { found['html:error'] = String(e).slice(0, 120) }

  return found;
})()`;

// Пассивный перехват: включаем Network, перезагружаем портфель и смотрим,
// в каком запросе или ответе приложение само носит токен. Ничего не отправляем.
async function sniffToken(cdp, seconds = 15, verbose = false) {
  const reqHits = [], respHits = [];
  const pick = (obj) => {
    const out = {};
    for (const k of Object.keys(obj || {})) if (/csrf|xsrf/i.test(k)) out[k] = obj[k];
    return Object.keys(out).length ? out : null;
  };
  cdp.on('Network.requestWillBeSent', p => {
    const h = pick(p.request && p.request.headers);
    if (h) reqHits.push({ url: (p.request.url || '').slice(0, 90), method: p.request.method, headers: h });
  });
  cdp.on('Network.responseReceived', p => {
    const h = pick(p.response && p.response.headers);
    if (h) respHits.push({ url: (p.response.url || '').slice(0, 90), status: p.response.status, headers: h });
  });

  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Page.enable').catch(() => {});
  log(`слушаю сеть ${seconds} с, перезагружаю страницу…`);
  await cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
  // в тихом режиме выходим сразу, как только токен пойман, — не ждём весь интервал
  for (let t = 0; t < seconds * 10; t++) {
    await sleep(100);
    if (!verbose && reqHits.length) break;
  }

  // куки, включая HttpOnly — document.cookie их не видит, а CDP видит
  let cookieHits = [];
  try {
    const { cookies } = await cdp.send('Network.getAllCookies');
    cookieHits = (cookies || []).filter(c => /csrf|xsrf/i.test(c.name))
      .map(c => ({ name: c.name, domain: c.domain, httpOnly: c.httpOnly, value: c.value }));
  } catch (e) {}

  await cdp.send('Network.disable').catch(() => {});

  if (verbose) {
    console.log('\n— запросы, несущие токен —');
    if (!reqHits.length) console.log('  (нет)');
    reqHits.slice(0, 25).forEach(h => console.log(' ', h.method, h.url, JSON.stringify(h.headers)));
    console.log('\n— ответы, отдающие токен —');
    if (!respHits.length) console.log('  (нет)');
    respHits.slice(0, 25).forEach(h => console.log(' ', h.status, h.url, JSON.stringify(h.headers)));
    console.log('\n— куки (видно и HttpOnly) —');
    if (!cookieHits.length) console.log('  (нет)');
    cookieHits.forEach(c => console.log(' ', c.name, c.domain, 'httpOnly=' + c.httpOnly, c.value));
  }

  const fromReq = reqHits.map(h => Object.values(h.headers)[0]).find(Boolean);
  const fromResp = respHits.map(h => Object.values(h.headers)[0]).find(Boolean);
  const fromCookie = cookieHits.map(c => c.value).find(Boolean);
  const token = fromReq || fromResp || fromCookie || null;
  const source = fromReq ? 'запрос приложения' : fromResp ? 'заголовок ответа' : fromCookie ? 'кука' : null;
  return { token, source, reqHits, respHits, cookieHits };
}

async function getCsrf(cdp) {
  const found = await cdp.evaluate(FIND_CSRF).catch(e => ({ error: String(e) }));
  const keys = Object.keys(found).filter(k => !/error/i.test(k) && found[k]);
  // предпочитаем то, что похоже на токен из перехваченного запроса: длина 30–45, есть дефис
  const rank = k => (/html/.test(k) ? 0 : /meta/.test(k) ? 1 : /js:|win\./.test(k) ? 2 : 3);
  keys.sort((a, b) => rank(a) - rank(b));
  if (keys.length) return { token: found[keys[0]], source: keys[0], all: found };
  // в странице токена нет — ловим его из живого трафика приложения
  const s = await sniffToken(cdp, Number(val('listen', 15)), false);
  if (s.token) return { token: s.token, source: s.source, all: { [s.source]: s.token } };
  return { token: null, source: null, all: found };
}


// ─── работы, которые хотя бы раз продались ───────────────────
// Их метаданные не трогаем: они уже нашли своего покупателя, любая правка —
// риск сбить сложившееся ранжирование ради гипотезы.
function loadSold() {
  if (CFG.noSkipSold) { log('ВНИМАНИЕ: защита проданных работ отключена ключом --no-skip-sold'); return new Set(); }
  if (!fs.existsSync(CFG.sold)) {
    log(`!!! не найден список проданных (${CFG.sold}) — правка остановлена.`);
    log('    Пропустить защиту осознанно: --no-skip-sold. Указать другой файл: --soldlist <путь>');
    throw new Error('нет списка проданных работ');
  }
  const set = new Set();
  for (const r of parseCSV(fs.readFileSync(CFG.sold, 'utf8'))) if (r.media_id) set.add(String(r.media_id).trim());
  log(`защищено от правки: ${set.size} работ с продажами`);
  return set;
}

// ─── журнал уже отредактированных ────────────────────────────
// Пишется после КАЖДОГО успешного ответа сервера, поэтому переживает обрыв.
// Повторно работу не трогаем: правка второй раз ничего не даёт, а риск есть.
function loadEdited() {
  if (!fs.existsSync(CFG.edited)) return new Set();
  const set = new Set();
  for (const r of parseCSV(fs.readFileSync(CFG.edited, 'utf8'))) if (r.media_id) set.add(String(r.media_id).trim());
  return set;
}
function markEdited(id, title) {
  const line = [id, new Date().toISOString().slice(0, 19).replace('T', ' '), title].map(csvEsc).join(',') + '\n';
  if (!fs.existsSync(CFG.edited)) fs.writeFileSync(CFG.edited, 'media_id,edited_at,title\n', 'utf8');
  fs.appendFileSync(CFG.edited, line, 'utf8');
}

// ─── превьюшки ───────────────────────────────────────────────
// Качаем из контекста страницы (с куками), пишем на диск как есть.
// Качаем прямо из Node. Через страницу нельзя: as2.ftcdn.net — чужой домен,
// CORS не даёт прочитать тело ответа, поэтому прошлый заход и давал ноль.
// Картинки на CDN отдаются без авторизации, куки не нужны.
async function savePreviews(assets) {
  const list = assets.filter(a => a.thumb && !fs.existsSync(path.join(CFG.prevDir, a.id + '.jpg')));
  if (!list.length) return { ok: 0, err: 0, noUrl: assets.filter(a => !a.thumb).length };
  fs.mkdirSync(CFG.prevDir, { recursive: true });
  let ok = 0, err = 0, firstErr = null;
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async a => {
      try {
        const r = await fetch(a.thumb);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        fs.writeFileSync(path.join(CFG.prevDir, a.id + '.jpg'), Buffer.from(await r.arrayBuffer()));
        ok++;
      } catch (e) { err++; if (!firstErr) firstErr = a.id + ': ' + e.message; }
    }));
    await sleep(200);
  }
  if (err && firstErr) log(`  превью: ошибок ${err}, первая — ${firstErr}`);
  return { ok, err, noUrl: assets.filter(a => !a.thumb).length };
}

// Запасной путь: если CDN не отдаёт картинки напрямую (403 по IP или подписанная ссылка),
// берём их из самого браузера — он их и так грузит. Тело ответа достаём через
// отладочный протокол, минуя CORS: это сетевой слой, а не JS страницы.
async function savePreviewsCDP(cdp, assets) {
  const want = new Map();
  for (const a of assets) if (a.thumb && !fs.existsSync(path.join(CFG.prevDir, a.id + '.jpg'))) want.set(a.thumb, a.id);
  if (!want.size) return { ok: 0, err: 0, noUrl: 0 };
  fs.mkdirSync(CFG.prevDir, { recursive: true });

  const urlOf = new Map(), jobs = [];
  let ok = 0;
  const onResp = p => { if (p.response && want.has(p.response.url)) urlOf.set(p.requestId, p.response.url); };
  const onDone = p => {
    if (!urlOf.has(p.requestId)) return;
    const url = urlOf.get(p.requestId); urlOf.delete(p.requestId);
    jobs.push((async () => {
      try {
        const r = await cdp.send('Network.getResponseBody', { requestId: p.requestId });
        fs.writeFileSync(path.join(CFG.prevDir, want.get(url) + '.jpg'),
          Buffer.from(r.body, r.base64Encoded ? 'base64' : 'binary'));
        ok++;
      } catch (e) {}
    })());
  };
  cdp.on('Network.responseReceived', onResp);
  cdp.on('Network.loadingFinished', onDone);
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});

  // прокрутка: без неё браузер не запросит картинки, которых нет на экране
  await cdp.evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const H=document.body.scrollHeight;
    for(let y=0;y<H;y+=500){window.scrollTo(0,y);await s(150)}
    window.scrollTo(0,0);await s(500);return 1;})()`).catch(() => {});
  await sleep(3000);
  await Promise.all(jobs);

  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});
  await cdp.send('Network.disable').catch(() => {});
  cdp.handlers.delete('Network.responseReceived');
  cdp.handlers.delete('Network.loadingFinished');
  return { ok, err: want.size - ok, noUrl: assets.filter(a => !a.thumb).length };
}

// ─── отклонённые работы ──────────────────────────────────────
// Нужны их даты: по ним видно, когда заливки шли и когда прекратились.
const REJ = `(() => {
  // Ищем не карточки, а МАССИВ работ в пропсах: он один и содержит всю страницу.
  let best = [];
  const nodes = document.querySelectorAll('div');
  for (let i = 0; i < nodes.length && i < 4000; i++) {
    const el = nodes[i];
    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!fk) continue;
    let f = el[fk], h = 0;
    while (f && h < 25) {
      const p = f.memoizedProps;
      if (p && typeof p === 'object') {
        for (const key of Object.keys(p)) {
          const v = p[key];
          if (Array.isArray(v) && v.length > best.length && v[0] && typeof v[0] === 'object'
              && v[0].id && (v[0].originalName || v[0].original_name)) best = v;
        }
      }
      f = f.return; h++;
    }
  }
  const reasonOf = a => (a.moderationHistory && a.moderationHistory.causeLabel) || '';
  const fields = best.length ? Object.fromEntries(Object.entries(best[0]).map(([k, v]) =>
    [k, v === null ? 'null' : Array.isArray(v) ? 'array[' + v.length + ']' : typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 80)])) : {};
  return {
    count: best.length,
    fields,
    items: best.map(a => ({
      id: a.id,
      name: a.originalName || a.original_name || '',
      created: a.creationDate || '',
      status: a.status || a.state_label || '',
      reason: reasonOf(a),
      title: (a.title || '').slice(0, 70),
      kw: Array.isArray(a.keywords) ? a.keywords.length : 0,
    })),
  };
})()`;


// Разведка страницы отклонённых: где написана причина и сколько их всего.
const REJPROBE = `(() => {
  const out = {};
  const menu = document.querySelector('[data-t="sub_menu_rejected"]');
  out['пункт меню'] = menu ? menu.innerText.replace(/\\s+/g, ' ').slice(0, 80) : '(нет)';
  const tabs = {};
  ['sub_menu_new','sub_menu_in_review','sub_menu_rejected','sub_menu_upload_failures'].forEach(t => {
    const e = document.querySelector('[data-t="' + t + '"]');
    if (e) tabs[t] = e.innerText.replace(/\\s+/g, ' ').slice(0, 60);
  });
  out['вкладки'] = tabs;
  const hits = [];
  document.querySelectorAll('div,span,p,li').forEach(e => {
    if (e.children.length) return;
    const t = (e.innerText || '').trim();
    if (t && /similar|refus|reject|отклон|tech problem|quality/i.test(t) && t.length < 90) hits.push(t);
  });
  out['текст с причиной на странице'] = [...new Set(hits)].slice(0, 15);
  out['текст всей страницы (начало)'] = (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 900);
  return out;
})()`;

async function rejected(cdp, from, to) {
  // Причина отказа приходит в JSON-ответе самого кабинета, а в пропсах она есть
  // не у всех карточек. Поэтому слушаем сеть и достаём causeLabel оттуда.
  const causes = new Map();
  const urlOf = new Map(), jobs = [];
  const collect = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(collect); return; }
    const mh = o.moderationHistory;
    if (o.id && mh && typeof mh === 'object' && mh.causeLabel) causes.set(String(o.id), mh.causeLabel);
    for (const k in o) { try { collect(o[k]) } catch (e) {} }
  };
  cdp.on('Network.responseReceived', p => {
    const u = p.response && p.response.url || '';
    const ct = (p.response && p.response.headers && (p.response.headers['content-type'] || p.response.headers['Content-Type'])) || '';
    if (u.includes(CFG.host) && /json/i.test(ct)) urlOf.set(p.requestId, u);
  });
  cdp.on('Network.loadingFinished', p => {
    if (!urlOf.has(p.requestId)) return;
    urlOf.delete(p.requestId);
    jobs.push((async () => {
      try {
        const r = await cdp.send('Network.getResponseBody', { requestId: p.requestId });
        collect(JSON.parse(r.body));
      } catch (e) {}
    })());
  });
  await cdp.send('Network.enable').catch(() => {});

  const rows = [];
  for (let p = from; p <= to; p++) {
    await cdp.send('Page.navigate', { url: `https://${CFG.host}/en/uploads/rejected?limit=100&page=${p}` }).catch(() => {});
    await sleep(4500);
    await Promise.all(jobs.splice(0));
    const r = await cdp.evaluate(REJ).catch(e => ({ count: 0, items: [], error: String(e) }));
    if (!r.count) { log(`страница ${p}: пусто, останавливаюсь`); break; }
    for (const it of r.items) if (!it.reason && causes.has(String(it.id))) it.reason = causes.get(String(it.id));
    rows.push(...r.items);
    const d = t => t ? new Date(Number(t)).toISOString().slice(0, 10) : '?';
    const f = r.items[0], l = r.items[r.items.length - 1];
    const known = r.items.filter(x => x.reason).length;
    log(`стр ${p}: ${r.count} шт | ${d(f.created)} … ${d(l.created)} | причина известна у ${known}`);
    await sleep(500);
  }
  await Promise.all(jobs.splice(0));
  await cdp.send('Network.disable').catch(() => {});
  cdp.handlers.delete('Network.responseReceived');
  cdp.handlers.delete('Network.loadingFinished');

  for (const r of rows) if (!r.reason && causes.has(String(r.id))) r.reason = causes.get(String(r.id));
  if (rows.length) {
    const out = path.join(__dirname, 'rejected_dump.csv');
    // дозаписываем: прошлые прогоны не теряем, объединяем по id
    if (fs.existsSync(out)) {
      const have = new Set(rows.map(r => String(r.id)));
      for (const r of parseCSV(fs.readFileSync(out, 'utf8'))) {
        if (!have.has(String(r.id))) rows.push({ id: r.id, name: r.name, created: r.created, status: r.status, reason: r.reason, title: r.title, kw: r.kw });
      }
      rows.sort((a, b) => Number(b.created || 0) - Number(a.created || 0));
    }
    fs.writeFileSync(out, 'id,name,created,status,reason,title,kw\n' +
      rows.map(r => [r.id, r.name, r.created, r.status, r.reason, r.title, r.kw].map(csvEsc).join(',')).join('\n') + '\n', 'utf8');
    log(`записано ${rows.length} отклонённых в ${out}, причина известна у ${rows.filter(r => r.reason).length}`);
  }
}

// ─── контактные листы ────────────────────────────────────────
// Собираем превью в сетку и снимаем скриншот силами самого браузера:
// так 500 картинок превращаются в два десятка листов, которые удобно смотреть.
async function makeSheets(cdp, perSheet = 20) {
  const dir = CFG.prevDir, outDir = path.join(dir, 'sheets');
  if (!fs.existsSync(dir)) throw new Error('нет папки превью: ' + dir);
  let files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
  if (!files.length) throw new Error('в папке превью пусто — прогони --harvest');

  // По умолчанию собираем листы только из того, что ещё предстоит разобрать:
  // иначе с каждым прогоном нумерация листов съезжает и ссылаться на них нельзя.
  if (!has('all')) {
    const done = loadEdited();
    let soldSet = new Set();
    try { soldSet = loadSold(); } catch (e) {}
    const skip = f => { const id = f.replace(/\.jpg$/, ''); return done.has(id) || soldSet.has(id); };
    const was = files.length;
    files = files.filter(f => !skip(f));
    log(`превью всего ${was}, к разбору ${files.length} (исключены отредактированные и проданные)`);
    if (!files.length) { log('всё разобрано — нечего собирать'); return; }
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^sheet_\d+\.jpg$/.test(f)) fs.unlinkSync(path.join(outDir, f));

  await cdp.send('Page.enable').catch(() => {});
  const index = [];
  const total = Math.ceil(files.length / perSheet);
  log(`${files.length} превью → ${total} листов по ${perSheet}`);

  for (let s = 0; s < total; s++) {
    const chunk = files.slice(s * perSheet, (s + 1) * perSheet).map(f => ({
      id: f.replace(/\.jpg$/, ''),
      b64: fs.readFileSync(path.join(dir, f)).toString('base64'),
    }));
    const expr = `(() => {
      const items = ${JSON.stringify(chunk)};
      document.open();
      document.write('<html><body style="margin:0;background:#1a1a1a"><div id="g"></div></body></html>');
      document.close();
      const g = document.getElementById('g');
      g.style.cssText = 'display:grid;grid-template-columns:repeat(5,400px);gap:6px;padding:6px';
      for (const it of items) {
        const d = document.createElement('div');
        d.style.cssText = 'background:#000';
        const im = document.createElement('img');
        im.src = 'data:image/jpeg;base64,' + it.b64;
        im.style.cssText = 'width:400px;height:300px;object-fit:contain;display:block';
        const c = document.createElement('div');
        c.textContent = it.id;
        c.style.cssText = 'color:#ddd;font:13px monospace;text-align:center;padding:3px';
        d.appendChild(im); d.appendChild(c); g.appendChild(d);
      }
      return document.documentElement.scrollHeight;
    })()`;
    const h = await cdp.evaluate(expr);
    await sleep(700);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg', quality: 82, captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 2042, height: h, scale: 1 },
    });
    const name = 'sheet_' + String(s + 1).padStart(2, '0') + '.jpg';
    fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.data, 'base64'));
    index.push([name, chunk.map(c => c.id).join(' ')]);
    log(`лист ${s + 1}/${total} → ${name}`);
  }
  fs.writeFileSync(path.join(outDir, 'index.csv'),
    'sheet,media_ids\n' + index.map(r => r.map(csvEsc).join(',')).join('\n') + '\n', 'utf8');
  log(`листы лежат в ${outDir}`);
  await cdp.goto(`https://${CFG.host}/en/portfolio?limit=100&page=1&sort_by=create_desc`).catch(() => {});
}

let viaCDP = has('via-browser');

async function harvest(cdp, from, to) {
  const rows = [];
  for (let p = from; p <= to; p++) {
    const n = await cdp.goto(`https://${CFG.host}/en/portfolio?limit=100&page=${p}&sort_by=create_desc`);
    if (!n) { log(`страница ${p}: пусто, останавливаюсь`); break; }
    await sleep(800);
    // ссылки на картинки лежат в самом объекте работы, прокрутка не нужна
    const assets = await cdp.evaluate(EXTRACT);
    rows.push(...assets);
    let note = '';
    if (!CFG.noPrev) {
      let pv;
      if (!viaCDP) {
        pv = await savePreviews(assets);
        if (pv.ok === 0 && pv.err > 0) {
          log('  CDN не отдаёт картинки напрямую — перехожу на выкачивание через браузер');
          viaCDP = true;
        }
      }
      if (viaCDP) pv = await savePreviewsCDP(cdp, assets);
      note = `, превью +${pv.ok}${pv.err ? ` (не вышло ${pv.err})` : ''}${pv.noUrl ? ` (без ссылки ${pv.noUrl})` : ''}`;
    }
    log(`страница ${p}: ${assets.length} работ (всего ${rows.length})${note}`);
    await sleep(1000);
  }
  if (!CFG.noPrev) log(`превьюшки лежат в ${CFG.prevDir}`);
  // Страницы портфеля СДВИГАЮТСЯ при каждой новой заливке, поэтому дамп не перезаписываем,
  // а сливаем по media_id: накопленное за прошлые прогоны не теряется.
  const merged = new Map();
  if (fs.existsSync(CFG.dump)) {
    for (const r of parseCSV(fs.readFileSync(CFG.dump, 'utf8'))) {
      if (r.media_id) merged.set(String(r.media_id), r);
    }
  }
  const before = merged.size;
  for (const r of rows) merged.set(String(r.id), {
    media_id: r.id, uuid: r.uuid, category: r.category,
    filename: r.filename || '', title: r.title, keywords: r.keywords.join(', '),
  });
  const all = [...merged.values()].sort((a, b) => Number(b.media_id) - Number(a.media_id));
  fs.writeFileSync(CFG.dump,
    'media_id,uuid,category,filename,title,keywords\n' +
    all.map(r => [r.media_id, r.uuid, r.category, r.filename, r.title, r.keywords].map(csvEsc).join(',')).join('\n') + '\n',
    'utf8');
  log(`собрано ${rows.length} работ, из них новых ${merged.size - before}; всего в дампе ${merged.size}`);
}

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift().map(h => h.trim().toLowerCase());
  return rows.filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

async function apply(cdp, csvPath) {
  let csrf = null;
  const live = await getCsrf(cdp);
  if (live.token) { csrf = live.token; log(`csrf взят живьём из ${live.source}: ${csrf.slice(0, 8)}…`); }
  else if (fs.existsSync(CFG.tpl)) {
    const tpl = JSON.parse(fs.readFileSync(CFG.tpl, 'utf8'));
    csrf = tpl.headers['csrf-token'] || tpl.headers['Csrf-Token'];
    log('живой csrf не найден, беру из template.json (может быть протухшим)');
  }
  if (!csrf) throw new Error('csrf-token не найден нигде — прогони: node adobe_edit.js --token');

  let dump = {};
  if (fs.existsSync(CFG.dump)) {
    for (const r of parseCSV(fs.readFileSync(CFG.dump, 'utf8'))) dump[r.media_id] = r;
    log(`справочник uuid: ${Object.keys(dump).length} работ из portfolio_dump.csv`);
  }

  const soldSet = loadSold();
  const editedSet = CFG.redo ? new Set() : loadEdited();
  if (editedSet.size) log(`уже отредактировано ранее: ${editedSet.size} работ`);
  if (CFG.redo) log('ВНИМАНИЕ: --redo, журнал ранее отредактированных игнорируется');

  let rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  const before = rows.length;
  const skipped = rows.filter(r => soldSet.has(String(r.media_id).trim()));
  rows = rows.filter(r => !soldSet.has(String(r.media_id).trim()));
  if (skipped.length) {
    log(`пропущено как проданные: ${skipped.length} из ${before} → ${skipped.slice(0, 10).map(r => r.media_id).join(', ')}${skipped.length > 10 ? ' …' : ''}`);
    fs.writeFileSync(path.join(__dirname, 'skipped_sold.csv'),
      'media_id\n' + skipped.map(r => r.media_id).join('\n') + '\n', 'utf8');
  }
  const dup = rows.filter(r => editedSet.has(String(r.media_id).trim()));
  rows = rows.filter(r => !editedSet.has(String(r.media_id).trim()));
  if (dup.length) log(`пропущено как уже отредактированные: ${dup.length} → ${dup.slice(0, 8).map(r => r.media_id).join(', ')}${dup.length > 8 ? ' …' : ''}`);
  if (CFG.limit) rows = rows.slice(0, CFG.limit);
  if (!rows.length) { log('нечего делать: всё из этого файла уже обработано'); return; }
  log(`к обработке ${rows.length} работ, пауза ${CFG.delay} мс, dry=${CFG.dry}`);

  const report = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = r.media_id;
    const d = dump[id] || {};
    const uuid = r.uuid || d.uuid;
    if (!uuid) { report.push({ id, ok: false, error: 'нет uuid — прогони --harvest' }); log(`${i + 1}/${rows.length} ${id} — нет uuid`); continue; }

    const body = { contentUuid: uuid };
    body.title = r.title || d.title || '';
    body.category = Number(r.category || d.category);
    const kw = (r.keywords || d.keywords || '').split(',').map(s => s.trim()).filter(Boolean);
    if (kw.length) body.keywords = kw;

    // канал API = ручная правка, лимит 70 и запрет запятых здесь НЕ действуют (это правила CSV-импорта)
    if (!body.title || body.title.length > 200) {
      report.push({ id, ok: false, error: 'пустой заголовок или >200 символов' });
      log(`${i + 1}/${rows.length} ${id} — заголовок не проходит лимит`); continue;
    }
    if (CFG.dry) {
      log(`${i + 1}/${rows.length} ${id} DRY`, JSON.stringify(body).slice(0, 160));
      report.push({ id, ok: true, dry: true, body }); continue;
    }

    const mkExpr = tok => `(async()=>{const r=await fetch(${JSON.stringify('/en/content/' + id + '/details')},{
      method:'POST',credentials:'include',
      headers:{'Content-Type':'application/json','Accept':'application/json','X-Requested-With':'XMLHTTPRequest','csrf-token':${JSON.stringify(tok)}},
      body:${JSON.stringify(JSON.stringify(body))}});
      const t=await r.text().catch(()=>'');
      const h={};r.headers.forEach((v,k)=>{if(/csrf|token/i.test(k))h[k]=v});
      return {status:r.status,ok:r.ok,body:t.slice(0,300),respHeaders:h};})()`;
    try {
      let res = await cdp.evaluate(mkExpr(csrf));
      // токен протух — перечитать живой и повторить один раз
      if (!res.ok && /CSRF/i.test(res.body || '')) {
        const again = await getCsrf(cdp);
        const fresh = Object.values(again.all || {}).find(v => v && v !== csrf) || again.token;
        if (fresh && fresh !== csrf) {
          log(`  csrf протух, беру новый из ${again.source} и повторяю`);
          csrf = fresh;
          res = await cdp.evaluate(mkExpr(csrf));
        }
      }
      report.push({ id, ...res });
      if (res.ok) markEdited(id, body.title);
      log(`${i + 1}/${rows.length} ${id} → HTTP ${res.status}${res.ok ? '' : ' ' + res.body}`);
    } catch (e) {
      report.push({ id, ok: false, error: String(e) });
      log(`${i + 1}/${rows.length} ${id} ОШИБКА ${e.message}`);
    }
    fs.writeFileSync(CFG.out, JSON.stringify(report, null, 2));
    await sleep(CFG.delay);
  }
  const ok = report.filter(r => r.ok).length;
  log(`готово: ${ok} успешно, ${report.length - ok} с ошибкой. Отчёт: ${CFG.out}`);
}

(async () => {
  const cdp = await CDP.attach(CFG.browser, CFG.host);
  try {
    if (has('harvest')) {
      const i = argv.indexOf('--harvest');
      await harvest(cdp, Number(argv[i + 1] || 1), Number(argv[i + 2] || argv[i + 1] || 1));
    } else if (has('rejected')) {
      const i = argv.indexOf('--rejected');
      await rejected(cdp, Number(argv[i + 1] || 1), Number(argv[i + 2] || argv[i + 1] || 1));
    } else if (has('rejprobe')) {
      await cdp.send('Page.navigate', { url: `https://${CFG.host}/en/uploads/rejected?limit=100&page=1` }).catch(() => {});
      await sleep(6000);
      const r = await cdp.evaluate(REJPROBE);
      console.log(JSON.stringify(r, null, 2));
    } else if (has('sheets')) {
      await makeSheets(cdp, Number(val('per', 20)));
    } else if (has('fields')) {
      const f = await cdp.evaluate(FIELDS);
      console.log(typeof f === 'string' ? f : Object.entries(f).map(([k, v]) => '  ' + k.padEnd(28) + v).join('\n'));
    } else if (has('sniff')) {
      const s = await sniffToken(cdp, Number(val('listen', 20)), true);
      console.log('\nИтог:', s.source || 'ничего не поймано', '→', s.token);
    } else if (has('token')) {
      const r = await getCsrf(cdp);
      console.log('Найденные кандидаты на csrf-token:');
      for (const [k, v] of Object.entries(r.all)) console.log('  ' + k.padEnd(42), v);
      console.log('\nВыбран:', r.source, '→', r.token);
    } else if (has('apply')) {
      await apply(cdp, val('apply'));
    } else {
      console.log('  node adobe_edit.js --token');
      console.log('  node adobe_edit.js --harvest 1 5');
      console.log('  node adobe_edit.js --apply updates.csv --dry');
      console.log('  node adobe_edit.js --apply updates.csv');
    }
  } catch (e) { console.error('ОШИБКА', e.message); }
  finally { cdp.close(); }
})();