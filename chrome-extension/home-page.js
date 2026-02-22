/**
 * Home Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/home
 *          sellercentral.amazon.co.uk/home
 *          (and other marketplace home pages)
 *
 * Features:
 *   1. Disburse Payments Panel — shows all marketplace payment dashboards
 *      with one-click "Disburse All" to open each and auto-click
 *      "Request Transfer".
 *   2. Auto-Transfer on Payments Dashboard — when landing on
 *      /payments/dashboard, auto-finds and clicks the Request Transfer
 *      button, then reports status back.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_ID = 'sd-disburse-panel';
  const STATUS_KEY = 'sd_disburse_status';
  const AUTO_DISBURSE_FLAG = 'sd_auto_disburse';

  // All marketplaces with their Seller Central domains and payment dashboard paths.
  const MARKETPLACES = {
    US:  { label: 'US',  flag: '\uD83C\uDDFA\uD83C\uDDF8', domain: 'sellercentral.amazon.com' },
    UK:  { label: 'UK',  flag: '\uD83C\uDDEC\uD83C\uDDE7', domain: 'sellercentral.amazon.co.uk' },
    DE:  { label: 'DE',  flag: '\uD83C\uDDE9\uD83C\uDDEA', domain: 'sellercentral.amazon.de' },
    JP:  { label: 'JP',  flag: '\uD83C\uDDEF\uD83C\uDDF5', domain: 'sellercentral.amazon.co.jp' }
  };

  const PAYMENTS_PATH = '/payments/dashboard/index.html';

  // ============================================================
  // HELPERS
  // ============================================================

  function isHomePage() {
    const path = window.location.pathname;
    return path === '/home' || path === '/home/' || path === '/';
  }

  function isPaymentsDashboard() {
    const path = window.location.pathname;
    return path.includes('/payments/dashboard') || path.includes('/payments/event/view');
  }

  function getCurrentDomain() {
    return window.location.hostname;
  }

  function getCurrentMarketplace() {
    const host = getCurrentDomain();
    for (const [code, mp] of Object.entries(MARKETPLACES)) {
      if (host === mp.domain) return code;
    }
    return 'US';
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ============================================================
  // 1. DISBURSE PANEL ON HOME PAGE
  // ============================================================

  function createDisbursePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const currentMP = getCurrentMarketplace();
    const container = document.createElement('div');
    container.id = PANEL_ID;

    // Build marketplace rows
    let mpRowsHTML = '';
    for (const [code, mp] of Object.entries(MARKETPLACES)) {
      const dashboardUrl = `https://${mp.domain}${PAYMENTS_PATH}`;
      const isCurrent = code === currentMP;
      mpRowsHTML += `
        <div class="sd-disburse-mp-row" data-mp="${code}">
          <div class="sd-disburse-mp-info">
            <span class="sd-disburse-mp-flag">${mp.flag}</span>
            <span class="sd-disburse-mp-label">${mp.label}</span>
            ${isCurrent ? '<span class="sd-disburse-mp-current">(current)</span>' : ''}
          </div>
          <div class="sd-disburse-mp-actions">
            <span class="sd-disburse-mp-status" id="sd-disburse-status-${code}"></span>
            <a href="${dashboardUrl}" target="_blank" class="sd-disburse-mp-btn" data-mp="${code}"
               title="Open ${mp.label} payments dashboard">
              Disburse
            </a>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="sd-disburse-header">
        <div class="sd-disburse-title-row">
          <span class="sd-disburse-logo">SellerData</span>
          <span class="sd-disburse-title">Payment Disbursement</span>
          <button class="sd-disburse-collapse-btn" id="sd-disburse-collapse" title="Collapse">&minus;</button>
        </div>
        <p class="sd-disburse-desc">Request transfer of available balance across all marketplaces. Disbursement is limited to once per 24 hours per marketplace.</p>
      </div>
      <div class="sd-disburse-body" id="sd-disburse-body">
        <div class="sd-disburse-mp-list">
          ${mpRowsHTML}
        </div>
        <div class="sd-disburse-all-section">
          <button class="sd-disburse-all-btn" id="sd-disburse-all">
            Disburse All Marketplaces
          </button>
        </div>
        <div class="sd-disburse-log hidden" id="sd-disburse-log"></div>
      </div>
    `;

    // Insert at the top of the main content area
    const anchor = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"], .home-page-container'
    );
    if (anchor) {
      anchor.insertBefore(container, anchor.firstChild);
    } else {
      // Fallback: insert after the top nav
      const nav = document.querySelector('nav, header, #sc-navbar, [class*="navbar"]');
      if (nav && nav.parentElement) {
        nav.parentElement.insertBefore(container, nav.nextSibling);
      } else {
        document.body.prepend(container);
      }
    }

    // ---- Event: Collapse/Expand ----
    const collapseBtn = document.getElementById('sd-disburse-collapse');
    const body = document.getElementById('sd-disburse-body');
    collapseBtn.addEventListener('click', () => {
      const isCollapsed = body.classList.toggle('sd-disburse-collapsed');
      collapseBtn.textContent = isCollapsed ? '+' : '\u2212';
      collapseBtn.title = isCollapsed ? 'Expand' : 'Collapse';
    });

    // ---- Event: Individual disburse buttons ----
    container.querySelectorAll('.sd-disburse-mp-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const code = btn.dataset.mp;
        openDisbursePage(code);
      });
    });

    // ---- Event: Disburse All ----
    document.getElementById('sd-disburse-all').addEventListener('click', () => {
      disburseAll();
    });

    // Restore any previous status
    restoreStatuses();
  }

  /**
   * Open a single marketplace's payments dashboard with auto-disburse flag.
   */
  function openDisbursePage(marketplaceCode) {
    const mp = MARKETPLACES[marketplaceCode];
    if (!mp) return;

    const url = `https://${mp.domain}${PAYMENTS_PATH}?sd_auto=1`;
    updateStatus(marketplaceCode, 'opening', 'Opening...');
    window.open(url, `_sd_disburse_${marketplaceCode}`);
  }

  /**
   * Open all marketplace payment dashboards in sequence.
   */
  async function disburseAll() {
    const btn = document.getElementById('sd-disburse-all');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Opening marketplaces...';
    }

    logMessage('Starting disbursement for all marketplaces...');

    const codes = Object.keys(MARKETPLACES);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      openDisbursePage(code);
      logMessage(`Opened ${MARKETPLACES[code].label} payments dashboard`);
      // Stagger tab openings to avoid browser blocking popups
      if (i < codes.length - 1) {
        await sleep(800);
      }
    }

    if (btn) {
      btn.textContent = 'All marketplaces opened';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Disburse All Marketplaces';
      }, 5000);
    }

    logMessage('All marketplace tabs opened. Transfer will be requested automatically on each page.');
  }

  // ============================================================
  // STATUS TRACKING
  // ============================================================

  function updateStatus(marketplaceCode, state, message) {
    const el = document.getElementById(`sd-disburse-status-${marketplaceCode}`);
    if (el) {
      el.textContent = message;
      el.className = `sd-disburse-mp-status sd-disburse-status-${state}`;
    }

    // Persist to storage for cross-tab updates
    try {
      const statuses = JSON.parse(sessionStorage.getItem(STATUS_KEY) || '{}');
      statuses[marketplaceCode] = { state, message, timestamp: Date.now() };
      sessionStorage.setItem(STATUS_KEY, JSON.stringify(statuses));
    } catch { /* ignore */ }
  }

  function restoreStatuses() {
    try {
      const statuses = JSON.parse(sessionStorage.getItem(STATUS_KEY) || '{}');
      for (const [code, status] of Object.entries(statuses)) {
        // Only show statuses from the last 10 minutes
        if (Date.now() - status.timestamp < 10 * 60 * 1000) {
          const el = document.getElementById(`sd-disburse-status-${code}`);
          if (el) {
            el.textContent = status.message;
            el.className = `sd-disburse-mp-status sd-disburse-status-${status.state}`;
          }
        }
      }
    } catch { /* ignore */ }
  }

  function logMessage(message) {
    const log = document.getElementById('sd-disburse-log');
    if (!log) return;
    log.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = 'sd-disburse-log-line';
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // ============================================================
  // 2. AUTO-TRANSFER ON PAYMENTS DASHBOARD
  // ============================================================

  /**
   * When on the payments dashboard page, auto-find and click
   * the "Request Transfer" / "Request payment" button.
   */
  async function autoClickTransfer() {
    // Check if we were opened with auto-disburse intent
    const urlParams = new URLSearchParams(window.location.search);
    const isAutoDisburse = urlParams.get('sd_auto') === '1';

    if (!isAutoDisburse) return;

    const currentMP = getCurrentMarketplace();

    // Show a small status indicator on the page
    showPageStatus('Looking for Request Transfer button...', 'info');

    // Wait for the page to fully load
    await sleep(2500);

    const transferBtn = findTransferButton();

    if (transferBtn) {
      showPageStatus('Found transfer button, clicking...', 'info');
      await sleep(500);

      transferBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(500);

      // Highlight briefly before clicking
      transferBtn.style.outline = '3px solid #ff9900';
      transferBtn.style.outlineOffset = '3px';
      await sleep(300);

      transferBtn.click();

      await sleep(2000);

      // Check if a confirmation dialog appeared
      const confirmed = await handleTransferConfirmation();

      if (confirmed) {
        showPageStatus('Transfer requested successfully!', 'success');
        broadcastStatus(currentMP, 'success', 'Transferred');
      } else {
        // The click itself may have been enough (no confirmation needed)
        showPageStatus('Transfer button clicked. Check if disbursement was initiated.', 'success');
        broadcastStatus(currentMP, 'success', 'Clicked');
      }
    } else {
      // Check if the balance is zero or transfer not available
      const reason = detectUnavailableReason();
      if (reason) {
        showPageStatus(reason, 'warn');
        broadcastStatus(currentMP, 'unavailable', reason);
      } else {
        showPageStatus('Could not find Request Transfer button. It may not be available right now (24hr cooldown).', 'warn');
        broadcastStatus(currentMP, 'unavailable', '24hr cooldown');
      }
    }
  }

  /**
   * Find the "Request Transfer" / "Request payment" / "Request Transfer Now" button.
   * Amazon uses various button implementations across regions.
   */
  function findTransferButton() {
    // Strategy 1: Specific selectors
    const selectors = [
      'button[data-testid*="transfer"], button[data-testid*="disburse"], button[data-testid*="payout"]',
      'a[data-testid*="transfer"], a[data-testid*="disburse"]',
      'kat-button[label*="Transfer"], kat-button[label*="transfer"]',
      'kat-button[label*="Disburse"], kat-button[label*="disburse"]',
      '[data-testid*="request-transfer"]',
      '[data-testid*="request-payment"]',
      'input[type="submit"][value*="Transfer"]',
      'input[type="submit"][value*="transfer"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }

    // Strategy 2: Text-based search across all clickable elements
    const transferPhrases = [
      'request transfer now',
      'request transfer',
      'request payment',
      'request disbursement',
      'disburse now',
      'transfer now',
      'request payout'
    ];

    const clickables = document.querySelectorAll(
      'button, a, input[type="submit"], input[type="button"], kat-button, [role="button"], span[role="button"]'
    );

    for (const el of clickables) {
      if (!isVisible(el)) continue;
      const text = (el.textContent || el.value || el.getAttribute('label') || '').toLowerCase().trim();
      for (const phrase of transferPhrases) {
        if (text.includes(phrase)) return el;
      }
    }

    // Strategy 3: Look inside shadow DOMs (Amazon uses web components)
    const katButtons = document.querySelectorAll('kat-button');
    for (const kb of katButtons) {
      const label = (kb.getAttribute('label') || '').toLowerCase();
      const text = (kb.textContent || '').toLowerCase();
      if (label.includes('transfer') || label.includes('disburse') ||
          text.includes('transfer') || text.includes('disburse')) {
        return kb;
      }
    }

    // Strategy 4: Look for links that might be styled as buttons
    const links = document.querySelectorAll('a[href*="disburse"], a[href*="transfer"], a[href*="payout"]');
    for (const link of links) {
      if (isVisible(link)) return link;
    }

    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Handle a confirmation dialog/modal that may appear after clicking transfer.
   */
  async function handleTransferConfirmation() {
    // Wait a moment for modal/dialog to appear
    await sleep(1000);

    // Look for confirmation dialog
    const dialogs = document.querySelectorAll(
      '[role="dialog"], .modal, [class*="modal"], [class*="Modal"], [class*="confirmation"], [class*="Confirmation"]'
    );

    for (const dialog of dialogs) {
      if (!isVisible(dialog)) continue;

      // Find confirm/yes/ok button inside the dialog
      const btns = dialog.querySelectorAll('button, [role="button"], kat-button, a');
      for (const btn of btns) {
        const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase().trim();
        if (text.includes('confirm') || text.includes('yes') || text.includes('ok') ||
            text.includes('transfer') || text.includes('disburse') || text.includes('proceed')) {
          btn.click();
          await sleep(1000);
          return true;
        }
      }
    }

    // Also check for inline confirmation buttons (not in modal)
    const allBtns = document.querySelectorAll('button, [role="button"], kat-button');
    for (const btn of allBtns) {
      const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase().trim();
      if (text.includes('confirm transfer') || text.includes('confirm disbursement') ||
          text.includes('yes, transfer') || text.includes('confirm payout')) {
        btn.click();
        await sleep(1000);
        return true;
      }
    }

    return false;
  }

  /**
   * Detect why the transfer button might not be available.
   */
  function detectUnavailableReason() {
    const pageText = document.body.innerText.toLowerCase();

    if (pageText.includes('not eligible for disbursement')) {
      return 'Not eligible for disbursement';
    }
    if (pageText.includes('available balance is zero') || pageText.includes('available balance is $0')) {
      return 'Balance is zero';
    }
    if (pageText.includes('already requested') || pageText.includes('transfer already')) {
      return 'Already requested today';
    }
    if (pageText.includes('once every 24') || pageText.includes('24 hour')) {
      return '24hr cooldown active';
    }
    if (pageText.includes('payment is being processed') || pageText.includes('transfer in progress')) {
      return 'Transfer already in progress';
    }

    // Check for zero balance display
    const balanceEls = document.querySelectorAll(
      '[data-testid*="balance"], [class*="balance"], [class*="Balance"]'
    );
    for (const el of balanceEls) {
      const text = el.textContent.trim();
      if (text === '$0.00' || text === '0.00' || text === '\u00A30.00' || text === '\u20AC0.00' || text === '\u00A50') {
        return 'Balance is zero';
      }
    }

    return null;
  }

  /**
   * Broadcast the transfer status back to the home page via storage.
   */
  function broadcastStatus(marketplaceCode, state, message) {
    try {
      chrome.storage.local.get('sd_disburse_results', (data) => {
        const results = data.sd_disburse_results || {};
        results[marketplaceCode] = { state, message, timestamp: Date.now() };
        chrome.storage.local.set({ sd_disburse_results: results });
      });
    } catch { /* ignore */ }
  }

  /**
   * Show a status banner on the payments dashboard page.
   */
  function showPageStatus(message, type) {
    let banner = document.getElementById('sd-disburse-page-status');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'sd-disburse-page-status';
      document.body.prepend(banner);
    }
    banner.textContent = `SellerData: ${message}`;
    banner.className = `sd-disburse-page-status sd-disburse-page-status-${type}`;
  }

  // ============================================================
  // HOME PAGE: LISTEN FOR CROSS-TAB STATUS UPDATES
  // ============================================================

  function listenForStatusUpdates() {
    if (!isHomePage()) return;

    // Poll storage for updates from payments dashboard tabs
    const pollInterval = setInterval(() => {
      chrome.storage.local.get('sd_disburse_results', (data) => {
        const results = data.sd_disburse_results || {};
        for (const [code, result] of Object.entries(results)) {
          if (Date.now() - result.timestamp < 10 * 60 * 1000) {
            updateStatus(code, result.state, result.message);
          }
        }
      });
    }, 2000);

    // Stop polling after 10 minutes
    setTimeout(() => clearInterval(pollInterval), 10 * 60 * 1000);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async function init() {
    if (isHomePage()) {
      // Wait for page content to load
      await sleep(1000);
      createDisbursePanel();
      listenForStatusUpdates();
    } else if (isPaymentsDashboard()) {
      autoClickTransfer();
    }
  }

  init();
})();
