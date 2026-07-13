import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';
import { setupMockDOM } from './mock-dom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  console.log('=== STARTING TIER 5 ADVERSARIAL VERIFICATION ===');
  let allPassed = true;

  function reportResult(name, passed, details = '') {
    if (passed) {
      console.log(`[PASS] ${name} ${details ? '- ' + details : ''}`);
    } else {
      console.log(`[FAIL] ${name} ${details ? '- ' + details : ''}`);
      allPassed = false;
    }
  }

  // 1. Hex colors validation
  try {
    const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
    const requiredColors = [
      '#14110F', '#1C1815', '#241F1A', '#2C2620', '#EDE7DE', '#A89E90', '#6B6153',
      '#7A2333', '#163832', '#1B2A44', '#5FA37A', '#C1584A'
    ];
    let missingColors = [];
    for (const color of requiredColors) {
      if (!new RegExp(color, 'i').test(cleanCss)) missingColors.push(color);
    }
    reportResult('CSS Colors Used Check', missingColors.length === 0, missingColors.length === 0 ? 'All 12 required hex colors are used.' : `Missing: ${missingColors.join(', ')}`);
  } catch (err) { reportResult('CSS Colors Used Check', false, err.message); }

  // 2. Banned colors validation
  try {
    const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
    const bannedColorRegex = /#(?:000000|000|ffffff|fff)\b/gi;
    const matches = cleanCss.match(bannedColorRegex);
    reportResult('Banned Colors Check', matches === null, matches === null ? 'No banned colors found.' : `Found banned colors: ${Array.from(new Set(matches)).join(', ')}`);
  } catch (err) { reportResult('Banned Colors Check', false, err.message); }

  // 3. Glassmorphic properties
  try {
    const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
    const hasGlass = /backdrop-filter/i.test(cleanCss);
    reportResult('Glassmorphic Check', !hasGlass, !hasGlass ? 'No backdrop-filter found.' : 'Found backdrop-filter property.');
  } catch (err) { reportResult('Glassmorphic Check', false, err.message); }

  // 4. Fonts imported
  try {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const fontLinkRegex = /fonts\.googleapis\.com\/css2\?[^"]+/g;
    const matches = htmlContent.match(fontLinkRegex) || [];
    const families = [];
    for (const match of matches) {
      const urlParams = new URLSearchParams(match.split('?')[1]);
      for (const [key, value] of urlParams.entries()) {
        if (key === 'family') families.push(value.split(':')[0].replace(/\+/g, ' '));
      }
    }
    const expectedFonts = ['Fraunces', 'Manrope', 'JetBrains Mono'];
    const invalidFonts = families.filter(f => !expectedFonts.includes(f));
    const missingExpected = expectedFonts.filter(f => !families.includes(f));
    const fontsValid = invalidFonts.length === 0 && missingExpected.length === 0;
    reportResult('Fonts Import Check', fontsValid, fontsValid ? 'Exclusively imports expected fonts.' : `Invalid: [${invalidFonts.join(', ')}], Missing: [${missingExpected.join(', ')}]`);
  } catch (err) { reportResult('Fonts Import Check', false, err.message); }

  // 5. Border Radius
  try {
    const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
    const hasRadiusSm8 = /--radius-sm:\s*8px/i.test(cleanCss);
    const hasRadiusMd8 = /--radius-md:\s*8px/i.test(cleanCss);
    const hasRadiusLg10 = /--radius-lg:\s*10px/i.test(cleanCss);
    const hasRadiusXl10 = /--radius-xl:\s*10px/i.test(cleanCss);
    const varsCorrect = hasRadiusSm8 && hasRadiusMd8 && hasRadiusLg10 && hasRadiusXl10;
    reportResult('CSS Border Radii Tokens Check', varsCorrect, `sm: ${hasRadiusSm8}, md: ${hasRadiusMd8}, lg: ${hasRadiusLg10}, xl: ${hasRadiusXl10}`);
  } catch (err) { reportResult('CSS Border Radii Tokens Check', false, err.message); }

  // 6 & 7. DOM Loading and Functionality
  try {
    setupMockDOM(3001);
    global.localStorage.setItem('sajan-provider', 'google');
    global.localStorage.setItem('sajan_username', 'bob');

    // Mock global fetch returning successful mock payloads
    global.fetch = async (url, options) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/api/config')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { provider: 'google', model: '' } })
        };
      }
      if (u.includes('/api/conversations') || u.includes('/api/memories') || u.includes('/api/preferences')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [] })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      };
    };

    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    let consoleErrors = [];
    let consoleWarnings = [];

    console.error = (...args) => {
      consoleErrors.push(args.join(' '));
      originalConsoleError.apply(console, args);
    };
    console.warn = (...args) => {
      consoleWarnings.push(args.join(' '));
      originalConsoleWarn.apply(console, args);
    };

    const appJsPath = path.join(__dirname, '..', 'public', 'app.js');
    let appJsContent = fs.readFileSync(appJsPath, 'utf8');
    appJsContent = appJsContent
      .replace('const state =', () => 'global.state =')
      .replace('const $ =', () => 'global.$ =')
      .replace('const $$ =', () => 'global.$$ =');

    const context = vm.createContext(global);
    const script = new vm.Script(appJsContent, { filename: 'app.js' });
    script.runInContext(context);

    // Dispatch DOMContentLoaded
    global.document.dispatchEvent('DOMContentLoaded');

    // Wait a brief moment for any initial async task to settle
    await new Promise(r => setTimeout(r, 50));

    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    reportResult('0 Console Errors on App Load Check', consoleErrors.length === 0, consoleErrors.length === 0 ? 'Application loaded with 0 console errors.' : `Errors: ${consoleErrors.join('; ')}`);

    // State check
    reportResult('Exposed State Object Check', global.state !== undefined);

    // Mode Toggle Check
    const modeBtn = global.document.querySelector('.mode-btn');
    const badge = global.document.querySelector('#model-badge');

    let modeSwitchOk = false;
    if (modeBtn && badge) {
      // Trigger High Mode Click
      modeBtn.dataset.mode = 'high';
      modeBtn.click();
      const highModeOk = global.state.intelligenceMode === 'high';
      const highBadgeOk = badge.textContent === 'Gemini 1.5 Pro';

      // Trigger Low Mode Click
      modeBtn.dataset.mode = 'low';
      modeBtn.click();
      const lowModeOk = global.state.intelligenceMode === 'low';
      const lowBadgeOk = badge.textContent === 'Gemini 1.5 Flash';

      // Trigger Med Mode Click
      modeBtn.dataset.mode = 'medium';
      modeBtn.click();
      const medModeOk = global.state.intelligenceMode === 'medium';
      const medBadgeOk = badge.textContent === 'Gemini 2.5 Flash';

      modeSwitchOk = highModeOk && highBadgeOk && lowModeOk && lowBadgeOk && medModeOk && medBadgeOk;
    }

    reportResult('Mode Switching State Updates Check', modeSwitchOk);

    // Reasoning panel close and open toggle
    const reasoningPanel = global.document.querySelector('#reasoning-panel');
    const reasoningToggleBtn = global.document.querySelector('#reasoning-toggle-btn');
    const reasoningCloseBtn = global.document.querySelector('#reasoning-close');

    let collapsibleOk = false;
    if (reasoningPanel && reasoningToggleBtn && reasoningCloseBtn) {
      reasoningPanel.style.display = 'none';

      reasoningToggleBtn.click();
      const flexOk = reasoningPanel.style.display === 'flex';

      reasoningCloseBtn.click();
      const noneOk = reasoningPanel.style.display === 'none';

      collapsibleOk = flexOk && noneOk;
    }
    reportResult('Reasoning Panel Collapsible State Check', collapsibleOk);

  } catch (err) {
    reportResult('DOM and Functionality Check', false, err.stack);
  }

  if (allPassed) {
    console.log('\n*** TIER 5 ADVERSARIAL VERIFICATION COMPLETED: ALL CHECKS PASSED ***');
    process.exit(0);
  } else {
    console.log('\n*** TIER 5 ADVERSARIAL VERIFICATION COMPLETED: SOME CHECKS FAILED ***');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
