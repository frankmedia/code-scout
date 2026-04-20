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
let page = null;

async function handleCommand(cmd) {
  try {
    switch (cmd.type) {
      case 'launch': {
        // Check if browser is actually still running (not just the variable)
        if (browser) {
          try {
            // Test if browser is responsive
            const pages = browser.contexts().flatMap(c => c.pages());
            if (pages.length > 0) {
              return { success: true, message: 'Browser already running' };
            }
          } catch {
            // Browser crashed or was closed externally - clean up
            console.log('[BrowserAgent] Browser not responsive, restarting...');
            browser = null;
            page = null;
          }
        }
        browser = await chromium.launch({
          headless: cmd.headless ?? false,
          args: [
            '--start-maximized',
            '--force-dark-mode',
            '--enable-features=WebContentsForceDark:inversion_method/cielab_based',
          ],
        });
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          colorScheme: 'dark',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) CodeScout-Browser/1.0',
        });
        page = await context.newPage();

        // Inject super dark theme CSS into every page
        await page.addInitScript(() => {
          const style = document.createElement('style');
          style.id = 'codescout-dark-theme';
          style.textContent = `
            /* Code Scout Dark Browser Theme */
            :root {
              color-scheme: dark !important;
            }
            html {
              filter: invert(0.92) hue-rotate(180deg) !important;
              background: #0a0a0a !important;
            }
            img, video, picture, canvas, svg, [style*="background-image"] {
              filter: invert(1) hue-rotate(180deg) !important;
            }
            /* Code Scout identifier bar */
            body::before {
              content: '🤖 Code Scout Browser';
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              background: linear-gradient(90deg, #1a1a2e 0%, #16213e 50%, #1a1a2e 100%);
              color: #00d4ff;
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 11px;
              font-weight: 600;
              padding: 3px 12px;
              z-index: 2147483647;
              text-align: center;
              letter-spacing: 0.5px;
              border-bottom: 1px solid #00d4ff33;
              box-shadow: 0 2px 8px rgba(0, 212, 255, 0.15);
            }
            body {
              padding-top: 24px !important;
            }
          `;
          if (document.head) {
            document.head.appendChild(style);
          } else {
            document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
          }
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
        // Try multiple selector strategies
        const selector = cmd.selector;
        try {
          await page.click(selector, { timeout: 5000 });
          return { success: true, message: `Clicked: ${selector}` };
        } catch (e) {
          // Try by text content
          try {
            await page.getByText(selector, { exact: false }).first().click({ timeout: 5000 });
            return { success: true, message: `Clicked text: ${selector}` };
          } catch {
            return { success: false, error: `Could not find element: ${selector}` };
          }
        }
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

      case 'close': {
        if (browser) {
          await browser.close();
          browser = null;
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
