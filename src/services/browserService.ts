/**
 * browserService.ts — Frontend interface to the Playwright browser agent
 * 
 * Manages the browser agent sidecar process and provides a clean API
 * for browser automation commands.
 */

import { Child, Command } from '@tauri-apps/plugin-shell';
import { resolveResource, appDataDir } from '@tauri-apps/api/path';
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';

const BROWSER_AGENT_PORT = 9222;
const WS_URL = `ws://localhost:${BROWSER_AGENT_PORT}`;

let agentProcess: Child | null = null;
let ws: WebSocket | null = null;
let wsReady = false;
let pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
let requestId = 0;

export interface BrowserStatus {
  browserRunning: boolean;
  currentUrl: string | null;
  currentTitle: string | null;
}

export interface BrowserResult {
  success: boolean;
  error?: string;
  message?: string;
  url?: string;
  title?: string;
  content?: string;
  screenshot?: string;
  mimeType?: string;
  browserRunning?: boolean;
  currentUrl?: string | null;
  currentTitle?: string | null;
}

async function sendCommand(cmd: Record<string, unknown>, timeoutMs?: number): Promise<BrowserResult> {
  if (!ws || !wsReady) {
    throw new Error('Browser agent not connected. Call startBrowserAgent() first.');
  }

  // Longer timeout for crawler commands (they visit many pages)
  const isCrawlerCommand = cmd.type === 'crawl' || cmd.type === 'sitemap';
  const commandTimeout = timeoutMs ?? (isCrawlerCommand ? 300000 : 60000); // 5 min for crawlers, 1 min for others

  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Browser command timed out after ${commandTimeout / 1000}s`));
    }, commandTimeout);

    pendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result as BrowserResult);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    // We don't have request IDs in the simple protocol, so we assume
    // responses come in order (single client, single request at a time)
    ws!.send(JSON.stringify(cmd));
  });
}

function connectWebSocket(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && wsReady) {
      resolve();
      return;
    }

    // Close any existing broken connection
    if (ws) {
      ws.close();
      ws = null;
      wsReady = false;
    }

    const timeout = setTimeout(() => {
      if (ws) {
        ws.close();
        ws = null;
      }
      reject(new Error(`WebSocket connection timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      clearTimeout(timeout);
      wsReady = true;
      console.log('[BrowserService] Connected to browser agent');
      resolve();
    };

    ws.onmessage = (event) => {
      try {
        const result = JSON.parse(event.data);
        // Resolve the oldest pending request
        const [id, handlers] = [...pendingRequests.entries()][0] || [];
        if (id !== undefined && handlers) {
          pendingRequests.delete(id);
          handlers.resolve(result);
        }
      } catch (err) {
        console.error('[BrowserService] Failed to parse response:', err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      console.error('[BrowserService] WebSocket error:', err);
      wsReady = false;
      reject(new Error('WebSocket connection failed'));
    };

    ws.onclose = () => {
      console.log('[BrowserService] WebSocket closed');
      wsReady = false;
      ws = null;
    };
  });
}

// The browser agent script - embedded so we don't need external files
const BROWSER_AGENT_SCRIPT = `
const { chromium } = require('playwright');
const WebSocket = require('ws');

const PORT = process.env.BROWSER_AGENT_PORT || 9222;

let browser = null, context = null, page = null;

const DARK_THEME_CSS = \`
  @keyframes codescout-pulse {
    0%, 100% { opacity: 1; background-position: 0% 50%; }
    50% { opacity: 0.85; background-position: 100% 50%; }
  }
  @keyframes codescout-glow {
    0%, 100% { text-shadow: 0 0 10px #00d4ff, 0 0 20px #00d4ff40; }
    50% { text-shadow: 0 0 15px #00d4ff, 0 0 30px #00d4ff60, 0 0 40px #00d4ff30; }
  }
  body::before {
    content: '🤖 CODE SCOUT BROWSER — AI Controlled';
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
    background: linear-gradient(90deg, #0f0f23 0%, #1a1a3e 25%, #16213e 50%, #1a1a3e 75%, #0f0f23 100%);
    background-size: 200% 200%;
    color: #00d4ff; 
    font: 700 14px system-ui, sans-serif;
    padding: 8px 16px; 
    text-align: center; 
    letter-spacing: 2px;
    text-transform: uppercase;
    border-bottom: 2px solid #00d4ff; 
    box-shadow: 0 4px 20px rgba(0,212,255,0.3), inset 0 -1px 0 rgba(0,212,255,0.2);
    animation: codescout-pulse 3s ease-in-out infinite, codescout-glow 2s ease-in-out infinite;
  }
  body { padding-top: 38px !important; }
\`;

async function handleCommand(cmd) {
  try {
    switch (cmd.type) {
      case 'launch': {
        // Check if browser is actually still running
        if (browser && page) {
          try {
            await page.title(); // Test if page is responsive
            return { success: true, message: 'Browser already running' };
          } catch {
            console.log('[BrowserAgent] Browser not responsive, restarting...');
            try { await browser.close(); } catch {}
            browser = null; context = null; page = null;
          }
        }
        
        // Launch fresh browser
        browser = await chromium.launch({
          headless: cmd.headless ?? false,
          args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
        });
        context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        page = await context.newPage();
        await page.addInitScript((css) => {
          // Add Code Scout banner CSS
          const style = document.createElement('style');
          style.id = 'codescout-dark'; style.textContent = css;
          if (document.head) document.head.appendChild(style);
          else document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
          
          // Prepend "Scout: " to page title
          const updateTitle = () => {
            if (document.title && !document.title.startsWith('Scout: ')) {
              document.title = 'Scout: ' + document.title;
            }
          };
          updateTitle();
          new MutationObserver(updateTitle).observe(
            document.querySelector('title') || document.head,
            { subtree: true, childList: true, characterData: true }
          );
        }, DARK_THEME_CSS);
        return { success: true, message: 'Browser launched with Code Scout dark theme' };
      }
      case 'goto': {
        if (!page) return { success: false, error: 'No browser running' };
        await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return { success: true, url: page.url(), title: await page.title() };
      }
      case 'click': {
        if (!page) return { success: false, error: 'No browser running' };
        const sel = cmd.selector;
        
        // Strategy 1: Exact CSS selector
        try { await page.click(sel, { timeout: 3000 }); return { success: true, message: 'Clicked: ' + sel }; } catch {}
        
        // Strategy 2: Text content (button, link, span with text)
        try { await page.getByText(sel, { exact: false }).first().click({ timeout: 3000 }); return { success: true, message: 'Clicked text: ' + sel }; } catch {}
        
        // Strategy 3: Button/link by role with name
        try { await page.getByRole('button', { name: sel }).first().click({ timeout: 3000 }); return { success: true, message: 'Clicked button role: ' + sel }; } catch {}
        try { await page.getByRole('link', { name: sel }).first().click({ timeout: 3000 }); return { success: true, message: 'Clicked link role: ' + sel }; } catch {}
        
        // Strategy 4: Common cookie consent patterns (Google, etc.)
        const cookiePatterns = [
          'Accept all', 'Accept All', 'ACCEPT ALL', 'Acepto todo', 'Alle akzeptieren',
          'Reject all', 'Reject All', 'REJECT ALL', 'Rechazar todo',
          'I agree', 'Agree', 'OK', 'Got it', 'Allow all', 'Allow All',
        ];
        if (cookiePatterns.some(p => sel.toLowerCase().includes(p.toLowerCase()))) {
          // Try multiple selector strategies for cookie buttons
          const cookieSelectors = [
            'button[id*="accept"]', 'button[id*="Accept"]', 'button[id*="agree"]',
            'button[id*="consent"]', 'button[id*="cookie"]',
            '[aria-label*="Accept"]', '[aria-label*="accept"]',
            '[data-testid*="accept"]', '[data-testid*="consent"]',
            'form[action*="consent"] button', 'div[id*="consent"] button',
            '#L2AGLb', // Google's Accept button ID
            'button.tHlp8d', // Google cookie button class
            'div.QS5gu button', // Another Google pattern
          ];
          for (const cssSel of cookieSelectors) {
            try { await page.click(cssSel, { timeout: 2000 }); return { success: true, message: 'Clicked cookie button: ' + cssSel }; } catch {}
          }
        }
        
        // Strategy 5: JavaScript click as last resort
        try {
          const clicked = await page.evaluate((selector) => {
            // Try to find by various methods
            let el = document.querySelector(selector);
            if (!el) {
              // Search by text content
              const allEls = document.querySelectorAll('button, a, [role="button"], input[type="submit"]');
              for (const e of allEls) {
                if (e.textContent?.toLowerCase().includes(selector.toLowerCase())) {
                  el = e; break;
                }
              }
            }
            if (el) { el.click(); return true; }
            return false;
          }, sel);
          if (clicked) return { success: true, message: 'JS clicked: ' + sel };
        } catch {}
        
        return { success: false, error: 'Could not find clickable element: ' + sel };
      }
      case 'fill': {
        if (!page) return { success: false, error: 'No browser running' };
        const sel = cmd.selector;
        const val = cmd.value;
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normSel = normalize(sel);
        
        // Strategy 1: Exact CSS selector (most reliable if from detect_form)
        try { await page.fill(sel, val, { timeout: 3000 }); return { success: true, message: 'Filled: ' + sel }; } catch {}
        
        // Strategy 2: By placeholder text
        try { await page.getByPlaceholder(sel, { exact: false }).first().fill(val, { timeout: 3000 }); return { success: true, message: 'Filled by placeholder' }; } catch {}
        
        // Strategy 3: By label text  
        try { await page.getByLabel(sel, { exact: false }).first().fill(val, { timeout: 3000 }); return { success: true, message: 'Filled by label' }; } catch {}
        
        // Strategy 4: By name attribute
        try { await page.fill('[name="' + sel + '"]', val, { timeout: 3000 }); return { success: true, message: 'Filled by name attr' }; } catch {}
        try { await page.fill('[name*="' + normSel + '"]', val, { timeout: 3000 }); return { success: true, message: 'Filled by name partial' }; } catch {}
        
        // Strategy 5: By ID with common variations
        try { await page.fill('#' + sel.replace(/\\s+/g, '-').toLowerCase(), val, { timeout: 3000 }); return { success: true, message: 'Filled by id variation' }; } catch {}
        try { await page.fill('#' + sel.replace(/\\s+/g, '_').toLowerCase(), val, { timeout: 3000 }); return { success: true, message: 'Filled by id variation' }; } catch {}
        try { await page.fill('#' + normSel, val, { timeout: 3000 }); return { success: true, message: 'Filled by normalized id' }; } catch {}
        
        // Strategy 6: Smart field detection - find the best matching input on page
        try {
          const filled = await page.evaluate(({ searchTerm, value }) => {
            const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normSearch = normalize(searchTerm);
            const inputs = document.querySelectorAll('input, textarea');
            let bestMatch = null, bestScore = 0;
            
            for (const input of inputs) {
              if (input.type === 'hidden' || input.type === 'submit' || input.type === 'button') continue;
              let score = 0;
              const name = input.getAttribute('name') || '';
              const id = input.getAttribute('id') || '';
              const placeholder = input.getAttribute('placeholder') || '';
              const ariaLabel = input.getAttribute('aria-label') || '';
              
              // Check for label element
              let labelText = '';
              if (id) { const lbl = document.querySelector('label[for="' + id + '"]'); if (lbl) labelText = lbl.textContent || ''; }
              if (!labelText) { const parent = input.closest('div, label'); if (parent) { const lbl = parent.querySelector('label'); if (lbl) labelText = lbl.textContent || ''; } }
              
              const fields = [name, id, placeholder, ariaLabel, labelText].map(normalize);
              
              // Exact match gets highest score
              if (fields.some(f => f === normSearch)) score = 100;
              // Contains match
              else if (fields.some(f => f.includes(normSearch) || normSearch.includes(f))) score = 50;
              // Type-based heuristics for common fields
              else {
                const isEmail = normSearch.includes('email') || normSearch.includes('mail');
                const isName = normSearch.includes('name') || normSearch.includes('fullname');
                const isMessage = normSearch.includes('message') || normSearch.includes('comment') || normSearch.includes('text');
                const isPhone = normSearch.includes('phone') || normSearch.includes('tel');
                
                if (isEmail && (input.type === 'email' || fields.some(f => f.includes('email')))) score = 40;
                if (isName && fields.some(f => f.includes('name'))) score = 40;
                if (isMessage && input.tagName === 'TEXTAREA') score = 40;
                if (isPhone && (input.type === 'tel' || fields.some(f => f.includes('phone') || f.includes('tel')))) score = 40;
              }
              
              if (score > bestScore) { bestScore = score; bestMatch = input; }
            }
            
            if (bestMatch && bestScore >= 40) {
              bestMatch.focus();
              bestMatch.value = value;
              bestMatch.dispatchEvent(new Event('input', { bubbles: true }));
              bestMatch.dispatchEvent(new Event('change', { bubbles: true }));
              return { found: true, usedField: bestMatch.name || bestMatch.id || bestMatch.placeholder || '(matched)' };
            }
            return { found: false };
          }, { searchTerm: sel, value: val });
          
          if (filled.found) return { success: true, message: 'Smart-filled: ' + filled.usedField };
        } catch {}
        
        return { success: false, error: 'Could not find input matching: ' + sel + '. Use detect_form first to get exact selectors.' };
      }
      case 'extract': {
        if (!page) return { success: false, error: 'No browser running' };
        let content: string | null | undefined;
        if (cmd.selector) {
          content = await (await page.$(cmd.selector))?.textContent();
        } else {
          content = await page.evaluate(() => {
            const BOILERPLATE = 'script,style,nav,footer,header,aside,[role="navigation"],[role="banner"],[role="contentinfo"],.cookie-banner,.cookie-notice,#cookie-consent,.breadcrumb,.breadcrumbs,.site-header,.site-footer,.nav-bar,.navbar';
            const main = document.querySelector('main,article,[role="main"],.main-content,.page-content,.entry-content,.post-content,#content,#main');
            const root = main || document.body;
            const clone = root.cloneNode(true) as HTMLElement;
            clone.querySelectorAll(BOILERPLATE).forEach(el => el.remove());
            const text = clone.innerText || '';
            return text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 120000);
          });
        }
        return { success: true, title: await page.title(), url: page.url(), content };
      }
      case 'screenshot': {
        if (!page) return { success: false, error: 'No browser running' };
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        return { success: true, screenshot: buffer.toString('base64'), mimeType: 'image/png' };
      }
      case 'scroll': {
        if (!page) return { success: false, error: 'No browser running' };
        await page.evaluate((d) => window.scrollBy(0, d), cmd.direction === 'up' ? -(cmd.amount || 500) : (cmd.amount || 500));
        return { success: true, message: 'Scrolled ' + cmd.direction };
      }
      case 'wait': {
        if (!page) return { success: false, error: 'No browser running' };
        if (cmd.selector) await page.waitForSelector(cmd.selector, { timeout: cmd.timeout || 10000 });
        else await page.waitForTimeout(cmd.ms || 1000);
        return { success: true, message: 'Wait completed' };
      }
      case 'status': return { success: true, browserRunning: !!browser, currentUrl: page?.url(), currentTitle: page ? await page.title() : null };
      case 'captcha_detect': {
        if (!page) return { success: false, error: 'No browser running' };
        const info = await page.evaluate(() => {
          const r = { found: false, type: null };
          if (document.querySelector('iframe[src*="recaptcha"], .g-recaptcha')) { r.found = true; r.type = 'recaptcha_v2'; }
          else if (document.querySelector('iframe[src*="hcaptcha"], .h-captcha')) { r.found = true; r.type = 'hcaptcha'; }
          else if (document.querySelector('.cf-turnstile')) { r.found = true; r.type = 'turnstile'; }
          else if (document.querySelector('img[src*="captcha"], input[name*="captcha" i]')) { r.found = true; r.type = 'image_captcha'; }
          return r;
        });
        if (info.found) {
          const ss = await page.screenshot({ type: 'png', fullPage: false });
          return { success: true, captchaFound: true, captchaType: info.type, screenshot: ss.toString('base64'), mimeType: 'image/png' };
        }
        return { success: true, captchaFound: false };
      }
      case 'captcha_click_checkbox': {
        if (!page) return { success: false, error: 'No browser running' };
        try {
          const f = page.frameLocator('iframe[src*="recaptcha"]').first();
          await f.locator('.recaptcha-checkbox-border, .recaptcha-checkbox').click({ timeout: 5000 });
          await page.waitForTimeout(2000);
          return { success: true, message: 'Clicked reCAPTCHA' };
        } catch {
          try {
            const f = page.frameLocator('iframe[src*="hcaptcha"]').first();
            await f.locator('#checkbox').click({ timeout: 5000 });
            await page.waitForTimeout(2000);
            return { success: true, message: 'Clicked hCaptcha' };
          } catch { return { success: false, error: 'Could not click CAPTCHA checkbox' }; }
        }
      }
      case 'captcha_solve_image': {
        if (!page) return { success: false, error: 'No browser running' };
        if (!cmd.solution) return { success: false, error: 'No solution' };
        const sels = ['input[name*="captcha" i]', 'input[id*="captcha" i]', 'input[placeholder*="captcha" i]'];
        for (const s of sels) { try { await page.fill(s, cmd.solution, { timeout: 2000 }); return { success: true, message: 'Entered solution' }; } catch {} }
        return { success: false, error: 'Could not find CAPTCHA input' };
      }
      case 'captcha_get_image': {
        if (!page) return { success: false, error: 'No browser running' };
        const sels = ['img[src*="captcha"]', 'img[alt*="captcha" i]', '.captcha-image'];
        for (const s of sels) { const el = await page.$(s); if (el) { const ss = await el.screenshot({ type: 'png' }); return { success: true, screenshot: ss.toString('base64'), mimeType: 'image/png' }; } }
        const ss = await page.screenshot({ type: 'png', fullPage: false });
        return { success: true, screenshot: ss.toString('base64'), mimeType: 'image/png' };
      }
      case 'get_links': {
        if (!page) return { success: false, error: 'No browser running' };
        const base = new URL(page.url());
        const links = await page.evaluate((origin) => {
          const seen = new Set(), results = [];
          document.querySelectorAll('a[href]').forEach(a => {
            try {
              const href = a.href;
              if (!href || href.startsWith('javascript:')) return;
              const url = new URL(href, origin);
              const norm = url.origin + url.pathname;
              if (seen.has(norm)) return;
              seen.add(norm);
              results.push({ url: href, text: a.textContent?.trim().slice(0,100)||'', isInternal: url.origin === origin });
            } catch {}
          });
          return results;
        }, base.origin);
        return { success: true, totalLinks: links.length, internalLinks: links.filter(l=>l.isInternal).length, externalLinks: links.filter(l=>!l.isInternal).length, links: links.slice(0,100) };
      }
      case 'detect_form': {
        if (!page) return { success: false, error: 'No browser running' };
        const formData = await page.evaluate(() => {
          const forms = document.querySelectorAll('form');
          const results = [];
          forms.forEach((form, formIndex) => {
            const fields = [];
            form.querySelectorAll('input, textarea, select, button[type="submit"]').forEach(el => {
              const field = {
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : 'text'),
                name: el.getAttribute('name'),
                id: el.getAttribute('id'),
                placeholder: el.getAttribute('placeholder'),
                label: null,
                selector: null,
                required: el.hasAttribute('required'),
                value: el.value || ''
              };
              // Find associated label
              if (field.id) {
                const label = document.querySelector('label[for="' + field.id + '"]');
                if (label) field.label = label.textContent?.trim();
                field.selector = '#' + field.id;
              } else if (field.name) {
                field.selector = '[name="' + field.name + '"]';
              }
              // Try to find label by proximity
              if (!field.label) {
                const parent = el.closest('div, label, fieldset');
                if (parent) {
                  const labelEl = parent.querySelector('label') || parent;
                  const text = labelEl.textContent?.replace(el.value, '').trim().slice(0, 50);
                  if (text) field.label = text;
                }
              }
              fields.push(field);
            });
            results.push({
              formIndex,
              action: form.getAttribute('action'),
              method: form.getAttribute('method') || 'GET',
              id: form.getAttribute('id'),
              fields
            });
          });
          // Also check for inputs outside forms (some sites don't use form tags)
          const orphanInputs = document.querySelectorAll('input:not(form input), textarea:not(form textarea)');
          if (orphanInputs.length > 0 && results.length === 0) {
            const fields = [];
            orphanInputs.forEach(el => {
              const field = {
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute('type') || 'text',
                name: el.getAttribute('name'),
                id: el.getAttribute('id'),
                placeholder: el.getAttribute('placeholder'),
                label: null,
                selector: null,
                required: el.hasAttribute('required')
              };
              if (field.id) field.selector = '#' + field.id;
              else if (field.name) field.selector = '[name="' + field.name + '"]';
              fields.push(field);
            });
            results.push({ formIndex: -1, note: 'Inputs found outside form tags', fields });
          }
          return results;
        });
        return { success: true, forms: formData, formCount: formData.length };
      }
      case 'crawl': {
        if (!page) return { success: false, error: 'No browser running' };
        const startUrl = cmd.url || page.url(), maxPages = Math.min(cmd.maxPages||10, 50), maxDepth = Math.min(cmd.maxDepth||2, 5);
        const base = new URL(startUrl), visited = new Set(), results = [], queue = [{url:startUrl,depth:0}];
        while (queue.length > 0 && results.length < maxPages) {
          const {url,depth} = queue.shift();
          try { const p = new URL(url); if (p.origin !== base.origin) continue; const norm = p.origin+p.pathname; if (visited.has(norm)) continue; visited.add(norm); } catch { continue; }
          try {
            await page.goto(url, {waitUntil:'domcontentloaded',timeout:15000});
            const data = await page.evaluate(() => {
              const BOILERPLATE = 'script,style,nav,footer,header,aside,[role="navigation"],[role="banner"],[role="contentinfo"],.cookie-banner,.cookie-notice,#cookie-consent,.breadcrumb,.breadcrumbs,.site-header,.site-footer';
              const main = document.querySelector('main,article,[role=main],.main-content,.page-content,.entry-content,.post-content,#content,#main') || document.body;
              const clone = main.cloneNode(true) as HTMLElement; clone.querySelectorAll(BOILERPLATE).forEach(e=>e.remove());
              const links: string[] = []; document.querySelectorAll('a[href]').forEach(a => { try { const p = new URL((a as HTMLAnchorElement).href); if (p.origin === location.origin) links.push(p.origin+p.pathname); } catch {} });
              const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
              return { title: document.title, url: location.href, content: text.slice(0,30000), links };
            });
            results.push({url:data.url,title:data.title,content:data.content,depth});
            if (depth < maxDepth) data.links.forEach(l => { if (!visited.has(l)) queue.push({url:l,depth:depth+1}); });
          } catch {}
        }
        return { success: true, pagesCrawled: results.length, results };
      }
      case 'sitemap': {
        if (!page) return { success: false, error: 'No browser running' };
        const startUrl = cmd.url || page.url(), maxPages = Math.min(cmd.maxPages||50, 200);
        const base = new URL(startUrl), visited = new Set(), sitemap = [], queue = [startUrl];
        while (queue.length > 0 && sitemap.length < maxPages) {
          const url = queue.shift();
          try { const p = new URL(url); if (p.origin !== base.origin) continue; const norm = p.origin+p.pathname; if (visited.has(norm)) continue; visited.add(norm); } catch { continue; }
          try {
            await page.goto(url, {waitUntil:'domcontentloaded',timeout:10000});
            const info = await page.evaluate(() => {
              const links = []; document.querySelectorAll('a[href]').forEach(a => { try { const p = new URL(a.href); if (p.origin === location.origin) links.push(p.origin+p.pathname); } catch {} });
              return { title: document.title, url: location.href, links: [...new Set(links)] };
            });
            sitemap.push({url:info.url,title:info.title});
            info.links.forEach(l => { if (!visited.has(l) && !queue.includes(l)) queue.push(l); });
          } catch {}
        }
        return { success: true, totalPages: sitemap.length, incomplete: queue.length > 0, sitemap };
      }
      case 'accept_cookies': {
        if (!page) return { success: false, error: 'No browser running' };
        
        // First, try to find and click in any iframes (Google consent is often in iframe)
        const frames = page.frames();
        for (const frame of frames) {
          try {
            // Google consent iframe selectors
            const googleSelectors = [
              'button[aria-label="Accept all"]',
              'button[aria-label="Alle akzeptieren"]',
              'button[aria-label="Aceptar todo"]',
              '#L2AGLb',
              'button:has-text("Accept all")',
              'button:has-text("I agree")',
              'div[role="dialog"] button:first-of-type',
            ];
            for (const sel of googleSelectors) {
              try {
                const btn = frame.locator(sel).first();
                if (await btn.isVisible({ timeout: 500 })) {
                  await btn.click({ timeout: 2000 });
                  return { success: true, message: 'Accepted cookies in frame: ' + sel };
                }
              } catch {}
            }
          } catch {}
        }
        
        // Try main page strategies
        const strategies = [
          // Google - various regional button IDs and classes
          { sel: '#L2AGLb', desc: 'Google Accept ID' },
          { sel: '#W0wltc', desc: 'Google Reject ID' },
          { sel: 'button.tHlp8d', desc: 'Google button class' },
          { sel: 'div.QS5gu button:first-child', desc: 'Google consent div' },
          { sel: '[data-ved] button:first-of-type', desc: 'Google data-ved' },
          { sel: 'form[action*="consent"] button', desc: 'Google consent form' },
          { sel: 'div[role="dialog"] button', desc: 'Dialog button' },
          // Common IDs
          { sel: '#onetrust-accept-btn-handler', desc: 'OneTrust' },
          { sel: '#accept-recommended-btn-handler', desc: 'OneTrust recommended' },
          { sel: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', desc: 'Cookiebot' },
          { sel: '.cc-accept-all', desc: 'Cookie Consent' },
          { sel: '[data-testid="cookie-policy-manage-dialog-btn-accept"]', desc: 'TestID accept' },
          { sel: 'button[aria-label*="Accept"]', desc: 'Aria accept' },
        ];
        
        for (const s of strategies) {
          try {
            const el = page.locator(s.sel).first();
            if (await el.isVisible({ timeout: 500 })) {
              await el.click({ timeout: 2000 });
              return { success: true, message: 'Accepted cookies via: ' + s.desc };
            }
          } catch {}
        }
        
        // Try by role
        const roleNames = ['Accept all', 'Accept All', 'Allow all', 'Alle akzeptieren', 'Aceptar todo', 'I agree', 'Agree', 'OK'];
        for (const name of roleNames) {
          try {
            const btn = page.getByRole('button', { name, exact: false }).first();
            if (await btn.isVisible({ timeout: 500 })) {
              await btn.click({ timeout: 2000 });
              return { success: true, message: 'Accepted cookies via role: ' + name };
            }
          } catch {}
        }
        
        // JavaScript fallback - find any visible button with accept-like text
        try {
          const clicked = await page.evaluate(() => {
            const acceptTerms = ['accept', 'agree', 'allow', 'consent', 'ok', 'got it', 'akzeptieren', 'aceptar'];
            const buttons = document.querySelectorAll('button, [role="button"]');
            for (const btn of buttons) {
              const text = (btn.textContent || '').toLowerCase();
              const visible = btn.offsetParent !== null && getComputedStyle(btn).display !== 'none';
              if (visible && acceptTerms.some(term => text.includes(term))) {
                btn.click();
                return btn.textContent?.trim() || 'unknown';
              }
            }
            // Also check iframes
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
              try {
                const doc = iframe.contentDocument;
                if (!doc) continue;
                const btns = doc.querySelectorAll('button, [role="button"]');
                for (const btn of btns) {
                  const text = (btn.textContent || '').toLowerCase();
                  if (acceptTerms.some(term => text.includes(term))) {
                    btn.click();
                    return 'iframe: ' + (btn.textContent?.trim() || 'unknown');
                  }
                }
              } catch {}
            }
            return null;
          });
          if (clicked) return { success: true, message: 'JS clicked: ' + clicked };
        } catch {}
        
        return { success: false, error: 'No cookie consent banner found or could not click accept button' };
      }
      case 'close': {
        if (browser) { 
          await browser.close(); 
          browser = null; 
          context = null;
          page = null; 
        }
        return { success: true, message: 'Browser closed' };
      }
      default: return { success: false, error: 'Unknown command: ' + cmd.type };
    }
  } catch (err) { return { success: false, error: err.message }; }
}

const wss = new WebSocket.Server({ port: PORT });
console.log('Browser agent listening on ws://localhost:' + PORT);
wss.on('connection', (ws) => {
  ws.on('message', async (msg) => {
    try { ws.send(JSON.stringify(await handleCommand(JSON.parse(msg.toString())))); }
    catch { ws.send(JSON.stringify({ success: false, error: 'Invalid JSON' })); }
  });
});
process.on('SIGINT', async () => { if (browser) await browser.close(); wss.close(); process.exit(0); });
process.on('SIGTERM', async () => { if (browser) await browser.close(); wss.close(); process.exit(0); });
`;

async function ensureBrowserAgentSetup(): Promise<string> {
  // Set up browser agent in app data directory
  const dataDir = await appDataDir();
  const agentDir = `${dataDir}browser-agent`;
  const scriptPath = `${agentDir}/browser-agent.js`;
  const packagePath = `${agentDir}/package.json`;

  // Create directory if needed
  if (!await exists(agentDir)) {
    await mkdir(agentDir, { recursive: true });
  }

  // Write the agent script
  await writeTextFile(scriptPath, BROWSER_AGENT_SCRIPT);

  // Write package.json if it doesn't exist or is outdated
  const packageJson = JSON.stringify({
    name: 'code-scout-browser-agent',
    version: '1.0.0',
    private: true,
    dependencies: { playwright: '^1.52.0', ws: '^8.18.0' }
  }, null, 2);
  await writeTextFile(packagePath, packageJson);

  return agentDir;
}

function isWindows(): boolean {
  return navigator.userAgent.includes('Windows') || navigator.platform?.startsWith('Win');
}

async function installDependenciesIfNeeded(agentDir: string): Promise<void> {
  const nodeModulesPath = `${agentDir}/node_modules`;
  if (await exists(nodeModulesPath)) {
    return; // Already installed
  }

  console.log('[BrowserService] Installing dependencies...');

  // Use login shell (-l) to inherit user's PATH (for npm/node)
  // This sources .bash_profile / .zshrc which sets up PATH
  const isWin = isWindows();
  const shellCmd = isWin ? 'cmd' : 'bash';
  const shellArgs = isWin
    ? ['/c', `cd "${agentDir}" && npm install --silent`]
    : ['-l', '-c', `cd "${agentDir}" && npm install --silent`];

  const installCmd = Command.create(shellCmd, shellArgs);
  const installResult = await installCmd.execute();

  if (installResult.code !== 0) {
    throw new Error(`Failed to install dependencies: ${installResult.stderr}`);
  }

  // Install Chromium browser
  console.log('[BrowserService] Installing Chromium browser...');
  const playwrightArgs = isWin
    ? ['/c', `cd "${agentDir}" && npx playwright install chromium`]
    : ['-l', '-c', `cd "${agentDir}" && npx playwright install chromium`];

  const playwrightCmd = Command.create(shellCmd, playwrightArgs);
  const playwrightResult = await playwrightCmd.execute();

  if (playwrightResult.code !== 0) {
    console.warn('[BrowserService] Chromium install warning:', playwrightResult.stderr);
    // Don't fail - Chromium might already be installed globally
  }
}

export async function startBrowserAgent(): Promise<void> {
  if (agentProcess) {
    await connectWebSocket();
    return;
  }

  // Try to connect first (agent might already be running)
  try {
    await connectWebSocket(2000);
    console.log('[BrowserService] Connected to existing browser agent');
    return;
  } catch {
    // Agent not running, start it
    console.log('[BrowserService] No existing agent, starting new one...');
  }

  console.log('[BrowserService] Setting up browser agent...');

  // Ensure browser agent is set up in app data directory
  const agentDir = await ensureBrowserAgentSetup();
  console.log('[BrowserService] Agent directory:', agentDir);

  // Install dependencies if needed (first run)
  console.log('[BrowserService] Checking dependencies...');
  await installDependenciesIfNeeded(agentDir);
  console.log('[BrowserService] Dependencies ready');

  // Start the agent (use login shell to inherit PATH)
  const isWin = isWindows();
  const shellCmd = isWin ? 'cmd' : 'bash';
  const shellArgs = isWin
    ? ['/c', `cd "${agentDir}" && set BROWSER_AGENT_PORT=${BROWSER_AGENT_PORT} && node browser-agent.js`]
    : ['-l', '-c', `cd "${agentDir}" && BROWSER_AGENT_PORT=${BROWSER_AGENT_PORT} node browser-agent.js`];

  console.log('[BrowserService] Starting agent with:', shellCmd, shellArgs);

  const command = Command.create(shellCmd, shellArgs);

  let startupOutput = '';
  command.stdout.on('data', (line) => {
    console.log('[BrowserAgent]', line);
    startupOutput += line;
  });
  command.stderr.on('data', (line) => {
    console.error('[BrowserAgent ERROR]', line);
    startupOutput += line;
  });

  agentProcess = await command.spawn();
  console.log('[BrowserService] Agent process spawned, pid:', agentProcess.pid);

  // Wait for server to start, retry connection a few times
  let connected = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`[BrowserService] Connection attempt ${attempt}/5...`);
    try {
      await connectWebSocket(3000);
      connected = true;
      break;
    } catch (err) {
      console.log(`[BrowserService] Attempt ${attempt} failed:`, err);
    }
  }

  if (!connected) {
    console.error('[BrowserService] Failed to connect after 5 attempts. Output:', startupOutput);
    if (agentProcess) {
      await agentProcess.kill().catch(() => {});
      agentProcess = null;
    }
    throw new Error(`Failed to start browser agent. Output: ${startupOutput.slice(-500)}`);
  }

  console.log('[BrowserService] Browser agent started successfully');
}

export async function stopBrowserAgent(): Promise<void> {
  if (ws) {
    try {
      await sendCommand({ type: 'close' });
    } catch {
      // Ignore errors when closing
    }
    ws.close();
    ws = null;
    wsReady = false;
  }

  if (agentProcess) {
    await agentProcess.kill();
    agentProcess = null;
  }
}

export function isBrowserAgentRunning(): boolean {
  return wsReady;
}

// ─── Browser Commands ─────────────────────────────────────────────────────────

export async function launchBrowser(headless = false): Promise<BrowserResult> {
  await startBrowserAgent();
  return sendCommand({ type: 'launch', headless });
}

export async function closeBrowser(): Promise<BrowserResult> {
  return sendCommand({ type: 'close' });
}

export async function browserGoto(url: string): Promise<BrowserResult> {
  return sendCommand({ type: 'goto', url });
}

export async function browserClick(selector: string): Promise<BrowserResult> {
  return sendCommand({ type: 'click', selector });
}

export async function browserFill(selector: string, value: string): Promise<BrowserResult> {
  return sendCommand({ type: 'fill', selector, value });
}

export async function browserType(text: string, delay = 50): Promise<BrowserResult> {
  return sendCommand({ type: 'type', text, delay });
}

export async function browserPress(key: string): Promise<BrowserResult> {
  return sendCommand({ type: 'press', key });
}

export async function browserExtract(selector?: string): Promise<BrowserResult> {
  return sendCommand({ type: 'extract', selector });
}

export async function browserScreenshot(): Promise<BrowserResult> {
  return sendCommand({ type: 'screenshot' });
}

export async function browserScroll(direction: 'up' | 'down', amount = 500): Promise<BrowserResult> {
  return sendCommand({ type: 'scroll', direction, amount });
}

export async function browserWait(options: { selector?: string; ms?: number; timeout?: number }): Promise<BrowserResult> {
  return sendCommand({ type: 'wait', ...options });
}

// CAPTCHA handling functions
export async function captchaDetect(): Promise<BrowserResult> {
  return sendCommand({ type: 'captcha_detect' });
}

export async function captchaClickCheckbox(): Promise<BrowserResult> {
  return sendCommand({ type: 'captcha_click_checkbox' });
}

export async function captchaSolveImage(solution: string): Promise<BrowserResult> {
  return sendCommand({ type: 'captcha_solve_image', solution });
}

export async function captchaGetImage(): Promise<BrowserResult> {
  return sendCommand({ type: 'captcha_get_image' });
}

// Cookie consent handling
export async function acceptCookies(): Promise<BrowserResult> {
  return sendCommand({ type: 'accept_cookies' });
}

// Crawler functions
export async function getLinks(): Promise<BrowserResult> {
  return sendCommand({ type: 'get_links' });
}

export async function detectForm(): Promise<BrowserResult> {
  return sendCommand({ type: 'detect_form' });
}

export interface CrawlOptions {
  url?: string;
  maxPages?: number;
  maxDepth?: number;
  extractContent?: boolean;
  urlPattern?: string;
}

export async function crawlSite(options: CrawlOptions = {}): Promise<BrowserResult> {
  return sendCommand({ type: 'crawl', ...options });
}

export async function generateSitemap(options: { url?: string; maxPages?: number } = {}): Promise<BrowserResult> {
  return sendCommand({ type: 'sitemap', ...options });
}

export async function getBrowserStatus(): Promise<BrowserStatus> {
  const result = await sendCommand({ type: 'status' });
  return {
    browserRunning: result.browserRunning ?? false,
    currentUrl: result.currentUrl ?? null,
    currentTitle: result.currentTitle ?? null,
  };
}
