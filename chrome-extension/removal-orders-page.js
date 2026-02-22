/**
 * Removal Orders Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/inventory/removal-order/
 *          sellercentral.amazon.com/gp/fba/removal-order-list.html
 *          sellercentral.amazon.com/recoveries/removal-order
 *
 * Features:
 *   1. Stuck Order Detection — flags removal orders that have been
 *      in "Processing" or "Pending" for 30+ days (configurable).
 *      These are often lost and eligible for reimbursement.
 *   2. Summary Banner — total units in limbo, estimated value,
 *      count of stuck orders.
 *   3. Reimbursement Claim Helper — generates pre-filled case text
 *      for stuck removal orders, ready to paste into a support case.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_ID = 'sd-removal-panel';
  const DEFAULT_STUCK_DAYS = 30;

  // Statuses that indicate an order is still in progress
  const IN_PROGRESS_STATUSES = [
    'pending', 'processing', 'in progress', 'in transit',
    'planning', 'submitted', 'created'
  ];

  // Statuses that indicate completion (skip these)
  const COMPLETED_STATUSES = [
    'completed', 'shipped', 'delivered', 'cancelled', 'canceled'
  ];

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

  function parseDate(text) {
    if (!text) return null;
    const cleaned = text.trim();

    const iso = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));

    const usDate = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usDate) return new Date(parseInt(usDate[3]), parseInt(usDate[1]) - 1, parseInt(usDate[2]));

    const named = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (named) {
      const d = new Date(`${named[1]} ${named[2]}, ${named[3]}`);
      if (!isNaN(d.getTime())) return d;
    }

    const fallback = new Date(cleaned);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  function daysSince(date) {
    if (!date) return null;
    return Math.floor((new Date() - date) / 86400000);
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ============================================================
  // ROW DISCOVERY & DATA EXTRACTION
  // ============================================================

  function getRows() {
    const selectors = [
      'table tbody tr',
      '[data-testid*="removal"]',
      '[class*="removal-row"]',
      '[class*="RemovalRow"]',
      '[class*="removal-order"]',
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

  function extractRowData(row) {
    const text = row.textContent || '';
    const cells = row.querySelectorAll('td');

    const data = {
      row,
      orderId: '',
      status: '',
      statusRaw: '',
      isStuck: false,
      quantity: 0,
      createdDate: null,
      sku: '',
      asin: '',
      type: '', // return, disposal, liquidation
      ageDays: null
    };

    // Order ID
    const idEl = row.querySelector(
      'a[href*="removal"], [data-testid*="order-id"], [class*="order-id"], [class*="orderId"]'
    );
    if (idEl) data.orderId = idEl.textContent.trim();
    if (!data.orderId) {
      const idMatch = text.match(/\b(\d{3}-\d{7}-\d{7})\b/) || text.match(/\b(R[A-Z0-9]{8,})\b/);
      if (idMatch) data.orderId = idMatch[1];
    }

    // Status
    const statusEl = row.querySelector(
      '[class*="status"], [class*="Status"], [data-testid*="status"]'
    );
    data.statusRaw = statusEl ? statusEl.textContent.trim() : '';
    const statusLower = data.statusRaw.toLowerCase() || text.toLowerCase();

    for (const s of COMPLETED_STATUSES) {
      if (statusLower.includes(s)) { data.status = 'completed'; break; }
    }
    if (!data.status) {
      for (const s of IN_PROGRESS_STATUSES) {
        if (statusLower.includes(s)) { data.status = 'in_progress'; break; }
      }
    }
    if (!data.status) data.status = 'unknown';

    // ASIN / SKU
    const asinMatch = text.match(/\b(B[A-Z0-9]{9})\b/);
    if (asinMatch) data.asin = asinMatch[1];

    const skuEl = row.querySelector('[data-testid*="sku"], [class*="sku"], [class*="SKU"]');
    if (skuEl) data.sku = skuEl.textContent.trim();

    // Quantity
    cells.forEach(cell => {
      const val = cell.textContent.trim();
      if (/^\d[\d,]*$/.test(val.replace(/\s/g, ''))) {
        const num = parseInt(val.replace(/[^0-9]/g, ''));
        if (num > 0 && data.quantity === 0) data.quantity = num;
      }
    });

    // Type
    if (/return/i.test(text)) data.type = 'return';
    else if (/disposal|dispose|destroy/i.test(text)) data.type = 'disposal';
    else if (/liquidat/i.test(text)) data.type = 'liquidation';

    // Date
    cells.forEach(cell => {
      const cellText = cell.textContent.trim();
      const patterns = [
        /\d{4}-\d{1,2}-\d{1,2}/,
        /\d{1,2}\/\d{1,2}\/\d{4}/,
        /[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/
      ];
      for (const pattern of patterns) {
        const match = cellText.match(pattern);
        if (match) {
          const parsed = parseDate(match[0]);
          if (parsed && (!data.createdDate || parsed < data.createdDate)) {
            data.createdDate = parsed;
          }
        }
      }
    });

    data.ageDays = daysSince(data.createdDate);

    return data;
  }

  // ============================================================
  // STUCK ORDER DETECTION
  // ============================================================

  function detectStuckOrders(allData, stuckDays) {
    const stuck = [];

    for (const data of allData) {
      if (data.status !== 'in_progress') continue;
      if (data.ageDays === null) continue;

      if (data.ageDays >= stuckDays) {
        data.isStuck = true;
        data.row.classList.add('sd-removal-stuck');
        stuck.push(data);
      } else {
        data.row.classList.remove('sd-removal-stuck');
      }
    }

    return stuck;
  }

  // ============================================================
  // CLAIM TEXT GENERATION
  // ============================================================

  function generateClaimText(stuckOrders) {
    if (stuckOrders.length === 0) return '';

    const lines = [
      'Hello,',
      '',
      `I have ${stuckOrders.length} removal order(s) that have been stuck in Processing/Pending ` +
      `for over 30 days without completion. I am requesting an investigation and reimbursement ` +
      `for these orders as the inventory appears to be lost.`,
      '',
      'Affected removal orders:',
      ''
    ];

    for (const order of stuckOrders) {
      const parts = [];
      if (order.orderId) parts.push(`Order ID: ${order.orderId}`);
      if (order.asin) parts.push(`ASIN: ${order.asin}`);
      if (order.sku) parts.push(`SKU: ${order.sku}`);
      parts.push(`Qty: ${order.quantity}`);
      if (order.ageDays !== null) parts.push(`Age: ${order.ageDays} days`);
      parts.push(`Status: ${order.statusRaw || 'Processing'}`);
      lines.push('  - ' + parts.join(' | '));
    }

    lines.push('');
    lines.push(`Total units affected: ${stuckOrders.reduce((s, o) => s + o.quantity, 0)}`);
    lines.push('');
    lines.push(
      'These removal orders have exceeded the expected processing time. ' +
      'Please investigate and process reimbursement for any lost inventory. ' +
      'Thank you.'
    );

    return lines.join('\n');
  }

  // ============================================================
  // UI: PANEL
  // ============================================================

  function createPanel(allData, stuckOrders) {
    let panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    const totalInProgress = allData.filter(d => d.status === 'in_progress');
    const totalUnits = totalInProgress.reduce((s, d) => s + d.quantity, 0);
    const stuckUnits = stuckOrders.reduce((s, d) => s + d.quantity, 0);
    const completed = allData.filter(d => d.status === 'completed').length;

    panel.innerHTML = `
      <div class="sd-removal-header">
        <span class="sd-removal-logo">SellerData</span>
        <span class="sd-removal-title">Removal Order Monitor</span>
      </div>
      <div class="sd-removal-stats">
        <div class="sd-removal-stat sd-removal-stat-progress">
          <span class="sd-removal-stat-count">${totalInProgress.length}</span>
          <span class="sd-removal-stat-label">In Progress</span>
        </div>
        <div class="sd-removal-stat sd-removal-stat-units">
          <span class="sd-removal-stat-count">${totalUnits.toLocaleString()}</span>
          <span class="sd-removal-stat-label">Units in Limbo</span>
        </div>
        <div class="sd-removal-stat sd-removal-stat-stuck">
          <span class="sd-removal-stat-count">${stuckOrders.length}</span>
          <span class="sd-removal-stat-label">Stuck (${DEFAULT_STUCK_DAYS}+ days)</span>
        </div>
        <div class="sd-removal-stat sd-removal-stat-stuck-units">
          <span class="sd-removal-stat-count">${stuckUnits.toLocaleString()}</span>
          <span class="sd-removal-stat-label">Stuck Units</span>
        </div>
        <div class="sd-removal-stat sd-removal-stat-completed">
          <span class="sd-removal-stat-count">${completed}</span>
          <span class="sd-removal-stat-label">Completed</span>
        </div>
      </div>
      ${stuckOrders.length > 0 ? `
      <div class="sd-removal-stuck-section">
        <div class="sd-removal-stuck-title">
          ${stuckOrders.length} order(s) stuck for ${DEFAULT_STUCK_DAYS}+ days — likely eligible for reimbursement
        </div>
        <div class="sd-removal-stuck-list">
          ${stuckOrders.map(o => `
            <div class="sd-removal-stuck-item">
              <span class="sd-removal-stuck-id">${escapeHtml(o.orderId || '—')}</span>
              <span class="sd-removal-stuck-asin">${escapeHtml(o.asin || o.sku || '—')}</span>
              <span class="sd-removal-stuck-qty">${o.quantity} units</span>
              <span class="sd-removal-stuck-age">${o.ageDays}d old</span>
              <span class="sd-removal-stuck-status">${escapeHtml(o.statusRaw || 'Processing')}</span>
            </div>
          `).join('')}
        </div>
        <div class="sd-removal-actions">
          <button class="sd-removal-claim-btn" id="sd-removal-claim">
            Copy Reimbursement Claim Text
          </button>
          <span class="sd-removal-claim-note" id="sd-removal-claim-note"></span>
        </div>
      </div>
      ` : `
      <div class="sd-removal-all-good">
        No stuck removal orders detected. All orders are within expected processing times.
      </div>
      `}
    `;

    const anchor = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    );
    if (anchor) {
      anchor.insertBefore(panel, anchor.firstChild);
    } else {
      document.body.prepend(panel);
    }

    // Copy claim text handler
    const claimBtn = document.getElementById('sd-removal-claim');
    if (claimBtn) {
      claimBtn.addEventListener('click', () => {
        const claimText = generateClaimText(stuckOrders);
        navigator.clipboard.writeText(claimText).then(() => {
          const note = document.getElementById('sd-removal-claim-note');
          if (note) note.textContent = 'Copied! Paste into a new support case.';
          claimBtn.textContent = 'Copied!';
          setTimeout(() => {
            claimBtn.textContent = 'Copy Reimbursement Claim Text';
            if (note) note.textContent = '';
          }, 3000);
        }).catch(() => {
          // Fallback: show the text in a textarea
          const ta = document.createElement('textarea');
          ta.value = claimText;
          ta.style.cssText = 'width:100%;height:200px;margin-top:8px;font-size:12px;';
          claimBtn.parentElement.appendChild(ta);
          ta.select();
        });
      });
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isRemovalOrdersPage() {
    const url = window.location.href;
    return /\/removal-order/.test(url) || /\/recoveries/.test(url);
  }

  async function init() {
    if (!isRemovalOrdersPage()) return;

    try {
      await waitForElement(
        'table, [data-testid*="removal"], [class*="removal"], [class*="Removal"], ' +
        '[role="table"], kat-table',
        20000
      );
    } catch { /* still attempt */ }

    await sleep(1500);

    const rows = getRows();
    const allData = rows.map(extractRowData);
    const stuckOrders = detectStuckOrders(allData, DEFAULT_STUCK_DAYS);

    createPanel(allData, stuckOrders);

    // Re-process on page updates
    const observer = new MutationObserver(() => {
      const rows = getRows();
      const allData = rows.map(extractRowData);
      const stuckOrders = detectStuckOrders(allData, DEFAULT_STUCK_DAYS);
      createPanel(allData, stuckOrders);
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });

    console.log(`[SellerData] Removal orders: ${stuckOrders.length} stuck, ${allData.length} total`);
  }

  init();
})();
