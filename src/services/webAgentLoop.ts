/**
 * webAgentLoop.ts — Reactive web browsing agent architecture
 * 
 * Instead of generating a full plan upfront, the AI:
 * 1. Observes the current page state
 * 2. Decides the NEXT single action
 * 3. Executes it
 * 4. Repeats until task is complete
 */

import { callModel, modelToRequest, type ModelRequestMessage } from './modelApi';
import { useModelStore } from '../store/modelStore';
import { executeBrowserAction, clearAccumulatedData, getAccumulatedData, recordWebHistory, getRecentWebHistorySummary, initWebFolder } from './browserExecutor';
import * as browserService from './browserService';

// Track actions performed during the session for history
let sessionActions: string[] = [];
let sessionDataFiles: string[] = [];

export interface WebAgentState {
  browserRunning: boolean;
  currentUrl: string | null;
  currentTitle: string | null;
  lastActionResult: string | null;
  pageContent: string | null;
  formFields: FormField[] | null;
  screenshotBase64: string | null;
  stepCount: number;
  maxSteps: number;
  done: boolean;
  finalAnswer: string | null;
  error: string | null;
}

export interface FormField {
  selector: string;
  type: string;
  label: string | null;
  placeholder: string | null;
  name: string | null;
  required: boolean;
}

export interface WebAgentAction {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  path?: string;
  reason: string;  // AI explains why it's taking this action
}

export interface WebAgentCallbacks {
  onStateChange: (state: WebAgentState) => void;
  onAction: (action: WebAgentAction) => void;
  onActionComplete?: (action: WebAgentAction, result: { success: boolean; output: string }) => void;
  onThinking: (thought: string) => void;
  onComplete: (answer: string) => void;
  onError: (error: string) => void;
  onWaitForUser?: (message: string) => Promise<void>; // Pause and wait for user to complete action
  trackTokens?: (input: number, output: number, role: 'orchestrator' | 'coder') => void;
}

const MAX_STEPS = 25;

/**
 * Use Coder model to analyze data and generate polished final answers.
 * This shifts token usage from paid Orchestrator to free Coder.
 */
async function generateCoderAnalysis(
  task: string,
  orchestratorSummary: string,
  extractedData: string | null,
  pageContent: string | null,
  callbacks: WebAgentCallbacks
): Promise<string> {
  const modelStore = useModelStore.getState();
  const coderModel = modelStore.getModelForRole('coder');
  
  if (!coderModel) {
    // Fall back to orchestrator's summary if no coder configured
    return orchestratorSummary;
  }
  
  callbacks.onThinking('Coder analyzing results...');
  
  const systemPrompt = `You are a data analyst assistant. Your job is to take raw extracted web data and produce a clear, well-formatted answer for the user.

**Your responsibilities:**
1. Parse and understand the extracted content
2. Answer the user's original question directly
3. Format your response using markdown for readability
4. Include relevant details, lists, or tables as appropriate
5. Be concise but comprehensive

**Formatting guidelines:**
- Use **bold** for emphasis
- Use bullet points or numbered lists for multiple items
- Use tables for comparative data
- Include relevant URLs if they help the user
- Don't include raw HTML or messy data`;

  const userPrompt = `**USER'S TASK:** ${task}

**ORCHESTRATOR'S SUMMARY:** ${orchestratorSummary}

${extractedData ? `**EXTRACTED DATA:**\n${extractedData.slice(0, 8000)}` : ''}

${pageContent ? `**PAGE CONTENT:**\n${pageContent.slice(0, 4000)}` : ''}

Based on the above, provide a clear, well-formatted answer to the user's task. Focus on what they actually asked for.`;

  const messages: ModelRequestMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let responseText = '';
  try {
    const request = modelToRequest(coderModel, messages, { maxOutputTokens: 2000 });
    
    await new Promise<void>((resolve, reject) => {
      callModel(
        request,
        (chunk) => { responseText += chunk; },
        () => resolve(),
        reject,
        (usage) => {
          if (callbacks.trackTokens) {
            callbacks.trackTokens(usage.inputTokens || 0, usage.outputTokens || 0, 'coder');
          }
        }
      );
    });
    
    return responseText.trim() || orchestratorSummary;
  } catch (err) {
    console.warn('[webAgentLoop] Coder analysis failed, using orchestrator summary:', err);
    return orchestratorSummary;
  }
}

/**
 * Use Coder to analyze/summarize data after heavy extraction actions.
 * Called after crawl, sitemap, browser_extract with large content.
 */
async function analyzeExtractedData(
  actionType: string,
  rawOutput: string,
  task: string,
  callbacks: WebAgentCallbacks
): Promise<string> {
  const modelStore = useModelStore.getState();
  const coderModel = modelStore.getModelForRole('coder');
  
  if (!coderModel || rawOutput.length < 500) {
    // Don't bother with tiny outputs
    return rawOutput;
  }
  
  callbacks.onThinking('Coder processing extracted data...');
  
  const systemPrompt = `You are a data processing assistant. Summarize and structure the extracted web data concisely.
Keep important details but remove noise. Output clean, readable text.`;

  const userPrompt = `**Action:** ${actionType}
**User's task:** ${task}

**Raw extracted data:**
${rawOutput.slice(0, 10000)}

Provide a clean, structured summary of this data that would help complete the user's task.`;

  const messages: ModelRequestMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let responseText = '';
  try {
    const request = modelToRequest(coderModel, messages, { maxOutputTokens: 1500 });
    
    await new Promise<void>((resolve, reject) => {
      callModel(
        request,
        (chunk) => { responseText += chunk; },
        () => resolve(),
        reject,
        (usage) => {
          if (callbacks.trackTokens) {
            callbacks.trackTokens(usage.inputTokens || 0, usage.outputTokens || 0, 'coder');
          }
        }
      );
    });
    
    return responseText.trim() || rawOutput;
  } catch {
    return rawOutput;
  }
}

async function buildAgentSystemPrompt(): Promise<string> {
  // Get recent history for context
  const historyContext = await getRecentWebHistorySummary(3);
  const historySection = historyContext ? `\n\n**RECENT HISTORY (for context):**\n${historyContext}\n` : '';
  
  // Current date for search context
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const year = now.getFullYear();
  
  return `You are a reactive web browsing agent. You control a real browser one action at a time.

**TODAY'S DATE:** ${dateStr}
**CURRENT YEAR:** ${year}

When searching for information, use the current year (${year}) in your queries to get up-to-date results. For example, search "best AI IDEs ${year}" not "best AI IDEs 2024".
${historySection}

**Your loop:**
1. OBSERVE: You see the current browser state (URL, page content, form fields if detected)
2. THINK: Decide the single best next action
3. ACT: Output ONE action in JSON format
4. REPEAT: See the result, then decide the next action

**CRITICAL RULES:**
- You only output ONE action at a time!
- **ALWAYS go to the EXACT website the user mentions!** If they say "go to elsewhen.com" or "fill form on example.com", navigate to THAT EXACT SITE, not some random form page.
- Never substitute a different website. If the user says "elsewhen", go to "elsewhen.com". If they say "google", go to "google.com".
- Extract the domain from the user's request and use it directly.

**Response format (JSON only, no markdown):**
{
  "thinking": "Brief reasoning about what I see and what to do next",
  "action": "action_name",
  "selector": "CSS selector (for click/fill) - USE EXACT SELECTORS FROM detect_form",
  "value": "text value (for fill) or parameter",
  "url": "URL (for goto)",
  "path": "filename (for save)",
  "reason": "Why this action"
}

**Available actions:**
- **browser_launch**: Start the browser. Required if browser is not running.
- **browser_goto**: Navigate to a URL. Requires "url".
- **browser_click**: Click an element. Requires "selector".
- **browser_fill**: Type into an input. Requires "selector" and "value".
- **browser_extract**: Read page content. Essential for understanding what's on the page.
- **browser_screenshot**: Capture the page visually.
- **browser_scroll**: Scroll the page. Use "value": "down" or "up".
- **browser_wait**: Wait for content. Use "value": "2000" for 2 seconds.
- **accept_cookies**: **Use when you see a cookie consent banner!** Automatically clicks "Accept all" or similar buttons.
- **wait_for_user**: **Use when you need human help!** Pauses automation and asks user to complete an action (login, CAPTCHA, verification). Use "value" to explain what they need to do.
- **detect_form**: **MANDATORY before filling forms!** Discovers all form fields with their exact CSS selectors.
- **get_links**: Extract all links on the page.
- **crawl**: Crawl multiple pages. Use "value" for max pages.
- **sitemap**: Generate sitemap of site.
- **save_json**: Save all extracted/crawled data as JSON file. Use "path" for filename (e.g., "products.json").
- **save_csv**: Save data as CSV (great for lists/tables). Use "path" for filename. Data must be array of objects.
- **save_markdown**: Save a formatted report. Use "path" for filename.
- **save_screenshot**: Save current browser view as PNG. Use "path" for filename.
- **done**: Task complete! Use "value" to provide your final answer/summary to the user.

**COOKIE CONSENT:** When you see a cookie banner blocking the page, use **accept_cookies** - it automatically finds and clicks the right button for Google, OneTrust, Cookiebot, and other common consent systems.

**FILE SAVING:** Data is automatically accumulated from:
- browser_fill: Each form field you fill is tracked (field, value, timestamp)
- browser_extract: Page content you extract
- detect_form: Form field definitions
- crawl/sitemap/get_links: URLs and page data
Use save_json or save_csv to write accumulated data to disk. For form submissions, just fill the fields and then save_json to capture what you entered.

**FORM FILLING RULES (CRITICAL!):**
1. NEVER guess form selectors! You MUST use detect_form first.
2. After detect_form, you'll see exact selectors like "#email", "[name='fullName']", "#message"
3. Use those EXACT selectors in browser_fill actions
4. Fill one field at a time, observe the result, then fill the next

**Example: "Go to elsewhen.com and fill the contact form"**
Step 1: { "action": "browser_goto", "url": "https://elsewhen.com", "reason": "Navigate to the site user specified" }
(see page loaded - elsewhen.com homepage)
Step 2: { "action": "browser_click", "selector": "Contact", "reason": "Click link to contact page" }
(see: navigated to contact page)
Step 3: { "action": "detect_form", "reason": "Find form fields and their exact selectors" }
(see: name: #full-name, email: #email, message: #message-text, submit: button[type=submit])
Step 4: { "action": "browser_fill", "selector": "#full-name", "value": "John Doe", "reason": "Fill name field" }
Step 5: { "action": "browser_fill", "selector": "#email", "value": "john@example.com", "reason": "Fill email" }
Step 6: { "action": "browser_fill", "selector": "#message-text", "value": "Hello!", "reason": "Fill message" }
Step 7: { "action": "browser_click", "selector": "button[type=submit]", "reason": "Submit" }
Step 8: { "action": "done", "value": "Filled contact form on elsewhen.com with John Doe, john@example.com", "reason": "Complete" }

**IMPORTANT:** Notice we went to ELSEWHEN.COM because that's what the user asked for - not w3schools or any other site!

**Example: Search Google for information:**
Step 1: { "action": "browser_launch", "reason": "Start browser" }
Step 2: { "action": "browser_goto", "url": "https://www.google.com/search?q=best+AI+coding+tools+2026", "reason": "Go directly to Google search results" }
Step 3: { "action": "accept_cookies", "reason": "Dismiss cookie banner if present" }
Step 4: { "action": "browser_extract", "reason": "Read search results" }
Step 5: { "action": "done", "value": "Found these AI coding tools: 1. Cursor, 2. GitHub Copilot...", "reason": "Summarize results" }

**NOTICE:** We went DIRECTLY to search results URL, not google.com homepage. We did NOT switch to Bing!

**Example: Crawl site and save to CSV:**
Step 1: { "action": "browser_goto", "url": "https://example.com/products", "reason": "Navigate to products page" }
Step 2: { "action": "crawl", "value": "20", "reason": "Crawl up to 20 product pages" }
Step 3: { "action": "save_csv", "path": "products.csv", "reason": "Save crawled data to CSV" }
Step 4: { "action": "done", "value": "Crawled 20 product pages and saved to products.csv", "reason": "Task complete" }

**GOOGLE SEARCH (IMPORTANT!):**
When asked to search Google:
1. Go DIRECTLY to search results URL: https://www.google.com/search?q=YOUR+SEARCH+TERMS
2. Do NOT go to google.com homepage first
3. Do NOT switch to Bing or other search engines - STAY ON GOOGLE
4. If you see a cookie banner, use accept_cookies action
5. If Google asks for login, verification, or CAPTCHA - use **wait_for_user** to ask the user to complete it
6. Example: "search google for best AI tools" → browser_goto: "https://www.google.com/search?q=best+AI+tools+${year}"

**WHEN TO ASK USER FOR HELP (wait_for_user):**
Use wait_for_user when you encounter:
- Login pages (Google, social media, etc.)
- CAPTCHA that you can't solve
- "Verify you're not a robot" prompts
- Two-factor authentication
- Any verification the browser automation can't handle

Example: { "action": "wait_for_user", "value": "Please log into your Google account in the browser window, then click Continue", "reason": "Google requires login" }

**General rules:**
- Be efficient - take the minimum actions needed
- If an action fails, try an alternative approach but STAY on the same site/search engine
- Use browser_extract to read page content when you need information
- When you have enough information to answer the user, use "done"
- Always provide a helpful "value" in your "done" action summarizing what you accomplished
- If user asks to save data, use the appropriate save_* action
- **NEVER switch search engines!** If user says "search google", use ONLY Google. Do NOT fall back to Bing, DuckDuckGo, or any other search engine.
- **NEVER navigate to a different website than what the user asked for!** If user says "elsewhen.com", go ONLY to elsewhen.com, not w3schools or any other site.
- If you can't find something on the user's specified site, report that - don't go to random sites.`;
}

function buildObservationPrompt(task: string, state: WebAgentState): string {
  // Extract any URLs or domains from the task
  const urlMatch = task.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z]{2,})+)(?:\/[^\s]*)?/gi);
  const domainHint = urlMatch ? `\n⚠️ USER SPECIFIED SITE: ${urlMatch[0]} — GO TO THIS EXACT SITE, not a different one!` : '';
  
  let prompt = `**USER TASK:** ${task}${domainHint}\n\n`;
  prompt += `**CURRENT STATE (Step ${state.stepCount}/${state.maxSteps}):**\n`;
  
  if (!state.browserRunning) {
    prompt += '- Browser: NOT RUNNING (start with browser_launch)\n';
  } else {
    prompt += `- Browser: RUNNING\n`;
    prompt += `- URL: ${state.currentUrl || '(blank)'}\n`;
    prompt += `- Title: ${state.currentTitle || '(none)'}\n`;
  }
  
  if (state.lastActionResult) {
    prompt += `\n**LAST ACTION RESULT:**\n${state.lastActionResult}\n`;
  }
  
  if (state.formFields && state.formFields.length > 0) {
    prompt += `\n**🔑 DETECTED FORM FIELDS (use these EXACT selectors for browser_fill):**\n`;
    for (const field of state.formFields) {
      const label = field.label || field.placeholder || field.name || '(unnamed)';
      prompt += `- "${label}": \`${field.selector}\` (${field.type})${field.required ? ' *required*' : ''}\n`;
    }
    prompt += `\n⚠️ USE THE EXACT SELECTORS ABOVE when filling form fields!\n`;
  }
  
  if (state.pageContent) {
    const truncated = state.pageContent.slice(0, 3000);
    prompt += `\n**PAGE CONTENT (truncated):**\n${truncated}\n`;
    if (state.pageContent.length > 3000) {
      prompt += `... (${state.pageContent.length - 3000} more characters)\n`;
    }
  }
  
  prompt += `\n**What is your next action?** Respond with JSON only.`;
  return prompt;
}

function parseAgentResponse(text: string): WebAgentAction | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.action) return null;
    
    return {
      action: parsed.action,
      selector: parsed.selector,
      value: parsed.value,
      url: parsed.url,
      path: parsed.path,
      reason: parsed.reason || parsed.thinking || '',
    };
  } catch {
    return null;
  }
}

export async function runWebAgentLoop(
  task: string,
  callbacks: WebAgentCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const modelStore = useModelStore.getState();
  const modelConfig = modelStore.getModelForRole('orchestrator');
  
  if (!modelConfig) {
    callbacks.onError('No orchestrator model configured. Go to Settings to add one.');
    return;
  }
  
  clearAccumulatedData();
  sessionActions = [];
  sessionDataFiles = [];
  
  // Initialize .codescout_web folder structure at the start of every web task
  await initWebFolder();
  
  const state: WebAgentState = {
    browserRunning: false,
    currentUrl: null,
    currentTitle: null,
    lastActionResult: null,
    pageContent: null,
    formFields: null,
    screenshotBase64: null,
    stepCount: 0,
    maxSteps: MAX_STEPS,
    done: false,
    finalAnswer: null,
    error: null,
  };
  
  // Check initial browser status
  const status = await browserService.getBrowserStatus();
  if (status.success && status.browserRunning) {
    state.browserRunning = true;
    state.currentUrl = status.currentUrl || null;
    state.currentTitle = status.currentTitle || null;
  }
  
  callbacks.onStateChange({ ...state });
  
  // Build system prompt with history context
  const systemPrompt = await buildAgentSystemPrompt();
  const messages: ModelRequestMessage[] = [
    { role: 'system', content: systemPrompt },
  ];
  
  while (!state.done && state.stepCount < state.maxSteps) {
    if (abortSignal?.aborted) {
      state.error = 'Aborted by user';
      // Record history on abort
      recordWebHistory({
        task,
        url: state.currentUrl || undefined,
        actions: sessionActions,
        result: 'stopped',
        dataFiles: sessionDataFiles.length > 0 ? sessionDataFiles : undefined,
        timestamp: new Date().toISOString(),
      });
      callbacks.onError(state.error);
      return;
    }
    
    state.stepCount++;
    callbacks.onThinking(`Step ${state.stepCount}: Analyzing page state...`);
    
    // Build observation prompt
    const observationPrompt = buildObservationPrompt(task, state);
    messages.push({ role: 'user', content: observationPrompt });
    
    // Get AI's next action
    let responseText = '';
    try {
      const request = modelToRequest(modelConfig, messages, { maxOutputTokens: 1000 });
      
      await new Promise<void>((resolve, reject) => {
        callModel(
          request,
          (chunk) => { responseText += chunk; },
          () => resolve(),
          reject,
          (usage) => {
            if (callbacks.trackTokens) {
              callbacks.trackTokens(usage.inputTokens || 0, usage.outputTokens || 0, 'orchestrator');
            }
          }
        );
      });
    } catch (err) {
      state.error = `AI error: ${err instanceof Error ? err.message : String(err)}`;
      callbacks.onError(state.error);
      return;
    }
    
    messages.push({ role: 'assistant', content: responseText });
    
    // Parse the action
    const action = parseAgentResponse(responseText);
    if (!action) {
      state.error = 'Failed to parse AI response as action';
      callbacks.onError(state.error);
      return;
    }
    
    callbacks.onAction(action);
    
    // Track action for history
    sessionActions.push(action.action);
    
    // Handle "done" action - use Coder for polished final answer
    if (action.action === 'done') {
      state.done = true;
      const orchestratorSummary = action.value || action.reason || 'Task completed';
      
      // Get accumulated data for Coder analysis
      const accumulatedData = getAccumulatedData();
      const extractedDataStr = accumulatedData.length > 0 
        ? JSON.stringify(accumulatedData.slice(-10), null, 2) // Last 10 items
        : null;
      
      // Use Coder to generate polished final answer (free tokens!)
      state.finalAnswer = await generateCoderAnalysis(
        task,
        orchestratorSummary,
        extractedDataStr,
        state.pageContent,
        callbacks
      );
      
      // Record history on success
      recordWebHistory({
        task,
        url: state.currentUrl || undefined,
        actions: sessionActions,
        result: 'success',
        dataFiles: sessionDataFiles.length > 0 ? sessionDataFiles : undefined,
        timestamp: new Date().toISOString(),
      });
      
      callbacks.onComplete(state.finalAnswer);
      return;
    }
    
    // Handle "wait_for_user" action - pause and ask user to complete something
    if (action.action === 'wait_for_user') {
      const userMessage = action.value || action.reason || 'Please complete the action in the browser window';
      callbacks.onThinking(`⏸️ Waiting for user: ${userMessage}`);
      
      if (callbacks.onActionComplete) {
        callbacks.onActionComplete(action, { success: true, output: `Waiting for user: ${userMessage}` });
      }
      
      if (callbacks.onWaitForUser) {
        // Wait for user to complete the action and click continue
        await callbacks.onWaitForUser(userMessage);
        
        // After user continues, refresh browser state
        const newStatus = await browserService.getBrowserStatus();
        if (newStatus.success) {
          state.browserRunning = newStatus.browserRunning || false;
          if (newStatus.currentUrl) state.currentUrl = newStatus.currentUrl;
          if (newStatus.currentTitle) state.currentTitle = newStatus.currentTitle;
        }
        
        // Extract new page content after user action
        const extractResult = await browserService.browserExtract();
        if (extractResult.success) {
          state.pageContent = extractResult.content || null;
        }
        
        state.lastActionResult = 'User completed the requested action. Continuing...';
        callbacks.onStateChange({ ...state });
        continue; // Continue to next iteration
      } else {
        // No callback provided, just wait a bit and continue
        await new Promise(resolve => setTimeout(resolve, 5000));
        state.lastActionResult = 'Waited 5 seconds for user action';
        continue;
      }
    }
    
    // Execute the action
    callbacks.onThinking(`Executing: ${action.action}...`);
    
    try {
      const result = await executeAgentAction(action, state);
      state.lastActionResult = result.output;
      
      // Notify about action completion with result
      if (callbacks.onActionComplete) {
        callbacks.onActionComplete(action, result);
      }
      
      // Track saved files for history
      if (['save_json', 'save_csv', 'save_markdown', 'save_screenshot'].includes(action.action) && result.success) {
        const fileMatch = result.output.match(/\.codescout_web\/(?:data|screenshots)\/([^\s]+)/);
        if (fileMatch) {
          sessionDataFiles.push(fileMatch[0]);
        }
      }
      
      // Use Coder to analyze large extraction results (free tokens!)
      const DATA_HEAVY_ACTIONS = ['crawl', 'sitemap', 'browser_extract', 'get_links'];
      if (DATA_HEAVY_ACTIONS.includes(action.action) && result.success && result.output.length > 1000) {
        const analyzed = await analyzeExtractedData(action.action, result.output, task, callbacks);
        state.lastActionResult = analyzed;
        // Update the callback with analyzed result
        if (callbacks.onActionComplete) {
          callbacks.onActionComplete(action, { success: true, output: analyzed });
        }
      }
      
      // Update state based on action type
      if (action.action === 'browser_launch') {
        state.browserRunning = true;
      } else if (action.action === 'browser_close') {
        state.browserRunning = false;
        state.currentUrl = null;
        state.currentTitle = null;
        state.pageContent = null;
        state.formFields = null;
      } else if (action.action === 'browser_goto') {
        state.currentUrl = action.url || null;
        state.formFields = null; // Clear form fields on navigation
        state.pageContent = null;
        // Auto-extract page content after navigation
        const extractResult = await browserService.browserExtract();
        if (extractResult.success) {
          state.currentTitle = extractResult.title || null;
          state.currentUrl = extractResult.url || state.currentUrl;
          state.pageContent = extractResult.content || null;
        }
      } else if (action.action === 'browser_extract') {
        if (result.success) {
          state.pageContent = result.output;
        }
      } else if (action.action === 'detect_form') {
        // Parse form fields from result
        const formMatch = result.output.match(/Found \d+ form/);
        if (formMatch) {
          const forms = getAccumulatedData().forms;
          if (forms && forms.length > 0) {
            state.formFields = forms.flatMap((f: { fields: FormField[] }) => f.fields || []);
          }
        }
      }
      
      // Update browser status
      const newStatus = await browserService.getBrowserStatus();
      if (newStatus.success) {
        state.browserRunning = newStatus.browserRunning || false;
        if (newStatus.currentUrl) state.currentUrl = newStatus.currentUrl;
        if (newStatus.currentTitle) state.currentTitle = newStatus.currentTitle;
      }
      
      callbacks.onStateChange({ ...state });
      
    } catch (err) {
      state.lastActionResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
      callbacks.onStateChange({ ...state });
    }
  }
  
  if (!state.done) {
    state.error = `Reached maximum steps (${MAX_STEPS}) without completing task`;
    // Record history on max steps
    recordWebHistory({
      task,
      url: state.currentUrl || undefined,
      actions: sessionActions,
      result: 'error',
      dataFiles: sessionDataFiles.length > 0 ? sessionDataFiles : undefined,
      timestamp: new Date().toISOString(),
    });
    callbacks.onError(state.error);
  }
}

async function executeAgentAction(
  action: WebAgentAction,
  state: WebAgentState
): Promise<{ success: boolean; output: string }> {
  // Map agent action to browser executor
  const step = {
    action: action.action,
    description: action.reason,
    selector: action.selector,
    value: action.value,
    url: action.url,
    path: action.path,
  };
  
  return executeBrowserAction(step as any, console.log);
}

export function isWebTask(message: string): boolean {
  const webKeywords = [
    'go to', 'navigate to', 'open', 'visit', 'browse',
    'click', 'fill', 'form', 'submit', 'search',
    'extract', 'scrape', 'crawl', 'sitemap',
    'website', 'webpage', 'web page', 'url', 'http',
    '.com', '.org', '.io', '.net', '.co',
    'browser', 'screenshot',
  ];
  
  const lower = message.toLowerCase();
  return webKeywords.some(kw => lower.includes(kw));
}
