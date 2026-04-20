#!/usr/bin/env node
/**
 * browser-agent.js — Playwright browser automation server
 * 
 * Runs as a sidecar process, listens for commands via WebSocket,
 * and executes browser actions using Playwright.
 * 
 * Commands:
 *   { type: 'launch', headless?: boolean }
 *   { type: 'goto', url: string }
 *   { type: 'click', selector: string }
 *   { type: 'fill', selector: string, value: string }
 *   { type: 'extract', selector?: string }
 *   { type: 'screenshot' }
 *   { type: 'scroll', direction: 'up' | 'down', amount?: number }
 *   { type: 'close' }
 *   { type: 'status' }
 */

const { chromium } = require('playwright');
const WebSocket = require('ws');

const PORT = process.env.BROWSER_AGENT_PORT || 9222;

let browser = null;
let context = null;
let page = null;

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

        // Inject Code Scout identifier banner into every page
        await page.addInitScript(() => {
          const style = document.createElement('style');
          style.id = 'codescout-dark-theme';
          style.textContent = `
            /* Code Scout Browser - Animated banner */
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
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              z-index: 2147483647;
              background: linear-gradient(90deg, #0f0f23 0%, #1a1a3e 25%, #16213e 50%, #1a1a3e 75%, #0f0f23 100%);
              background-size: 200% 200%;
              color: #00d4ff;
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 14px;
              font-weight: 700;
              padding: 8px 16px;
              text-align: center;
              letter-spacing: 2px;
              text-transform: uppercase;
              border-bottom: 2px solid #00d4ff;
              box-shadow: 0 4px 20px rgba(0,212,255,0.3), inset 0 -1px 0 rgba(0,212,255,0.2);
              animation: codescout-pulse 3s ease-in-out infinite, codescout-glow 2s ease-in-out infinite;
            }
            body {
              padding-top: 38px !important;
            }
          `;
          if (document.head) {
            document.head.appendChild(style);
          } else {
            document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
          }
          
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
        });

        return { success: true, message: 'Browser launched with Code Scout dark theme' };
      }

      case 'goto': {
        if (!page) return { success: false, error: 'No browser running. Send "launch" first.' };
        await page.goto(cmd.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const title = await page.title();
        return { success: true, url: page.url(), title };
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
            let el = document.querySelector(selector);
            if (!el) {
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
        try {
          await page.fill(cmd.selector, cmd.value, { timeout: 5000 });
          return { success: true, message: `Filled ${cmd.selector} with "${cmd.value}"` };
        } catch (e) {
          // Try by placeholder or label
          try {
            await page.getByPlaceholder(cmd.selector).first().fill(cmd.value, { timeout: 5000 });
            return { success: true, message: `Filled placeholder "${cmd.selector}"` };
          } catch {
            try {
              await page.getByLabel(cmd.selector).first().fill(cmd.value, { timeout: 5000 });
              return { success: true, message: `Filled label "${cmd.selector}"` };
            } catch {
              return { success: false, error: `Could not find input: ${cmd.selector}` };
            }
          }
        }
      }

      case 'extract': {
        if (!page) return { success: false, error: 'No browser running' };
        let content;
        if (cmd.selector) {
          const el = await page.$(cmd.selector);
          content = el ? await el.textContent() : null;
        } else {
          // Get simplified page content
          content = await page.evaluate(() => {
            const body = document.body;
            // Remove scripts, styles, hidden elements
            const clone = body.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, [hidden]').forEach(el => el.remove());
            return clone.innerText.slice(0, 50000);
          });
        }
        const title = await page.title();
        const url = page.url();
        return { success: true, title, url, content };
      }

      case 'screenshot': {
        if (!page) return { success: false, error: 'No browser running' };
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        const base64 = buffer.toString('base64');
        return { success: true, screenshot: base64, mimeType: 'image/png' };
      }

      case 'scroll': {
        if (!page) return { success: false, error: 'No browser running' };
        const amount = cmd.amount || 500;
        const delta = cmd.direction === 'up' ? -amount : amount;
        await page.evaluate((d) => window.scrollBy(0, d), delta);
        return { success: true, message: `Scrolled ${cmd.direction} by ${amount}px` };
      }

      case 'type': {
        if (!page) return { success: false, error: 'No browser running' };
        await page.keyboard.type(cmd.text, { delay: cmd.delay || 50 });
        return { success: true, message: `Typed: "${cmd.text}"` };
      }

      case 'press': {
        if (!page) return { success: false, error: 'No browser running' };
        await page.keyboard.press(cmd.key);
        return { success: true, message: `Pressed: ${cmd.key}` };
      }

      case 'wait': {
        if (!page) return { success: false, error: 'No browser running' };
        if (cmd.selector) {
          await page.waitForSelector(cmd.selector, { timeout: cmd.timeout || 10000 });
          return { success: true, message: `Found: ${cmd.selector}` };
        } else {
          await page.waitForTimeout(cmd.ms || 1000);
          return { success: true, message: `Waited ${cmd.ms || 1000}ms` };
        }
      }

      case 'status': {
        return {
          success: true,
          browserRunning: !!browser,
          currentUrl: page ? page.url() : null,
          currentTitle: page ? await page.title() : null,
        };
      }

      case 'captcha_detect': {
        if (!page) return { success: false, error: 'No browser running' };
        
        // Detect various CAPTCHA types
        const captchaInfo = await page.evaluate(() => {
          const result = { found: false, type: null, details: {} };
          
          // reCAPTCHA v2 checkbox
          const recaptchaFrame = document.querySelector('iframe[src*="recaptcha"]');
          const recaptchaDiv = document.querySelector('.g-recaptcha, [data-sitekey]');
          if (recaptchaFrame || recaptchaDiv) {
            result.found = true;
            result.type = 'recaptcha_v2';
            result.details.hasCheckbox = !!document.querySelector('.recaptcha-checkbox');
          }
          
          // reCAPTCHA v3 (invisible, usually no UI)
          if (document.querySelector('script[src*="recaptcha/api.js?render="]')) {
            result.found = true;
            result.type = 'recaptcha_v3';
          }
          
          // hCaptcha
          const hcaptchaFrame = document.querySelector('iframe[src*="hcaptcha"]');
          const hcaptchaDiv = document.querySelector('.h-captcha, [data-hcaptcha-sitekey]');
          if (hcaptchaFrame || hcaptchaDiv) {
            result.found = true;
            result.type = 'hcaptcha';
          }
          
          // Cloudflare Turnstile
          const turnstile = document.querySelector('.cf-turnstile, [data-turnstile-sitekey]');
          if (turnstile) {
            result.found = true;
            result.type = 'turnstile';
          }
          
          // Generic image CAPTCHA (look for common patterns)
          const captchaImages = document.querySelectorAll('img[src*="captcha"], img[alt*="captcha" i], img[id*="captcha" i]');
          const captchaInputs = document.querySelectorAll('input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]');
          if (captchaImages.length > 0 || captchaInputs.length > 0) {
            result.found = true;
            result.type = result.type || 'image_captcha';
            result.details.imageCount = captchaImages.length;
            result.details.hasInput = captchaInputs.length > 0;
          }
          
          // Text-based challenge
          const challengeText = document.body.innerText.toLowerCase();
          if (challengeText.includes('verify you are human') || 
              challengeText.includes('prove you are not a robot') ||
              challengeText.includes('security check')) {
            result.found = true;
            result.type = result.type || 'challenge_page';
          }
          
          return result;
        });
        
        if (captchaInfo.found) {
          // Take screenshot of the CAPTCHA area for potential AI solving
          const screenshot = await page.screenshot({ type: 'png', fullPage: false });
          return {
            success: true,
            captchaFound: true,
            captchaType: captchaInfo.type,
            details: captchaInfo.details,
            screenshot: screenshot.toString('base64'),
            mimeType: 'image/png'
          };
        }
        
        return { success: true, captchaFound: false };
      }

      case 'captcha_click_checkbox': {
        if (!page) return { success: false, error: 'No browser running' };
        
        try {
          // Try to find and click reCAPTCHA checkbox
          const recaptchaFrame = page.frameLocator('iframe[src*="recaptcha"]').first();
          await recaptchaFrame.locator('.recaptcha-checkbox-border, .recaptcha-checkbox').click({ timeout: 5000 });
          await page.waitForTimeout(2000); // Wait for verification
          return { success: true, message: 'Clicked reCAPTCHA checkbox' };
        } catch (e1) {
          try {
            // Try hCaptcha checkbox
            const hcaptchaFrame = page.frameLocator('iframe[src*="hcaptcha"]').first();
            await hcaptchaFrame.locator('#checkbox, .check').click({ timeout: 5000 });
            await page.waitForTimeout(2000);
            return { success: true, message: 'Clicked hCaptcha checkbox' };
          } catch (e2) {
            try {
              // Try Turnstile
              const turnstileFrame = page.frameLocator('iframe[src*="challenges.cloudflare.com"]').first();
              await turnstileFrame.locator('input[type="checkbox"], .cb-i').click({ timeout: 5000 });
              await page.waitForTimeout(2000);
              return { success: true, message: 'Clicked Turnstile checkbox' };
            } catch (e3) {
              return { success: false, error: 'Could not find CAPTCHA checkbox to click' };
            }
          }
        }
      }

      case 'captcha_solve_image': {
        if (!page) return { success: false, error: 'No browser running' };
        if (!cmd.solution) return { success: false, error: 'No solution provided' };
        
        try {
          // Find CAPTCHA input field and fill it
          const selectors = [
            'input[name*="captcha" i]',
            'input[id*="captcha" i]',
            'input[placeholder*="captcha" i]',
            'input[placeholder*="code" i]',
            'input[name="answer"]',
            'input[name="response"]',
          ];
          
          for (const selector of selectors) {
            try {
              await page.fill(selector, cmd.solution, { timeout: 2000 });
              return { success: true, message: `Entered CAPTCHA solution in ${selector}` };
            } catch {
              // Try next selector
            }
          }
          
          return { success: false, error: 'Could not find CAPTCHA input field' };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'captcha_get_image': {
        if (!page) return { success: false, error: 'No browser running' };
        
        try {
          // Find CAPTCHA image and screenshot it
          const captchaSelectors = [
            'img[src*="captcha"]',
            'img[alt*="captcha" i]',
            'img[id*="captcha" i]',
            '.captcha-image',
            '#captcha-image',
          ];
          
          for (const selector of captchaSelectors) {
            const element = await page.$(selector);
            if (element) {
              const screenshot = await element.screenshot({ type: 'png' });
              return {
                success: true,
                screenshot: screenshot.toString('base64'),
                mimeType: 'image/png',
                selector: selector
              };
            }
          }
          
          // Fallback: screenshot the whole viewport
          const screenshot = await page.screenshot({ type: 'png', fullPage: false });
          return {
            success: true,
            screenshot: screenshot.toString('base64'),
            mimeType: 'image/png',
            selector: 'viewport'
          };
        } catch (err) {
          return { success: false, error: err.message };
        }
      }

      case 'get_links': {
        if (!page) return { success: false, error: 'No browser running' };
        
        const baseUrl = new URL(page.url());
        const links = await page.evaluate((origin) => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          const seen = new Set();
          const results = [];
          
          for (const a of anchors) {
            try {
              const href = a.href;
              if (!href || href.startsWith('javascript:') || href.startsWith('#')) continue;
              
              const url = new URL(href, origin);
              const normalized = url.origin + url.pathname;
              
              if (seen.has(normalized)) continue;
              seen.add(normalized);
              
              results.push({
                url: href,
                text: a.textContent?.trim().slice(0, 100) || '',
                isInternal: url.origin === origin,
              });
            } catch {}
          }
          return results;
        }, baseUrl.origin);
        
        const internal = links.filter(l => l.isInternal);
        const external = links.filter(l => !l.isInternal);
        
        return {
          success: true,
          totalLinks: links.length,
          internalLinks: internal.length,
          externalLinks: external.length,
          links: links.slice(0, 100), // Limit to prevent huge responses
        };
      }

      case 'crawl': {
        if (!page) return { success: false, error: 'No browser running' };
        
        const startUrl = cmd.url || page.url();
        const maxPages = Math.min(cmd.maxPages || 10, 50); // Cap at 50 pages
        const maxDepth = Math.min(cmd.maxDepth || 2, 5); // Cap depth at 5
        const extractContent = cmd.extractContent !== false;
        const urlPattern = cmd.urlPattern ? new RegExp(cmd.urlPattern) : null;
        
        const baseUrl = new URL(startUrl);
        const visited = new Set();
        const results = [];
        const queue = [{ url: startUrl, depth: 0 }];
        
        while (queue.length > 0 && results.length < maxPages) {
          const { url, depth } = queue.shift();
          
          // Normalize URL
          let normalizedUrl;
          try {
            const parsed = new URL(url);
            normalizedUrl = parsed.origin + parsed.pathname;
          } catch {
            continue;
          }
          
          if (visited.has(normalizedUrl)) continue;
          visited.add(normalizedUrl);
          
          // Check URL pattern
          if (urlPattern && !urlPattern.test(url)) continue;
          
          // Only crawl same origin
          try {
            const parsed = new URL(url);
            if (parsed.origin !== baseUrl.origin) continue;
          } catch {
            continue;
          }
          
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(500); // Brief wait for JS
            
            const pageData = await page.evaluate((shouldExtract) => {
              const data = {
                title: document.title,
                url: window.location.href,
                links: [],
              };
              
              if (shouldExtract) {
                // Get main content, avoiding nav/footer
                const main = document.querySelector('main, article, [role="main"], .content, #content');
                const body = main || document.body;
                const clone = body.cloneNode(true);
                clone.querySelectorAll('script, style, nav, footer, header, aside, [role="navigation"]').forEach(el => el.remove());
                data.content = clone.innerText?.trim().slice(0, 5000) || '';
                data.wordCount = data.content.split(/\s+/).length;
              }
              
              // Get internal links for further crawling
              const anchors = document.querySelectorAll('a[href]');
              for (const a of anchors) {
                try {
                  const href = a.href;
                  if (!href || href.startsWith('javascript:') || href.startsWith('#')) continue;
                  const parsed = new URL(href);
                  if (parsed.origin === window.location.origin) {
                    data.links.push(parsed.origin + parsed.pathname);
                  }
                } catch {}
              }
              
              return data;
            }, extractContent);
            
            results.push({
              url: pageData.url,
              title: pageData.title,
              content: pageData.content,
              wordCount: pageData.wordCount,
              depth,
            });
            
            // Add new links to queue if we haven't hit max depth
            if (depth < maxDepth) {
              for (const link of pageData.links) {
                if (!visited.has(link)) {
                  queue.push({ url: link, depth: depth + 1 });
                }
              }
            }
          } catch (err) {
            // Log but continue crawling
            console.error(`Failed to crawl ${url}: ${err.message}`);
          }
        }
        
        return {
          success: true,
          pagesCrawled: results.length,
          pagesQueued: queue.length,
          startUrl,
          results,
        };
      }

      case 'sitemap': {
        if (!page) return { success: false, error: 'No browser running' };
        
        const startUrl = cmd.url || page.url();
        const maxPages = Math.min(cmd.maxPages || 50, 200);
        
        const baseUrl = new URL(startUrl);
        const visited = new Set();
        const sitemap = [];
        const queue = [startUrl];
        
        while (queue.length > 0 && sitemap.length < maxPages) {
          const url = queue.shift();
          
          let normalizedUrl;
          try {
            const parsed = new URL(url);
            if (parsed.origin !== baseUrl.origin) continue;
            normalizedUrl = parsed.origin + parsed.pathname;
          } catch {
            continue;
          }
          
          if (visited.has(normalizedUrl)) continue;
          visited.add(normalizedUrl);
          
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
            
            const pageInfo = await page.evaluate(() => {
              const links = [];
              document.querySelectorAll('a[href]').forEach(a => {
                try {
                  const parsed = new URL(a.href);
                  if (parsed.origin === window.location.origin) {
                    links.push(parsed.origin + parsed.pathname);
                  }
                } catch {}
              });
              return {
                title: document.title,
                url: window.location.href,
                links: [...new Set(links)],
              };
            });
            
            sitemap.push({
              url: pageInfo.url,
              title: pageInfo.title,
            });
            
            for (const link of pageInfo.links) {
              if (!visited.has(link) && !queue.includes(link)) {
                queue.push(link);
              }
            }
          } catch (err) {
            console.error(`Sitemap: failed ${url}: ${err.message}`);
          }
        }
        
        return {
          success: true,
          totalPages: sitemap.length,
          incomplete: queue.length > 0,
          remainingQueue: queue.length,
          sitemap,
        };
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

      default:
        return { success: false, error: `Unknown command: ${cmd.type}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Start WebSocket server
const wss = new WebSocket.Server({ port: PORT });

console.log(`Browser agent listening on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    let cmd;
    try {
      cmd = JSON.parse(message.toString());
    } catch {
      ws.send(JSON.stringify({ success: false, error: 'Invalid JSON' }));
      return;
    }

    console.log('Command:', cmd.type);
    const result = await handleCommand(cmd);
    ws.send(JSON.stringify(result));
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (browser) await browser.close();
  wss.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  wss.close();
  process.exit(0);
});
