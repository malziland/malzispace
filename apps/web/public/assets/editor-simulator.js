/* Local editor simulator + full toolbar smoke tests */
(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search || '');
  const SKIP_AUTO_TESTS = params.get('skipAuto') === '1';
  const RESET_STATE = params.get('reset') === '1';
  const SIM_STORAGE_KEY = '__MZ_EDITOR_SIM_STATE_V2__';

  function toB64Url(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64Url(b64url) {
    const b64 = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 2 ? '==' : (b64.length % 4 === 3 ? '=' : '');
    const bin = atob(b64 + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function ensureHashKey() {
    const current = String(window.location.hash || '').replace(/^#/, '');
    if (current.length >= 43) return;
    const raw = new Uint8Array(32);
    (window.crypto || crypto).getRandomValues(raw);
    const key = toB64Url(raw);
    try {
      const next = new URL(window.location.href);
      next.hash = key;
      window.history.replaceState(null, '', next.toString());
    } catch (e) {
      window.location.hash = key;
    }
  }

  function getHashKeyBytes() {
    const h = String(window.location.hash || '').replace(/^#/, '');
    if (!h) return null;
    try {
      const bytes = fromB64Url(h);
      if (bytes.length < 32) return null;
      return bytes.length > 32 ? bytes.slice(0, 32) : bytes;
    } catch (e) {
      return null;
    }
  }

  async function decryptEncryptedContent(cipherB64, nonceB64) {
    try {
      const keyBytes = getHashKeyBytes();
      if (!keyBytes) return null;
      const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      const iv = fromB64Url(nonceB64);
      const cipher = fromB64Url(cipherB64);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      return new TextDecoder().decode(new Uint8Array(plain));
    } catch (e) {
      return null;
    }
  }

  function defaultState() {
    return {
      version: 1,
      title: 'Simulator',
      content: '<p>Alpha Beta Gamma</p>'
    };
  }

  function loadState() {
    if (RESET_STATE) {
      try { localStorage.removeItem(SIM_STORAGE_KEY); } catch (e) {}
      return defaultState();
    }
    try {
      const raw = localStorage.getItem(SIM_STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaultState();
      return {
        version: Number.isFinite(parsed.version) ? parsed.version : 1,
        title: typeof parsed.title === 'string' ? parsed.title : 'Simulator',
        content: typeof parsed.content === 'string' ? parsed.content : '<p>Alpha Beta Gamma</p>'
      };
    } catch (e) {
      return defaultState();
    }
  }

  function saveState(state) {
    try { localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function installClipboardShim() {
    const memory = {
      text: '',
      html: '',
      wrote: false,
      writeText: async function (text) {
        memory.text = String(text || '');
        memory.html = '';
        memory.wrote = true;
      },
      write: async function (items) {
        memory.text = '';
        memory.html = '[rich]';
        memory.wrote = true;
        return items;
      },
      readText: async function () {
        return memory.text || '';
      }
    };
    window.__MZ_SIM_CLIPBOARD__ = memory;
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: memory
      });
    } catch (e) {}
  }

  ensureHashKey();
  installClipboardShim();

  window.SPACE_ID = 'simtest01';
  window.MZ_FLAGS = { enableCrdt: false, enableWs: false, enablePresence: false };
  window.__MZ_getAppCheckHeaders__ = async function () { return {}; };

  const simState = loadState();
  saveState(simState);

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : String((input && input.url) || '');
    const method = String((init && init.method) || 'GET').toUpperCase();
    let payload = { ok: true };

    if (url.includes('/api/load')) {
      payload = {
        version: simState.version,
        zk: false,
        title: simState.title,
        content: simState.content
      };
    } else if (url.includes('/api/save') && method === 'POST') {
      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
      if (body.title_enc && body.title_nonce) {
        const decTitle = await decryptEncryptedContent(body.title_enc, body.title_nonce);
        if (typeof decTitle === 'string') simState.title = decTitle;
      } else if (typeof body.title === 'string') {
        simState.title = body.title;
      }

      let nextContent = null;
      if (typeof body.content === 'string') {
        nextContent = body.content;
      } else if (body && typeof body.content_enc === 'string' && typeof body.content_nonce === 'string') {
        nextContent = await decryptEncryptedContent(body.content_enc, body.content_nonce);
      }
      if (typeof nextContent === 'string') simState.content = nextContent;

      simState.version += 1;
      saveState(simState);
      payload = { version: simState.version };
    } else if (url.includes('/api/title') && method === 'POST') {
      let body = {};
      try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
      if (body.title_enc && body.title_nonce) {
        const decTitle = await decryptEncryptedContent(body.title_enc, body.title_nonce);
        if (typeof decTitle === 'string') simState.title = decTitle;
      } else if (typeof body.title === 'string') {
        simState.title = body.title;
      }
      simState.version += 1;
      saveState(simState);
      payload = { ok: true };
    } else if (url.includes('/api/presence')) {
      payload = { count: 1 };
    } else if (url.includes('/api/yjs/push')) {
      payload = { ok: true, ts: Date.now() };
    } else if (url.includes('/api/yjs/pull')) {
      payload = { updates: [], fulls: [] };
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setEditorHtml(html) {
    const editor = document.getElementById('editor');
    if (!editor) return;
    editor.innerHTML = html;
    editor.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function getEditorHtml() {
    const editor = document.getElementById('editor');
    return editor ? editor.innerHTML : '';
  }

  function getLineNumbers() {
    return Array.from(document.querySelectorAll('#lineNumbersInner .line-number'))
      .map((el) => Number((el.textContent || '').trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  function firstLineAligned() {
    const editor = document.getElementById('editor');
    const line = document.querySelector('#lineNumbersInner .line-number');
    if (!editor || !line) return false;
    const er = editor.getBoundingClientRect();
    const lr = line.getBoundingClientRect();
    const padTop = parseFloat(getComputedStyle(editor).paddingTop) || 0;
    const delta = Math.abs((lr.top - er.top) - padTop);
    return delta <= 2;
  }

  function firstTextNodeInEditor() {
    const editor = document.getElementById('editor');
    if (!editor) return null;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    return walker.nextNode();
  }

  function selectRange(start, end) {
    const node = firstTextNodeInEditor();
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    const s = Math.max(0, Math.min(start, node.nodeValue.length));
    const e = Math.max(s, Math.min(end, node.nodeValue.length));
    const range = document.createRange();
    range.setStart(node, s);
    range.setEnd(node, e);
    const sel = window.getSelection && window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function setCaret(pos) {
    return selectRange(pos, pos);
  }

  function clickToolbarButton(selector) {
    const btn = document.querySelector(selector);
    if (!btn) return false;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }

  function applyColor(inputId, color) {
    const input = document.getElementById(inputId);
    if (!input) return false;
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.value = color;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function renderResults(items) {
    const el = document.getElementById('simResults');
    if (!el) return;
    const passCount = items.filter((i) => i.pass).length;
    const total = items.length;
    const summaryClass = passCount === total ? 'ok' : 'fail';
    const rows = items
      .map((i) => '<li class="' + (i.pass ? 'ok' : 'fail') + '"><strong>' + (i.pass ? 'OK' : 'FAIL') + '</strong> ' + i.name + (i.detail ? ' <code>' + i.detail + '</code>' : '') + '</li>')
      .join('');
    el.innerHTML = '<div class="' + summaryClass + '">Ergebnis: ' + passCount + '/' + total + ' Tests erfolgreich</div><ul>' + rows + '</ul>';
  }

  async function runSimTests() {
    const results = [];
    async function test(name, fn, check) {
      try {
        setEditorHtml('<p>Alpha Beta Gamma</p>');
        await wait(50);
        await fn();
        await wait(70);
        const html = getEditorHtml();
        let pass = false;
        if (check instanceof RegExp) {
          pass = check.test(html);
        } else {
          const outcome = check(html);
          pass = (outcome && typeof outcome.then === 'function') ? !!(await outcome) : !!outcome;
        }
        results.push({ name, pass, html });
      } catch (err) {
        results.push({ name, pass: false, html: getEditorHtml(), detail: String((err && err.message) || err || 'error') });
      }
    }

    await test('Fett', async function () {
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="bold"]');
    }, /<strong|<b>|class="[^"]*\bmz-fw-bold\b/i);

    await test('Zeilennummern Start', async function () {
      setEditorHtml('');
      await wait(40);
    }, function () {
      const nums = getLineNumbers();
      return nums.length >= 1 && nums[0] === 1 && firstLineAligned();
    });

    await test('Zeilennummern Remote-Update', async function () {
      setEditorHtml('<p>A</p><p>B</p><p>C</p><p>D</p><p>E</p>');
      await wait(40);
    }, function () {
      const nums = getLineNumbers();
      return nums.length >= 5 && nums[0] === 1 && nums[1] === 2 && nums[4] === 5;
    });

    await test('Zeilennummern Enter Leerzeile', async function () {
      setEditorHtml('<p>Alpha</p>');
      await wait(20);
      setCaret(5);
      document.execCommand('insertParagraph');
      document.getElementById('editor').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(70);
    }, function () {
      const nums = getLineNumbers();
      return nums.length === 2 && nums[0] === 1 && nums[1] === 2;
    });

    await test('Kursiv', async function () {
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="italic"]');
    }, /<em>|<i>|class="[^"]*\bmz-fs-italic\b/i);

    await test('Unterstrichen', async function () {
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="underline"]');
    }, /<u>|class="[^"]*\bmz-td-underline\b/i);

    await test('Aufzaehlung', async function () {
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="insertUnorderedList"]');
    }, /<ul|<li/i);

    await test('Aufzaehlung aus', async function () {
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="insertUnorderedList"]');
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="insertUnorderedList"]');
    }, function (html) {
      return !/<ul/i.test(html) && /Alpha Beta Gamma/i.test(html);
    });

    await test('Nummerierte Liste', async function () {
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="insertOrderedList"]');
    }, /<ol|<li/i);

    await test('Nummerierte Liste aus', async function () {
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="insertOrderedList"]');
      selectRange(0, 5);
      clickToolbarButton('button[data-cmd="insertOrderedList"]');
    }, function (html) {
      return !/<ol/i.test(html) && /Alpha Beta Gamma/i.test(html);
    });

    await test('Linksbuendig', async function () {
      setCaret(3);
      clickToolbarButton('button[data-cmd="justifyLeft"]');
    }, /data-mz-align="left"/i);

    await test('Zentriert', async function () {
      setCaret(3);
      clickToolbarButton('button[data-cmd="justifyCenter"]');
    }, /data-mz-align="center"/i);

    await test('Rechtsbuendig', async function () {
      setCaret(3);
      clickToolbarButton('button[data-cmd="justifyRight"]');
    }, /data-mz-align="right"/i);

    await test('Blocksatz', async function () {
      setCaret(3);
      clickToolbarButton('button[data-cmd="justifyFull"]');
    }, /data-mz-align="justify"/i);

    await test('Link einfuegen', async function () {
      selectRange(6, 10);
      clickToolbarButton('button[data-cmd="createLink"]');
      await wait(20);
      const input = document.getElementById('linkUrlInput');
      const save = document.getElementById('saveLinkModal');
      if (input) input.value = 'https://example.com';
      if (save) save.click();
    }, /<p>Alpha <a[^>]+href="https:\/\/example\.com\/?">Beta<\/a> Gamma<\/p>/i);

    await test('Link Klick ohne Redirect', async function () {
      setEditorHtml('<p><a href="https://example.com">Example</a></p>');
      const beforeHref = String(window.location.href || '');
      const calls = [];
      const oldOpen = window.open;
      window.open = function (url, target, features) {
        calls.push({ url: String(url || ''), target: String(target || ''), features: String(features || '') });
        return null;
      };
      try{
        const a = document.querySelector('#editor a[href]');
        if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await wait(30);
      } finally {
        window.open = oldOpen;
      }
      window.__MZ_SIM_LINK_CLICK__ = { calls, beforeHref, afterHref: String(window.location.href || '') };
    }, function () {
      const s = window.__MZ_SIM_LINK_CLICK__ || { calls: [] };
      return Array.isArray(s.calls)
        && s.calls.length === 1
        && s.calls[0].target === '_blank'
        && s.beforeHref === s.afterHref;
    });

    await test('Horizontale Linie', async function () {
      setCaret(3);
      clickToolbarButton('button[data-cmd="insertHorizontalRule"]');
    }, /<hr/i);

    await test('QR Modal', async function () {
      const open = document.getElementById('showQr');
      const close = document.getElementById('closeQrModal');
      if (!open || !close) return;
      open.click();
      await wait(80);
      close.click();
      await wait(40);
    }, function () {
      const modal = document.getElementById('qrModal');
      const qr = document.getElementById('qrCode');
      if (!modal || !qr) return false;
      const rendered = qr.childElementCount > 0 || !!(qr.textContent || '').trim();
      return rendered;
    });

    await test('Alles kopieren', async function () {
      const btn = document.getElementById('copyAll');
      if (!btn) return;
      setEditorHtml('<p><strong>Copy Alpha</strong></p>');
      selectRange(0, 4);
      btn.click();
      await wait(60);
    }, function () {
      const clip = window.__MZ_SIM_CLIPBOARD__ || {};
      return !!clip.wrote;
    });

    await test('Paste simuliert', async function () {
      setEditorHtml('<p>Start </p>');
      const editor = document.getElementById('editor');
      if (!editor) return;
      editor.focus();
      let inserted = false;
      try{
        inserted = !!document.execCommand('insertText', false, 'PASTE_TEST');
      }catch(e){}
      if (!inserted) {
        const txt = document.createTextNode('PASTE_TEST');
        editor.appendChild(txt);
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(40);
    }, /PASTE_TEST/i);

    await test('Persistenz Save->Load', async function () {
      setEditorHtml('<p>Persist Alpha</p>');
      selectRange(0, 7);
      clickToolbarButton('button[data-cmd="bold"]');
      await wait(1100);
    }, async function () {
      const res = await window.fetch('/api/load?id=' + encodeURIComponent(window.SPACE_ID || 'simtest01'));
      const data = await res.json();
      const html = String((data && data.content) || '');
      return /Persist/i.test(html)
        && /<strong|<b>|class="[^"]*\bmz-fw-bold\b/i.test(html);
    });
    window.__MZ_SIM_TEST_RESULTS__ = results;
    renderResults(results);
  }

  window.__MZ_SIM_API_READY__ = true;

  window.addEventListener('load', function () {
    if (SKIP_AUTO_TESTS) {
      renderResults([{ name: 'Automatiktests deaktiviert (skipAuto=1)', pass: true }]);
      return;
    }
    runSimTests().catch(function (err) {
      window.__MZ_SIM_TEST_RESULTS__ = [{ name: 'Simulator-Lauf', pass: false, detail: String((err && err.message) || err || 'error') }];
      renderResults(window.__MZ_SIM_TEST_RESULTS__);
    });
  });
})();
