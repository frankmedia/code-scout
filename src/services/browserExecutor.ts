/**
 * browserExecutor.ts — Executes browser automation actions during plan execution
 */

import { PlanStep } from '@/store/workbenchStoreTypes';
import { useWorkbenchStore } from '@/store/workbenchStore';
import {
  launchBrowser,
  closeBrowser,
  browserGoto,
  browserClick,
  browserFill,
  browserExtract,
  browserScreenshot,
  browserScroll,
  browserWait,
  captchaDetect,
  captchaClickCheckbox,
  captchaSolveImage,
  captchaGetImage,
  getLinks,
  crawlSite,
  generateSitemap,
  detectForm,
  acceptCookies,
  BrowserResult,
} from './browserService';
import { writeFileNative, isTauri } from '@/lib/tauri';

const WEB_FOLDER = '.codescout_web';

let _cachedAppDataDir: string | null = null;

async function resolveAppDataDir(): Promise<string> {
  if (_cachedAppDataDir) return _cachedAppDataDir;
  try {
    const { appDataDir } = await import('@tauri-apps/api/path');
    _cachedAppDataDir = await appDataDir();
    return _cachedAppDataDir;
  } catch {
    return '/tmp/codescout-fallback';
  }
}

function getProjectRoot(): string {
  const pp = useWorkbenchStore.getState().projectPath;
  if (pp) return pp;
  if (_cachedAppDataDir) return _cachedAppDataDir;
  return '/tmp/codescout-fallback';
}

function sanitizeFilename(raw: string): string {
  return raw.replace(/^~[/\\]?/, '').replace(/^\.\//, '').split(/[/\\]/).pop() || raw;
}

function getWebFilePath(filename: string, subfolder?: 'data' | 'screenshots'): string {
  const safe = sanitizeFilename(filename);
  const root = getProjectRoot();
  const sep = root.includes('\\') ? '\\' : '/';
  const parts = [root, WEB_FOLDER];
  if (subfolder) parts.push(subfolder);
  parts.push(safe);
  return parts.join(sep);
}

export interface WebSavedFile {
  filename: string;
  absolutePath: string;
  size: number;
  savedAt: number;
}

let _savedWebFiles: WebSavedFile[] = [];
const _savedWebFilesListeners = new Set<() => void>();

export function getSavedWebFiles(): WebSavedFile[] { return _savedWebFiles; }
export function subscribeSavedWebFiles(cb: () => void) {
  _savedWebFilesListeners.add(cb);
  return () => { _savedWebFilesListeners.delete(cb); };
}

function trackSavedFile(absolutePath: string, size: number) {
  const filename = absolutePath.split('/').pop() || absolutePath;
  _savedWebFiles = [
    ..._savedWebFiles.filter(f => f.absolutePath !== absolutePath),
    { filename, absolutePath, size, savedAt: Date.now() },
  ];
  _savedWebFilesListeners.forEach(cb => cb());
}

export function clearSavedWebFiles() {
  _savedWebFiles = [];
  _savedWebFilesListeners.forEach(cb => cb());
}

async function writeWebFile(absolutePath: string, content: string): Promise<void> {
  console.log('[browserExecutor] writeWebFile:', absolutePath, `(${content.length} chars)`);
  await writeFileNative(absolutePath, content);
  trackSavedFile(absolutePath, content.length);

  // Add to in-memory file tree so it shows in the UI immediately
  const filename = absolutePath.split('/').pop() || absolutePath;
  const webPrefix = WEB_FOLDER + '/';
  const idx = absolutePath.indexOf(webPrefix);
  const relativePath = idx !== -1 ? absolutePath.slice(idx) : webPrefix + 'data/' + filename;
  useWorkbenchStore.getState().createFile(relativePath, content);

  console.log('[browserExecutor] writeWebFile SUCCESS:', absolutePath);
}

async function readWebFile(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_file_text', { path });
}

async function writeBinaryWebFile(path: string, dataBase64: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('write_binary_file', { path, dataBase64 });
}

// Record a web session to history
async function recordWebHistory(entry: {
  task: string;
  url?: string;
  actions: string[];
  result: 'success' | 'error' | 'stopped';
  dataFiles?: string[];
  timestamp: string;
}): Promise<void> {
  try {
    const root = getProjectRoot();
    const sep = root.includes('\\') ? '\\' : '/';
    const historyPath = [root, WEB_FOLDER, 'history.json'].join(sep);

    let history: typeof entry[] = [];
    try {
      const content = await readWebFile(historyPath);
      history = JSON.parse(content);
    } catch {
      history = [];
    }

    history.push(entry);
    if (history.length > 100) {
      history = history.slice(-100);
    }

    await writeWebFile(historyPath, JSON.stringify(history, null, 2));
  } catch (err) {
    console.warn('[browserExecutor] Could not record web history:', err);
  }
}

// Load web history for context
async function loadWebHistory(): Promise<Array<{
  task: string;
  url?: string;
  actions: string[];
  result: 'success' | 'error' | 'stopped';
  dataFiles?: string[];
  timestamp: string;
}>> {
  try {
    const root = getProjectRoot();
    const sep = root.includes('\\') ? '\\' : '/';
    const historyPath = [root, WEB_FOLDER, 'history.json'].join(sep);
    const content = await readWebFile(historyPath);
    return JSON.parse(content);
  } catch {
    return [];
  }
}

// Get recent web history summary for the agent
async function getRecentWebHistorySummary(limit = 5): Promise<string> {
  const history = await loadWebHistory();
  if (history.length === 0) return '';
  
  const recent = history.slice(-limit).reverse();
  const lines = recent.map((h, i) => {
    const status = h.result === 'success' ? '✓' : h.result === 'error' ? '✗' : '○';
    const date = new Date(h.timestamp).toLocaleDateString();
    return `${i + 1}. ${status} ${date}: "${h.task.slice(0, 50)}${h.task.length > 50 ? '...' : ''}"${h.url ? ` @ ${h.url}` : ''}`;
  });
  
  return `Recent web tasks:\n${lines.join('\n')}`;
}

async function initWebFolder(): Promise<boolean> {
  try {
    await resolveAppDataDir();
    const root = getProjectRoot();
    const testPath = getWebFilePath('_init_test.txt', 'data');
    console.log('[browserExecutor] initWebFolder: root =', root, '| test =', testPath);
    await writeWebFile(testPath, `Init OK at ${new Date().toISOString()}`);
    const readBack = await readWebFile(testPath);
    console.log('[browserExecutor] initWebFolder smoke test:', readBack ? 'PASS' : 'FAIL');
    return true;
  } catch (err) {
    console.error('[browserExecutor] initWebFolder FAILED:', err);
    return false;
  }
}

export { recordWebHistory, loadWebHistory, getRecentWebHistorySummary, initWebFolder };

// Store for accumulated data from browser actions (for save_* commands)
let accumulatedData: { type: string; data: unknown }[] = [];

export function addAccumulatedData(type: string, data: unknown) {
  console.log(`[browserExecutor] Adding accumulated data: type=${type}`, data);
  accumulatedData.push({ type, data });
}

export function getAccumulatedData() {
  console.log(`[browserExecutor] Getting accumulated data: ${accumulatedData.length} items`);
  return accumulatedData;
}

export function clearAccumulatedData() {
  accumulatedData = [];
}

export interface BrowserExecutionResult {
  success: boolean;
  output: string;
  screenshot?: string;
  pageContent?: string;
  url?: string;
  title?: string;
}

export async function executeBrowserAction(
  step: PlanStep,
  onLog?: (msg: string) => void,
): Promise<BrowserExecutionResult> {
  const log = onLog ?? console.log;

  console.log(`[browserExecutor] executeBrowserAction called: action=${step.action}, path=${step.path}, hasContent=${!!step.content}, contentLen=${step.content?.length ?? 0}`);

  try {
    let result: BrowserResult;

    switch (step.action) {
      case 'browser_launch': {
        log('🌐 Launching browser...');
        result = await launchBrowser(false);
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'Browser launched',
        };
      }

      case 'browser_goto': {
        const url = step.url ?? step.command;
        if (!url) {
          return { success: false, output: 'No URL provided for browser_goto' };
        }
        log(`🌐 Navigating to: ${url}`);
        result = await browserGoto(url);
        return {
          success: result.success,
          output: result.success
            ? `Navigated to: ${result.title} (${result.url})`
            : result.error ?? 'Navigation failed',
          url: result.url,
          title: result.title,
        };
      }

      case 'browser_click': {
        const selector = step.selector ?? step.command;
        if (!selector) {
          return { success: false, output: 'No selector provided for browser_click' };
        }
        log(`🖱️ Clicking: ${selector}`);
        result = await browserClick(selector);
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'Click action completed',
        };
      }

      case 'browser_fill': {
        const selector = step.selector ?? step.path;
        const value = step.value ?? step.content ?? '';
        if (!selector) {
          return { success: false, output: 'No selector provided for browser_fill' };
        }
        log(`⌨️ Filling "${selector}" with: ${value.slice(0, 50)}${value.length > 50 ? '...' : ''}`);
        result = await browserFill(selector, value);
        
        // Track form data for potential save_* commands
        if (result.success) {
          addAccumulatedData('form_fill', {
            field: selector,
            value: value,
            timestamp: new Date().toISOString(),
          });
        }
        
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'Fill action completed',
        };
      }

      case 'browser_extract': {
        const selector = step.selector;
        log(`📋 Extracting content${selector ? ` from: ${selector}` : ' from page'}...`);
        result = await browserExtract(selector);
        if (result.success && result.content) {
          // Store for potential save_* commands
          addAccumulatedData('extract', {
            title: result.title,
            url: result.url,
            content: result.content,
          });
        }
        return {
          success: result.success,
          output: result.success
            ? `Extracted from: ${result.title}\n\n${result.content?.slice(0, 15000) ?? ''}`
            : result.error ?? 'Extraction failed',
          pageContent: result.content,
          url: result.url,
          title: result.title,
        };
      }

      case 'browser_screenshot': {
        log('📸 Taking screenshot...');
        result = await browserScreenshot();
        return {
          success: result.success,
          output: result.success ? 'Screenshot captured' : result.error ?? 'Screenshot failed',
          screenshot: result.screenshot,
        };
      }

      case 'browser_scroll': {
        const direction = step.command?.includes('up') ? 'up' : 'down';
        log(`📜 Scrolling ${direction}...`);
        result = await browserScroll(direction);
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'Scroll completed',
        };
      }

      case 'browser_wait': {
        const selector = step.selector;
        const ms = step.command ? parseInt(step.command) : undefined;
        if (selector) {
          log(`⏳ Waiting for: ${selector}`);
          result = await browserWait({ selector });
        } else {
          log(`⏳ Waiting ${ms ?? 1000}ms...`);
          result = await browserWait({ ms });
        }
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'Wait completed',
        };
      }

      case 'browser_close': {
        log('🌐 Closing browser...');
        result = await closeBrowser();
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'Browser closed',
        };
      }

      case 'captcha_detect': {
        log('🔍 Detecting CAPTCHA...');
        result = await captchaDetect();
        if (result.captchaFound) {
          return {
            success: true,
            output: `CAPTCHA detected: ${result.captchaType}`,
            screenshot: result.screenshot,
          };
        }
        return {
          success: true,
          output: 'No CAPTCHA detected',
        };
      }

      case 'captcha_click': {
        log('🖱️ Clicking CAPTCHA checkbox...');
        result = await captchaClickCheckbox();
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'CAPTCHA click attempted',
        };
      }

      case 'captcha_solve': {
        const solution = step.value ?? step.content;
        if (!solution) {
          return { success: false, output: 'No CAPTCHA solution provided' };
        }
        log(`🔑 Entering CAPTCHA solution: ${solution}`);
        result = await captchaSolveImage(solution);
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'CAPTCHA solution entered',
        };
      }

      case 'captcha_get_image': {
        log('📷 Getting CAPTCHA image...');
        result = await captchaGetImage();
        return {
          success: result.success,
          output: result.success ? 'CAPTCHA image captured' : (result.error ?? 'Failed to get CAPTCHA'),
          screenshot: result.screenshot,
        };
      }

      case 'accept_cookies': {
        log('🍪 Accepting cookie consent...');
        result = await acceptCookies();
        return {
          success: result.success,
          output: result.message ?? result.error ?? 'Cookie consent handled',
        };
      }

      case 'get_links': {
        log('🔗 Extracting links from page...');
        result = await getLinks();
        if (result.success) {
          // Store for potential save_* commands
          addAccumulatedData('links', result.links);
          const linkList = result.links?.slice(0, 20).map((l: { url: string; text: string }) => 
            `- ${l.text || '(no text)'}: ${l.url}`
          ).join('\n') || '';
          return {
            success: true,
            output: `Found ${result.totalLinks} links (${result.internalLinks} internal, ${result.externalLinks} external):\n${linkList}`,
          };
        }
        return { success: false, output: result.error ?? 'Failed to get links' };
      }

      case 'detect_form': {
        log('📝 Detecting form fields on page...');
        result = await detectForm();
        if (result.success) {
          const forms = result.forms || [];
          addAccumulatedData('forms', forms);
          
          if (forms.length === 0) {
            return { success: true, output: 'No forms found on this page.' };
          }
          
          let output = `Found ${forms.length} form(s):\n\n`;
          for (const form of forms) {
            output += `**Form ${form.formIndex >= 0 ? form.formIndex + 1 : '(orphan inputs)'}**`;
            if (form.action) output += ` → ${form.action}`;
            if (form.method) output += ` [${form.method}]`;
            output += '\n';
            
            for (const field of form.fields || []) {
              const label = field.label || field.placeholder || field.name || field.id || '(unnamed)';
              output += `  - ${label}: \`${field.selector || 'no selector'}\` (${field.type})`;
              if (field.required) output += ' *required*';
              output += '\n';
            }
            output += '\n';
          }
          
          return { success: true, output };
        }
        return { success: false, output: result.error ?? 'Failed to detect forms' };
      }

      case 'crawl': {
        const maxPages = step.value ? parseInt(step.value) : 10;
        log(`🕷️ Crawling site (max ${maxPages} pages)...`);
        result = await crawlSite({
          url: step.url,
          maxPages,
          maxDepth: 2,
          extractContent: true,
        });
        if (result.success) {
          const pages = result.results || [];
          // Store for potential save_* commands
          addAccumulatedData('crawl', pages);
          const summary = pages.map((p: { title: string; url: string; wordCount?: number }) => 
            `- ${p.title}: ${p.url} (${p.wordCount || 0} words)`
          ).join('\n');
          return {
            success: true,
            output: `Crawled ${result.pagesCrawled} pages:\n${summary}`,
            pageContent: pages.map((p: { content?: string }) => p.content).filter(Boolean).join('\n\n---\n\n'),
          };
        }
        return { success: false, output: result.error ?? 'Crawl failed' };
      }

      case 'sitemap': {
        const maxPages = step.value ? parseInt(step.value) : 50;
        log(`🗺️ Generating sitemap (max ${maxPages} pages)...`);
        result = await generateSitemap({ url: step.url, maxPages });
        if (result.success) {
          const pages = result.sitemap || [];
          // Store for potential save_json/save_csv later
          addAccumulatedData('sitemap', pages);
          const list = pages.map((p: { title: string; url: string }) => `- ${p.title}: ${p.url}`).join('\n');
          return {
            success: true,
            output: `Sitemap: ${result.totalPages} pages found${result.incomplete ? ` (${result.remainingQueue} more in queue)` : ''}:\n${list}`,
          };
        }
        return { success: false, output: result.error ?? 'Sitemap generation failed' };
      }

      case 'save_json': {
        const filename = step.path || step.command || `web-data-${Date.now()}.json`;

        // If the LLM provided content directly, write it as-is
        const directJsonContent = step.content || step.value || '';
        if (directJsonContent && directJsonContent.length > 2) {
          log(`💾 Saving JSON file: ${filename} (${directJsonContent.length} chars)...`);
          try {
            const fullPath = await getWebFilePath(filename, 'data');
            log(`💾 Writing to: ${fullPath}`);
            await writeWebFile(fullPath, directJsonContent);
            return {
              success: true,
              output: `Saved to: ${fullPath} (${directJsonContent.length} chars)`,
            };
          } catch (err) {
            log(`❌ Save JSON error: ${err}`);
            return { success: false, output: `Failed to save JSON: ${err}` };
          }
        }

        log(`💾 Saving data to JSON: ${filename}...`);
        try {
          const rawData = getAccumulatedData();
          if (rawData.length === 0) {
            return { success: false, output: 'No data accumulated to save. Use browser_extract, detect_form, or fill forms first.' };
          }
          
          // Organize data by type for cleaner output
          const organized: Record<string, unknown[]> = {};
          for (const item of rawData) {
            if (!organized[item.type]) organized[item.type] = [];
            organized[item.type].push(item.data);
          }
          
          const jsonContent = JSON.stringify(organized, null, 2);
          const fullPath = await getWebFilePath(filename, 'data');
          log(`💾 Writing to: ${fullPath}`);
          await writeWebFile(fullPath, jsonContent);
          return {
            success: true,
            output: `Saved JSON to: ${fullPath} (${jsonContent.length} bytes, ${rawData.length} items)`,
          };
        } catch (err) {
          log(`❌ Save JSON error: ${err}`);
          return { success: false, output: `Failed to save JSON: ${err}` };
        }
      }

      case 'save_csv': {
        const filename = step.path || step.command || `web-data-${Date.now()}.csv`;
        log(`📊 Saving data to CSV: ${filename}...`);
        try {
          const data = getAccumulatedData();
          if (data.length === 0) {
            return { success: false, output: 'No data accumulated to save as CSV. Use browser_extract, detect_form, or fill forms first.' };
          }
          
          // Flatten to array of objects, adding type info
          let rows: Record<string, unknown>[] = [];
          for (const item of data) {
            if (Array.isArray(item.data)) {
              rows = rows.concat(item.data.map(d => ({ type: item.type, ...d })));
            } else if (typeof item.data === 'object' && item.data !== null) {
              rows.push({ type: item.type, ...(item.data as Record<string, unknown>) });
            }
          }
          
          if (rows.length === 0) {
            return { success: false, output: 'No structured data to save as CSV' };
          }
          
          // Generate CSV with all unique headers
          const allHeaders = new Set<string>();
          rows.forEach(row => Object.keys(row).forEach(k => allHeaders.add(k)));
          const headers = Array.from(allHeaders);
          
          const csvLines = [
            headers.join(','),
            ...rows.map(row => 
              headers.map(h => {
                const val = row[h];
                const str = val === null || val === undefined ? '' : String(val);
                return str.includes(',') || str.includes('"') || str.includes('\n') 
                  ? `"${str.replace(/"/g, '""')}"` 
                  : str;
              }).join(',')
            )
          ];
          const csvContent = csvLines.join('\n');
          const fullPath = await getWebFilePath(filename, 'data');
          log(`💾 Writing to: ${fullPath}`);
          await writeWebFile(fullPath, csvContent);
          return {
            success: true,
            output: `Saved CSV to: ${fullPath} (${rows.length} rows)`,
          };
        } catch (err) {
          log(`❌ Save CSV error: ${err}`);
          return { success: false, output: `Failed to save CSV: ${err}` };
        }
      }

      case 'save_markdown': {
        const filename = step.path || step.command || 'web-report.md';
        console.log(`[browserExecutor] save_markdown hit: filename=${filename}, hasContent=${!!(step.content || step.value)}, contentLen=${(step.content || step.value || '').length}`);

        // If the LLM provided content directly, write it as-is (most common for scraping)
        const directContent = step.content || step.value || '';
        if (directContent) {
          log(`📝 Saving markdown file: ${filename} (${directContent.length} chars)...`);
          try {
            const fullPath = await getWebFilePath(filename, 'data');
            console.log(`[browserExecutor] save_markdown WRITING: ${fullPath} (${directContent.length} chars)`);
            log(`💾 Writing to: ${fullPath}`);
            await writeWebFile(fullPath, directContent);
            return {
              success: true,
              output: `Saved to: ${fullPath} (${directContent.length} chars)`,
            };
          } catch (err) {
            console.error(`[browserExecutor] save_markdown WRITE FAILED:`, err);
            log(`❌ Save markdown error: ${err}`);
            return { success: false, output: `Failed to save markdown: ${err}` };
          }
        }

        // Fallback: generate a report from accumulated data
        log(`📝 Saving report to Markdown: ${filename}...`);
        try {
          const data = getAccumulatedData();
          let mdContent = '# Web Automation Report\n\n';
          mdContent += `Generated: ${new Date().toISOString()}\n\n`;
          
          if (data.length === 0) {
            mdContent += '_No data was accumulated. Use browser_extract or crawl before saving._\n';
          }

          for (const item of data) {
            mdContent += `## ${item.type}\n\n`;
            if (Array.isArray(item.data)) {
              for (const entry of item.data) {
                if (typeof entry === 'object' && entry !== null) {
                  const obj = entry as Record<string, unknown>;
                  if (obj.title && obj.url) {
                    mdContent += `- **${obj.title}**: ${obj.url}\n`;
                  } else if (obj.content) {
                    mdContent += `${String(obj.content)}\n\n`;
                  } else {
                    mdContent += `- ${JSON.stringify(entry)}\n`;
                  }
                } else {
                  mdContent += `- ${entry}\n`;
                }
              }
            } else {
              mdContent += '```json\n' + JSON.stringify(item.data, null, 2) + '\n```\n';
            }
            mdContent += '\n';
          }
          
          const fullPath = await getWebFilePath(filename, 'data');
          log(`💾 Writing to: ${fullPath}`);
          await writeWebFile(fullPath, mdContent);
          return {
            success: true,
            output: `Saved Markdown report to: ${fullPath} (${data.length} items, ${mdContent.length} bytes)`,
          };
        } catch (err) {
          log(`❌ Save Markdown error: ${err}`);
          return { success: false, output: `Failed to save Markdown: ${err}` };
        }
      }

      case 'save_text':
      case 'save_file': {
        const filename = step.path || step.command;
        const textContent = step.content || step.value || '';
        if (!filename) {
          return { success: false, output: 'No filename provided for save_text. Provide a "path" field.' };
        }
        if (!textContent) {
          return { success: false, output: 'No content provided for save_text. Provide a "content" field.' };
        }
        log(`📝 Saving text file: ${filename} (${textContent.length} chars)...`);
        try {
          const fullPath = await getWebFilePath(filename, 'data');
          log(`💾 Writing to: ${fullPath}`);
          await writeWebFile(fullPath, textContent);
          return {
            success: true,
            output: `Saved to: ${fullPath} (${textContent.length} chars)`,
          };
        } catch (err) {
          log(`❌ Save text error: ${err}`);
          return { success: false, output: `Failed to save text file: ${err}` };
        }
      }

      case 'save_screenshot': {
        const filename = step.path || step.command || `screenshot-${Date.now()}.png`;
        log(`📸 Saving screenshot to: ${filename}...`);
        try {
          result = await browserScreenshot();
          if (!result.success || !result.screenshot) {
            return { success: false, output: 'Failed to capture screenshot' };
          }
          const fullPath = await getWebFilePath(filename, 'screenshots');
          log(`💾 Writing to: ${fullPath}`);
          await writeBinaryWebFile(fullPath, result.screenshot);
          return {
            success: true,
            output: `Saved screenshot to: ${fullPath}`,
            screenshot: result.screenshot,
          };
        } catch (err) {
          log(`❌ Save screenshot error: ${err}`);
          return { success: false, output: `Failed to save screenshot: ${err}` };
        }
      }

      default:
        console.error(`[browserExecutor] UNKNOWN ACTION: "${step.action}" — full step:`, JSON.stringify(step));
        return {
          success: false,
          output: `Unknown browser action: ${step.action}`,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: `Browser action failed: ${msg}`,
    };
  }
}

export function isBrowserAction(action: string): boolean {
  return action.startsWith('browser_') || 
         action.startsWith('save_') || 
         action.startsWith('captcha_') ||
         ['crawl', 'sitemap', 'get_links', 'detect_form', 'accept_cookies', 'wait_for_user'].includes(action);
}
