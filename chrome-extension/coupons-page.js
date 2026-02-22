/**
 * Coupons & Promotions Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/coupons/
 *          sellercentral.amazon.com/promotions/
 *          sellercentral.amazon.com/merchandising/
 *
 * Features:
 *   1. Consolidated Dashboard — stat cards showing total active coupons,
 *      active promotions, total budget/spend, and estimated redemption rates.
 *   2. Performance Highlighting — rows color-coded by ROI:
 *        - Green  = good redemption rate / positive ROI
 *        - Yellow = moderate / watch
 *        - Red    = burning budget with low redemptions
 *   3. Bulk Actions — "Pause All Losing" button to bulk-deactivate
 *      coupons/promotions with spend but no/low conversions.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_ID = 'sd-coupons-panel';
  const LOG_ID = 'sd-coupons-log';

  // Thresholds for performance highlighting
  const GOOD_REDEMPTION_PCT = 5;   // 5%+ redemption rate = green
  const WARN_REDEMPTION_PCT = 1;   // 1-5% = yellow, <1% = red

  // ============================================================
  // HELPERS
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('timeout')); }, timeout);
    });
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function parseNumber(text) {
    if (!text) return 0;
    return parseFloat(text.replace(/[^0-9.-]/g, '')) || 0;
  }

  function formatCurrency(val) {
    return '$' + val.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ============================================================
  // ROW DISCOVERY
  // ============================================================

  function getRows() {
    const selectors = [
      'table tbody tr',
      '[data-testid*="coupon-row"]',
      '[data-testid*="promotion-row"]',
      '[class*="coupon-row"]',
      '[class*="CouponRow"]',
      '[class*="promotion-row"]',
      '[class*="PromotionRow"]',
      '[role="row"]',
      'kat-table-row'
    ];

    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      const filtered = Array.from(rows).filter(r =>
        !r.querySelector('th') && r.textContent.trim().length > 10
      );
      if (filtered.length > 0) return filtered;
    }
    return [];
  }

  // ============================================================
  // DATA EXTRACTION
  // ============================================================

  /**
   * Extract coupon/promotion data from a row.
   */
  function extractRowData(row) {
    const text = row.textContent || '';
    const cells = row.querySelectorAll('td');

    const data = {
      row,
      name: '',
      status: 'unknown',
      type: 'unknown', // coupon, promo, social
      budget: 0,
      spend: 0,
      redemptions: 0,
      clips: 0, // for coupons: number of clips
      impressions: 0,
      startDate: '',
      endDate: '',
      asin: ''
    };

    // Name
    const nameEl = row.querySelector(
      'a, [class*="name"], [class*="Name"], [class*="title"], [class*="Title"], ' +
      '[data-testid*="name"], [data-testid*="title"]'
    );
    if (nameEl) data.name = nameEl.textContent.trim().substring(0, 100);

    // ASIN
    const asinMatch = text.match(/\b(B[A-Z0-9]{9})\b/);
    if (asinMatch) data.asin = asinMatch[1];

    // Status
    const statusEl = row.querySelector(
      '[class*="status"], [class*="Status"], [data-testid*="status"]'
    );
    const statusText = statusEl ? statusEl.textContent.toLowerCase().trim() : text.toLowerCase();
    if (/active|running|live|enabled/.test(statusText)) data.status = 'active';
    else if (/expired|ended|completed|past/.test(statusText)) data.status = 'expired';
    else if (/scheduled|upcoming|pending/.test(statusText)) data.status = 'scheduled';
    else if (/paused|inactive|disabled|stopped/.test(statusText)) data.status = 'paused';
    else if (/draft/.test(statusText)) data.status = 'draft';

    // Type detection
    const url = window.location.href.toLowerCase();
    if (url.includes('coupon')) data.type = 'coupon';
    else if (url.includes('promotion')) data.type = 'promotion';
    if (/social\s*media|promo\s*code/i.test(text)) data.type = 'social';

    // Extract numeric values from cells
    cells.forEach(cell => {
      const cellText = cell.textContent.trim();
      const lower = cellText.toLowerCase();

      // Budget/Spend (look for dollar amounts)
      if (/\$/.test(cellText)) {
        const val = parseNumber(cellText);
        if (val > 0) {
          // First dollar value is typically budget, second is spend
          if (data.budget === 0) data.budget = val;
          else if (data.spend === 0) data.spend = val;
        }
      }

      // Redemptions / clips (pure numbers)
      if (/^\d[\d,]*$/.test(cellText.replace(/\s/g, ''))) {
        const val = parseInt(cellText.replace(/[^0-9]/g, ''));
        if (val > 0) {
          if (/clip|claim|saved/i.test(lower) || /clip|claim/i.test(cell.className || '')) {
            data.clips = val;
          } else if (/redeem|used|order|conversion/i.test(lower)) {
            data.redemptions = val;
          } else if (/impression|view/i.test(lower)) {
            data.impressions = val;
          } else if (data.redemptions === 0 && val < 10000) {
            data.redemptions = val;
          } else if (data.impressions === 0) {
            data.impressions = val;
          }
        }
      }
    });

    // Also check for column-header associations
    const headerCells = document.querySelectorAll('th');
    cells.forEach((cell, i) => {
      const header = headerCells[i];
      if (!header) return;
      const headerText = header.textContent.toLowerCase();
      const val = parseNumber(cell.textContent);

      if (/budget/.test(headerText) && val > 0) data.budget = val;
      if (/spend|cost/.test(headerText) && val > 0) data.spend = val;
      if (/redeem|order|conversion/.test(headerText) && val > 0) data.redemptions = val;
      if (/clip|claim|save/.test(headerText) && val > 0) data.clips = val;
      if (/impression|view/.test(headerText) && val > 0) data.impressions = val;
    });

    return data;
  }

  // ============================================================
  // PERFORMANCE CLASSIFICATION
  // ============================================================

  function classifyPerformance(data) {
    // Only classify active/expired items with some data
    if (data.status !== 'active' && data.status !== 'expired') return 'neutral';

    // Calculate redemption rate
    const base = data.clips > 0 ? data.clips : data.impressions;
    if (base === 0 && data.spend === 0) return 'neutral'; // no data yet

    const redemptionRate = base > 0 ? (data.redemptions / base) * 100 : 0;

    // If we have spend but no redemptions, it's losing
    if (data.spend > 0 && data.redemptions === 0) return 'losing';

    if (redemptionRate >= GOOD_REDEMPTION_PCT) return 'winning';
    if (redemptionRate >= WARN_REDEMPTION_PCT) return 'moderate';
    if (data.spend > 0) return 'losing';

    return 'neutral';
  }

  // ============================================================
  // HIGHLIGHTING
  // ============================================================

  function highlightRows(allData) {
    for (const data of allData) {
      const perf = classifyPerformance(data);
      data.performance = perf;

      data.row.classList.remove(
        'sd-coupon-winning', 'sd-coupon-moderate', 'sd-coupon-losing', 'sd-coupon-neutral'
      );

      switch (perf) {
        case 'winning': data.row.classList.add('sd-coupon-winning'); break;
        case 'moderate': data.row.classList.add('sd-coupon-moderate'); break;
        case 'losing': data.row.classList.add('sd-coupon-losing'); break;
        default: data.row.classList.add('sd-coupon-neutral'); break;
      }
    }
  }

  // ============================================================
  // BULK ACTIONS
  // ============================================================

  let isPausing = false;

  async function pauseLosingCoupons(allData) {
    if (isPausing) return;
    isPausing = true;

    const losers = allData.filter(d => d.performance === 'losing' && d.status === 'active');

    if (losers.length === 0) {
      couponLog('No losing active coupons/promotions to pause.');
      isPausing = false;
      return;
    }

    const btn = document.getElementById('sd-coupon-pause');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Pausing...';
    }

    couponLog(`Attempting to pause ${losers.length} losing coupon(s)/promotion(s)...`);

    let paused = 0;
    let failed = 0;

    for (let i = 0; i < losers.length; i++) {
      const data = losers[i];
      couponLog(`[${i + 1}/${losers.length}] Pausing "${data.name || data.asin || 'unknown'}"...`);

      try {
        // Find deactivate/pause button within the row
        const actionBtn = findPauseButton(data.row);
        if (actionBtn) {
          actionBtn.click();
          await sleep(1500);

          // Handle confirmation dialog
          await handleConfirmDialog();
          paused++;
          couponLog(`  Paused successfully`, 'ok');
        } else {
          couponLog(`  No pause/deactivate button found`, 'warn');
          failed++;
        }
      } catch (err) {
        couponLog(`  Error: ${err.message}`, 'error');
        failed++;
      }

      if (i < losers.length - 1) await sleep(1000);
    }

    couponLog(`Done! ${paused} paused, ${failed} failed.`);
    isPausing = false;

    if (btn) {
      btn.disabled = false;
      btn.textContent = `Pause Losing (${losers.length})`;
    }
  }

  function findPauseButton(row) {
    // Look for pause/deactivate/stop actions
    const btns = row.querySelectorAll('button, a, [role="button"], kat-button');
    for (const btn of btns) {
      const text = (btn.textContent || btn.getAttribute('label') || '').toLowerCase();
      if (/pause|deactivate|stop|disable|end|cancel/.test(text) && isVisible(btn)) {
        return btn;
      }
    }

    // Look in action menus (kebab / dropdown)
    const menuBtn = row.querySelector(
      '[data-testid*="action"], [class*="action"], [class*="kebab"], ' +
      '[class*="menu"], button[aria-haspopup]'
    );
    if (menuBtn) {
      menuBtn.click();
      // Check dropdown items
      const menuItems = document.querySelectorAll(
        '[role="menuitem"], [class*="menu-item"], [class*="dropdown-item"]'
      );
      for (const item of menuItems) {
        const text = (item.textContent || '').toLowerCase();
        if (/pause|deactivate|stop|disable|end/.test(text)) {
          return item;
        }
      }
    }

    return null;
  }

  async function handleConfirmDialog() {
    await sleep(500);
    const dialogs = document.querySelectorAll('[role="dialog"], .modal, [class*="modal"], [class*="Modal"]');
    for (const dialog of dialogs) {
      if (!isVisible(dialog)) continue;
      const confirmBtns = dialog.querySelectorAll('button, [role="button"]');
      for (const btn of confirmBtns) {
        const text = (btn.textContent || '').toLowerCase();
        if (/confirm|yes|ok|deactivate|pause|stop/.test(text)) {
          btn.click();
          await sleep(500);
          return;
        }
      }
    }
  }

  // ============================================================
  // UI: PANEL
  // ============================================================

  function createPanel(allData) {
    let panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    // Tally stats
    const active = allData.filter(d => d.status === 'active');
    const totalBudget = active.reduce((sum, d) => sum + d.budget, 0);
    const totalSpend = active.reduce((sum, d) => sum + d.spend, 0);
    const totalRedemptions = active.reduce((sum, d) => sum + d.redemptions, 0);
    const totalClips = active.reduce((sum, d) => sum + d.clips, 0);
    const losing = allData.filter(d => d.performance === 'losing' && d.status === 'active');
    const winning = allData.filter(d => d.performance === 'winning');

    const redemptionRate = totalClips > 0
      ? ((totalRedemptions / totalClips) * 100).toFixed(1)
      : '—';

    panel.innerHTML = `
      <div class="sd-coupon-header">
        <span class="sd-coupon-logo">SellerData</span>
        <span class="sd-coupon-title">Coupons & Promotions Dashboard</span>
      </div>
      <div class="sd-coupon-stats">
        <div class="sd-coupon-stat">
          <span class="sd-coupon-stat-count">${active.length}</span>
          <span class="sd-coupon-stat-label">Active</span>
        </div>
        <div class="sd-coupon-stat">
          <span class="sd-coupon-stat-count">${formatCurrency(totalBudget)}</span>
          <span class="sd-coupon-stat-label">Total Budget</span>
        </div>
        <div class="sd-coupon-stat">
          <span class="sd-coupon-stat-count">${formatCurrency(totalSpend)}</span>
          <span class="sd-coupon-stat-label">Total Spend</span>
        </div>
        <div class="sd-coupon-stat">
          <span class="sd-coupon-stat-count">${totalRedemptions.toLocaleString()}</span>
          <span class="sd-coupon-stat-label">Redemptions</span>
        </div>
        <div class="sd-coupon-stat">
          <span class="sd-coupon-stat-count">${redemptionRate}${redemptionRate !== '—' ? '%' : ''}</span>
          <span class="sd-coupon-stat-label">Redemption Rate</span>
        </div>
      </div>
      <div class="sd-coupon-perf-summary">
        <span class="sd-coupon-perf-item sd-coupon-perf-good">${winning.length} performing well</span>
        <span class="sd-coupon-perf-item sd-coupon-perf-bad">${losing.length} burning budget</span>
      </div>
      ${losing.length > 0 ? `
      <div class="sd-coupon-actions">
        <button class="sd-coupon-pause-btn" id="sd-coupon-pause">
          Pause ${losing.length} Losing Coupon${losing.length !== 1 ? 's' : ''}
        </button>
        <span class="sd-coupon-action-note">Deactivates active coupons/promotions with spend but no conversions</span>
      </div>
      ` : ''}
      <div class="sd-coupon-log hidden" id="${LOG_ID}"></div>
    `;

    const anchor = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    );
    if (anchor) {
      anchor.insertBefore(panel, anchor.firstChild);
    } else {
      document.body.prepend(panel);
    }

    // Pause button handler
    const pauseBtn = document.getElementById('sd-coupon-pause');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => pauseLosingCoupons(allData));
    }
  }

  function couponLog(message, type = 'info') {
    const log = document.getElementById(LOG_ID);
    if (!log) { console.log(`[SellerData Coupons] ${message}`); return; }
    log.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = `sd-coupon-log-line sd-coupon-log-${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isCouponsPage() {
    const url = window.location.href;
    return /\/coupons/.test(url) || /\/promotions/.test(url) || /\/merchandising/.test(url);
  }

  async function init() {
    if (!isCouponsPage()) return;

    try {
      await waitForElement(
        'table, [data-testid*="coupon"], [data-testid*="promotion"], ' +
        '[class*="coupon"], [class*="Coupon"], [class*="promotion"], ' +
        '[role="table"], [role="grid"], kat-table',
        20000
      );
    } catch { /* still attempt */ }

    await sleep(1500);

    const rows = getRows();
    const allData = rows.map(extractRowData);

    highlightRows(allData);
    createPanel(allData);

    // Re-process on page changes
    const observer = new MutationObserver(() => {
      const rows = getRows();
      const allData = rows.map(extractRowData);
      highlightRows(allData);
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });

    console.log(`[SellerData] Coupons/Promotions: ${allData.length} items, ${allData.filter(d => d.performance === 'losing').length} losing`);
  }

  init();
})();
