/**
 * Case Log Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/cu/case-lobby
 *          sellercentral.amazon.com/gp/case-dashboard/lobby.html
 *
 * Features:
 *   1. Status Highlighting — color-code case rows by who needs to act:
 *        - Red/orange  = YOU need to reply  (Action Required / Pending Your Response)
 *        - Green       = AMAZON is working  (Pending Amazon Action)
 *        - Grey        = Resolved / Closed
 *   2. Age Column — inject a "Case Age" and "Since Last Update" column
 *      so you instantly see stale cases.
 *   3. Summary Banner — counts of cases by status bucket at the top.
 *   4. Bump Stale Cases — one-click button to open every case that has
 *      been "Pending Amazon Action" for longer than a configurable
 *      threshold and add a follow-up nudge message.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_ID = 'sd-case-panel';
  const BANNER_ID = 'sd-case-banner';
  const LOG_ID = 'sd-case-log';
  const PROGRESS_ID = 'sd-case-progress';
  const PROGRESS_FILL_ID = 'sd-case-progress-fill';
  const PROGRESS_TEXT_ID = 'sd-case-progress-text';

  // Default: bump cases older than this many days with no Amazon response
  const DEFAULT_STALE_DAYS = 2;

  // Follow-up message to post when bumping
  const BUMP_MESSAGE =
    'Hello, I am following up on this case as I have not received a response. ' +
    'Could you please provide an update? This issue is impacting our ability to ' +
    'serve customers effectively. Thank you.';

  // ---- Status classification keywords ----

  // Cases where the SELLER needs to act
  const SELLER_ACTION_KEYWORDS = [
    'action required',
    'pending your response',
    'awaiting your response',
    'awaiting seller',
    'requires your action',
    'your response needed',
    'needs your attention',
    'response needed',
    'provide information'
  ];

  // Cases where AMAZON needs to act
  const AMAZON_ACTION_KEYWORDS = [
    'pending amazon',
    'pending investigation',
    'investigating',
    'under review',
    'being reviewed',
    'in progress',
    'transferred',
    'escalated',
    'assigned',
    'awaiting amazon',
    'amazon action'
  ];

  // Cases that are done
  const RESOLVED_KEYWORDS = [
    'resolved',
    'closed',
    'answered',
    'completed',
    'no action needed',
    'no further action'
  ];

  // Status bucket enum
  const STATUS_BUCKET = {
    SELLER_ACTION: 'seller_action',
    AMAZON_ACTION: 'amazon_action',
    RESOLVED: 'resolved',
    OPEN: 'open',
    UNKNOWN: 'unknown'
  };

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

  /**
   * Parse a date string. Amazon uses various formats:
   *   "Feb 22, 2026", "2026-02-22", "02/22/2026", "2 days ago", "5 hours ago"
   */
  function parseDate(text) {
    if (!text) return null;
    const cleaned = text.trim();

    // Relative: "X days ago", "X hours ago", "X minutes ago", "just now"
    const relDay = cleaned.match(/(\d+)\s*day/i);
    if (relDay) {
      const d = new Date();
      d.setDate(d.getDate() - parseInt(relDay[1]));
      return d;
    }
    const relHour = cleaned.match(/(\d+)\s*hour/i);
    if (relHour) {
      const d = new Date();
      d.setHours(d.getHours() - parseInt(relHour[1]));
      return d;
    }
    const relMin = cleaned.match(/(\d+)\s*min/i);
    if (relMin) {
      const d = new Date();
      d.setMinutes(d.getMinutes() - parseInt(relMin[1]));
      return d;
    }
    if (/just now/i.test(cleaned)) return new Date();

    // ISO: 2026-02-22
    const iso = cleaned.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));

    // US: 02/22/2026
    const usDate = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usDate) return new Date(parseInt(usDate[3]), parseInt(usDate[1]) - 1, parseInt(usDate[2]));

    // Named month: Feb 22, 2026
    const named = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (named) {
      const d = new Date(`${named[1]} ${named[2]}, ${named[3]}`);
      if (!isNaN(d.getTime())) return d;
    }

    // Fallback
    const fallback = new Date(cleaned);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  /**
   * Human-readable relative time: "2d ago", "5h ago", "< 1h"
   */
  function timeAgo(date) {
    if (!date) return '—';
    const now = new Date();
    const diffMs = now - date;
    if (diffMs < 0) return 'just now';

    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return '< 1m';
  }

  /**
   * Return number of full days since a date.
   */
  function daysSince(date) {
    if (!date) return null;
    return Math.floor((new Date() - date) / 86400000);
  }

  // ============================================================
  // ROW DISCOVERY & CLASSIFICATION
  // ============================================================

  /**
   * Get all case rows from the case log page.
   */
  function getCaseRows() {
    const selectors = [
      // Table-based
      'table tbody tr',
      '.a-table tbody tr',
      'kat-table-row',
      '[role="row"]',
      // Card / list-based
      '[data-testid*="case-row"]',
      '[data-testid*="case-item"]',
      '[class*="case-row"]',
      '[class*="CaseRow"]',
      '[class*="case-card"]',
      '[class*="CaseCard"]',
      '[class*="case-item"]',
      '[class*="CaseItem"]',
      // Generic content rows
      '[class*="kat-row"]',
      'li[class*="case"]',
      'li[data-case-id]',
      'div[data-case-id]'
    ];

    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      const filtered = Array.from(rows).filter(r =>
        !r.querySelector('th') &&
        r.textContent.trim().length > 10 &&
        // Must look like it has a case ID or status text
        /\d{8,}/.test(r.textContent) || /case/i.test(r.className + (r.dataset?.testid || ''))
      );
      if (filtered.length > 0) return filtered;
    }

    return [];
  }

  /**
   * Classify a case row into a status bucket.
   */
  function classifyCase(row) {
    const text = (row.textContent || '').toLowerCase();
    const statusEl = row.querySelector(
      '[class*="status"], [class*="Status"], [data-testid*="status"], ' +
      '[class*="state"], [class*="State"], td:nth-child(3), td:nth-child(4)'
    );
    const statusText = statusEl ? statusEl.textContent.toLowerCase().trim() : text;

    // Check seller action first (most urgent)
    for (const kw of SELLER_ACTION_KEYWORDS) {
      if (statusText.includes(kw) || text.includes(kw)) return STATUS_BUCKET.SELLER_ACTION;
    }

    // Check resolved/closed
    for (const kw of RESOLVED_KEYWORDS) {
      if (statusText.includes(kw)) return STATUS_BUCKET.RESOLVED;
    }

    // Check amazon action
    for (const kw of AMAZON_ACTION_KEYWORDS) {
      if (statusText.includes(kw) || text.includes(kw)) return STATUS_BUCKET.AMAZON_ACTION;
    }

    // If it says "open" it's ambiguous — could be either side
    if (/\bopen\b/.test(statusText)) return STATUS_BUCKET.OPEN;

    return STATUS_BUCKET.UNKNOWN;
  }

  /**
   * Extract the status text from a row.
   */
  function extractStatus(row) {
    const statusEl = row.querySelector(
      '[class*="status"], [class*="Status"], [data-testid*="status"], ' +
      '[class*="state"], [class*="State"]'
    );
    if (statusEl) return statusEl.textContent.trim();

    // Try table cells — status is typically the 3rd or 4th column
    const cells = row.querySelectorAll('td');
    for (const cell of cells) {
      const t = cell.textContent.trim().toLowerCase();
      const allKW = [...SELLER_ACTION_KEYWORDS, ...AMAZON_ACTION_KEYWORDS, ...RESOLVED_KEYWORDS, 'open'];
      for (const kw of allKW) {
        if (t.includes(kw)) return cell.textContent.trim();
      }
    }

    return '';
  }

  /**
   * Extract case ID from a row.
   */
  function extractCaseId(row) {
    // data attribute
    const dataId = row.dataset?.caseId || row.dataset?.id || '';
    if (dataId) return dataId;

    // Link href with case ID
    const link = row.querySelector('a[href*="case-id="], a[href*="caseId="], a[href*="/case/"]');
    if (link) {
      const href = link.href;
      const match = href.match(/case[_-]?[iI]d=(\d+)/) || href.match(/\/case\/(\d+)/);
      if (match) return match[1];
    }

    // Look for a long numeric string (case IDs are typically 10+ digits)
    const text = row.textContent;
    const numMatch = text.match(/\b(\d{10,})\b/);
    if (numMatch) return numMatch[1];

    return '';
  }

  /**
   * Extract case subject/title from a row.
   */
  function extractCaseSubject(row) {
    const subjectEl = row.querySelector(
      'a[href*="case"], [class*="subject"], [class*="Subject"], ' +
      '[class*="title"], [class*="Title"], [data-testid*="subject"]'
    );
    if (subjectEl) return subjectEl.textContent.trim().substring(0, 100);

    const firstLink = row.querySelector('a');
    if (firstLink) return firstLink.textContent.trim().substring(0, 100);

    const firstCell = row.querySelector('td');
    if (firstCell) return firstCell.textContent.trim().substring(0, 100);

    return row.textContent.trim().substring(0, 100);
  }

  /**
   * Extract the creation date from a row.
   */
  function extractCreatedDate(row) {
    // Look for date-specific elements
    const dateEls = row.querySelectorAll(
      '[class*="date"], [class*="Date"], [data-testid*="date"], ' +
      '[class*="created"], [class*="Created"], [class*="opened"], ' +
      'time, td'
    );

    let earliestDate = null;

    for (const el of dateEls) {
      const timeEl = el.tagName === 'TIME' ? el : el.querySelector('time');
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime') || timeEl.textContent;
        const parsed = parseDate(dt);
        if (parsed && (!earliestDate || parsed < earliestDate)) {
          earliestDate = parsed;
        }
      }

      const text = el.textContent.trim();
      const patterns = [
        /\d{4}-\d{1,2}-\d{1,2}/,
        /\d{1,2}\/\d{1,2}\/\d{4}/,
        /[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/,
        /\d+\s*(?:day|hour|min)/i
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          const parsed = parseDate(match[0]);
          if (parsed && (!earliestDate || parsed < earliestDate)) {
            earliestDate = parsed;
          }
        }
      }
    }

    return earliestDate;
  }

  /**
   * Extract the last-updated date from a row.
   * Typically the most recent date on the row.
   */
  function extractLastUpdatedDate(row) {
    const dateEls = row.querySelectorAll(
      '[class*="date"], [class*="Date"], [data-testid*="date"], ' +
      '[class*="update"], [class*="Update"], [class*="modified"], ' +
      '[class*="last"], time, td'
    );

    let latestDate = null;

    for (const el of dateEls) {
      const timeEl = el.tagName === 'TIME' ? el : el.querySelector('time');
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime') || timeEl.textContent;
        const parsed = parseDate(dt);
        if (parsed && (!latestDate || parsed > latestDate)) {
          latestDate = parsed;
        }
      }

      const text = el.textContent.trim();
      const patterns = [
        /\d{4}-\d{1,2}-\d{1,2}/,
        /\d{1,2}\/\d{1,2}\/\d{4}/,
        /[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}/,
        /\d+\s*(?:day|hour|min)/i,
        /just now/i
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          const parsed = parseDate(match[0]);
          if (parsed && (!latestDate || parsed > latestDate)) {
            latestDate = parsed;
          }
        }
      }
    }

    return latestDate;
  }

  /**
   * Get the URL for a case detail page.
   */
  function getCaseUrl(row) {
    const link = row.querySelector('a[href*="case"]');
    if (link) return link.href;

    const caseId = extractCaseId(row);
    if (caseId) {
      return `https://sellercentral.amazon.com/cu/case-lobby?caseId=${caseId}`;
    }

    return null;
  }

  // ============================================================
  // PROCESS ROWS — HIGHLIGHTING + AGE INJECTION
  // ============================================================

  /**
   * Full case data extracted from a row.
   */
  function extractCaseData(row) {
    const bucket = classifyCase(row);
    const status = extractStatus(row);
    const caseId = extractCaseId(row);
    const subject = extractCaseSubject(row);
    const createdDate = extractCreatedDate(row);
    const lastUpdated = extractLastUpdatedDate(row);
    const url = getCaseUrl(row);
    const ageDays = daysSince(createdDate);
    const staleDays = daysSince(lastUpdated);

    return { row, bucket, status, caseId, subject, createdDate, lastUpdated, url, ageDays, staleDays };
  }

  /**
   * Apply row highlighting CSS class based on status bucket.
   */
  function highlightRow(caseData) {
    const { row, bucket } = caseData;

    // Remove old classes
    row.classList.remove(
      'sd-case-seller-action', 'sd-case-amazon-action',
      'sd-case-resolved', 'sd-case-open'
    );

    switch (bucket) {
      case STATUS_BUCKET.SELLER_ACTION:
        row.classList.add('sd-case-seller-action');
        break;
      case STATUS_BUCKET.AMAZON_ACTION:
        row.classList.add('sd-case-amazon-action');
        break;
      case STATUS_BUCKET.RESOLVED:
        row.classList.add('sd-case-resolved');
        break;
      case STATUS_BUCKET.OPEN:
        row.classList.add('sd-case-open');
        break;
    }
  }

  /**
   * Inject age badges into a row.
   */
  function injectAgeBadge(caseData) {
    const { row, ageDays, staleDays, lastUpdated } = caseData;

    // Remove existing badges
    row.querySelectorAll('.sd-case-age-badge').forEach(el => el.remove());

    if (ageDays === null && staleDays === null) return;

    const badge = document.createElement('span');
    badge.className = 'sd-case-age-badge';

    const parts = [];
    if (ageDays !== null) parts.push(`${ageDays}d old`);
    if (staleDays !== null && lastUpdated) parts.push(`updated ${timeAgo(lastUpdated)}`);
    badge.textContent = parts.join(' | ');

    // Color the badge by staleness
    if (staleDays !== null && staleDays >= 3) {
      badge.classList.add('sd-case-age-stale');
    } else if (staleDays !== null && staleDays >= 1) {
      badge.classList.add('sd-case-age-aging');
    }

    // Try to append to last cell or end of row
    const lastCell = row.querySelector('td:last-child');
    if (lastCell) {
      lastCell.appendChild(badge);
    } else {
      row.appendChild(badge);
    }
  }

  // ============================================================
  // SUMMARY BANNER
  // ============================================================

  function createSummaryBanner(cases) {
    let banner = document.getElementById(BANNER_ID);

    if (cases.length === 0) {
      if (banner) banner.remove();
      return;
    }

    // Tally by bucket
    const counts = {
      [STATUS_BUCKET.SELLER_ACTION]: 0,
      [STATUS_BUCKET.AMAZON_ACTION]: 0,
      [STATUS_BUCKET.RESOLVED]: 0,
      [STATUS_BUCKET.OPEN]: 0,
      [STATUS_BUCKET.UNKNOWN]: 0
    };
    let staleCount = 0;

    for (const c of cases) {
      counts[c.bucket]++;
      if (c.bucket === STATUS_BUCKET.AMAZON_ACTION && c.staleDays !== null && c.staleDays >= DEFAULT_STALE_DAYS) {
        staleCount++;
      }
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = BANNER_ID;

      const anchor = document.querySelector(
        '#sc-content-container, .content-container, main, #content, [role="main"]'
      );
      if (anchor) {
        anchor.insertBefore(banner, anchor.firstChild);
      } else {
        document.body.prepend(banner);
      }
    }

    const sellerAction = counts[STATUS_BUCKET.SELLER_ACTION];
    const amazonAction = counts[STATUS_BUCKET.AMAZON_ACTION];
    const resolved = counts[STATUS_BUCKET.RESOLVED];
    const open = counts[STATUS_BUCKET.OPEN] + counts[STATUS_BUCKET.UNKNOWN];

    banner.innerHTML = `
      <div class="sd-case-banner-header">
        <span class="sd-case-banner-logo">SellerData</span>
        <span class="sd-case-banner-title">Case Log Dashboard</span>
      </div>
      <div class="sd-case-banner-stats">
        <div class="sd-case-stat sd-case-stat-seller">
          <span class="sd-case-stat-count">${sellerAction}</span>
          <span class="sd-case-stat-label">You Need to Reply</span>
        </div>
        <div class="sd-case-stat sd-case-stat-amazon">
          <span class="sd-case-stat-count">${amazonAction}</span>
          <span class="sd-case-stat-label">Waiting on Amazon</span>
        </div>
        <div class="sd-case-stat sd-case-stat-stale">
          <span class="sd-case-stat-count">${staleCount}</span>
          <span class="sd-case-stat-label">Stale (${DEFAULT_STALE_DAYS}+ days)</span>
        </div>
        <div class="sd-case-stat sd-case-stat-open">
          <span class="sd-case-stat-count">${open}</span>
          <span class="sd-case-stat-label">Open</span>
        </div>
        <div class="sd-case-stat sd-case-stat-resolved">
          <span class="sd-case-stat-count">${resolved}</span>
          <span class="sd-case-stat-label">Resolved</span>
        </div>
      </div>
      ${sellerAction > 0 ? `
      <div class="sd-case-banner-alert">
          You have ${sellerAction} case${sellerAction !== 1 ? 's' : ''} awaiting your response!
      </div>
      ` : ''}
      <div class="sd-case-banner-actions">
        <button class="sd-case-bump-btn" id="sd-case-bump" ${staleCount === 0 ? 'disabled' : ''}>
          Bump ${staleCount} Stale Case${staleCount !== 1 ? 's' : ''}
        </button>
        <label class="sd-case-stale-label">
          Stale after
          <input type="number" id="sd-case-stale-days" class="sd-case-stale-input"
                 value="${DEFAULT_STALE_DAYS}" min="1" max="30" />
          days
        </label>
      </div>
      <div class="sd-case-progress hidden" id="${PROGRESS_ID}">
        <div class="sd-case-progress-bar">
          <div class="sd-case-progress-fill" id="${PROGRESS_FILL_ID}"></div>
        </div>
        <span class="sd-case-progress-text" id="${PROGRESS_TEXT_ID}">0 / 0</span>
      </div>
      <div class="sd-case-log hidden" id="${LOG_ID}"></div>
    `;

    // Bump button handler
    document.getElementById('sd-case-bump').addEventListener('click', () => {
      const days = parseInt(document.getElementById('sd-case-stale-days').value) || DEFAULT_STALE_DAYS;
      bumpStaleCases(cases, days);
    });

    // Stale days input — update count on change
    document.getElementById('sd-case-stale-days').addEventListener('change', () => {
      const days = parseInt(document.getElementById('sd-case-stale-days').value) || DEFAULT_STALE_DAYS;
      const newCount = cases.filter(c =>
        c.bucket === STATUS_BUCKET.AMAZON_ACTION && c.staleDays !== null && c.staleDays >= days
      ).length;
      const btn = document.getElementById('sd-case-bump');
      btn.textContent = `Bump ${newCount} Stale Case${newCount !== 1 ? 's' : ''}`;
      btn.disabled = newCount === 0;
    });
  }

  // ============================================================
  // BUMP STALE CASES
  // ============================================================

  let isBumping = false;

  async function bumpStaleCases(allCases, staleDays) {
    if (isBumping) return;
    isBumping = true;

    const staleCases = allCases.filter(c =>
      c.bucket === STATUS_BUCKET.AMAZON_ACTION &&
      c.staleDays !== null &&
      c.staleDays >= staleDays &&
      c.url
    );

    if (staleCases.length === 0) {
      caseLog('No stale cases to bump.', 'info');
      isBumping = false;
      return;
    }

    const btn = document.getElementById('sd-case-bump');
    btn.disabled = true;
    btn.textContent = 'Bumping...';

    caseLog(`Starting bump for ${staleCases.length} stale case(s)...`);
    showProgress(0, staleCases.length);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < staleCases.length; i++) {
      const c = staleCases[i];
      caseLog(`[${i + 1}/${staleCases.length}] Opening case ${c.caseId || '(unknown)'}...`);
      showProgress(i, staleCases.length);

      try {
        const success = await bumpSingleCase(c);
        if (success) {
          caseLog(`  Bumped case ${c.caseId}`, 'ok');
          successCount++;
        } else {
          caseLog(`  Could not bump case ${c.caseId} — reply field not found`, 'warn');
          errorCount++;
        }
      } catch (err) {
        caseLog(`  Error bumping case ${c.caseId}: ${err.message}`, 'error');
        errorCount++;
      }

      // Pause between cases
      if (i < staleCases.length - 1) await sleep(2000);
    }

    showProgress(staleCases.length, staleCases.length);
    caseLog(`Done! ${successCount} bumped, ${errorCount} failed.`);
    btn.textContent = `Bump Complete`;
    isBumping = false;
  }

  /**
   * Open a case detail page in a hidden iframe, find the reply textarea,
   * type the bump message, and submit.
   */
  async function bumpSingleCase(caseData) {
    const { url, caseId } = caseData;
    if (!url) return false;

    // Strategy 1: Click the case row link to navigate within the SPA
    const link = caseData.row.querySelector('a[href*="case"]');

    // Strategy 2: Open in a new tab, post the message, then come back
    // We use a popup window so the user can see progress
    const popup = window.open(url, '_blank', 'width=900,height=700,scrollbars=yes');
    if (!popup) {
      caseLog(`  Popup blocked — please allow popups for this site`, 'error');
      return false;
    }

    // Wait for page to load
    await sleep(4000);

    try {
      // Try to access popup DOM (same-origin)
      const doc = popup.document;

      // Find the reply textarea
      const replySelectors = [
        'textarea[name*="message"]',
        'textarea[name*="reply"]',
        'textarea[data-testid*="reply"]',
        'textarea[data-testid*="message"]',
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="reply" i]',
        'textarea[placeholder*="type" i]',
        'textarea[class*="reply"]',
        'textarea[class*="message"]',
        '#message-body',
        '#reply-body',
        'textarea',
        // Contenteditable divs
        '[contenteditable="true"][class*="reply"]',
        '[contenteditable="true"][class*="message"]',
        '[contenteditable="true"]'
      ];

      let textarea = null;
      for (const sel of replySelectors) {
        const el = doc.querySelector(sel);
        if (el) { textarea = el; break; }
      }

      if (!textarea) {
        // Wait a bit more and retry
        await sleep(3000);
        for (const sel of replySelectors) {
          const el = doc.querySelector(sel);
          if (el) { textarea = el; break; }
        }
      }

      if (!textarea) {
        popup.close();
        return false;
      }

      // Fill the message
      if (textarea.tagName === 'TEXTAREA' || textarea.tagName === 'INPUT') {
        const proto = textarea.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) nativeSetter.call(textarea, BUMP_MESSAGE);
        else textarea.value = BUMP_MESSAGE;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Contenteditable
        textarea.textContent = BUMP_MESSAGE;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      await sleep(500);

      // Find and click Send / Submit / Reply button
      const sendSelectors = [
        'button[data-testid*="send"]',
        'button[data-testid*="reply"]',
        'button[data-testid*="submit"]',
        'input[type="submit"]',
        'button[type="submit"]'
      ];

      let sendBtn = null;
      for (const sel of sendSelectors) {
        const el = doc.querySelector(sel);
        if (el) { sendBtn = el; break; }
      }

      // Also search by text content
      if (!sendBtn) {
        const allBtns = doc.querySelectorAll('button, input[type="submit"], [role="button"]');
        for (const btn of allBtns) {
          const text = (btn.textContent || btn.value || '').toLowerCase().trim();
          if (text === 'send' || text === 'reply' || text === 'submit' || text === 'respond') {
            sendBtn = btn;
            break;
          }
        }
      }

      if (sendBtn) {
        sendBtn.click();
        await sleep(2000);
        popup.close();
        return true;
      } else {
        // Message was typed but couldn't find send button
        caseLog(`  Message typed in case ${caseId} — please click Send manually in the popup`, 'warn');
        // Don't close popup so user can manually send
        return false;
      }
    } catch (err) {
      // Cross-origin or other DOM access error
      // Fallback: just leave the popup open for the user
      caseLog(`  Opened case ${caseId} in new tab — could not auto-fill (cross-origin)`, 'warn');
      return false;
    }
  }

  // ============================================================
  // UI HELPERS
  // ============================================================

  function showProgress(current, total) {
    const container = document.getElementById(PROGRESS_ID);
    const fill = document.getElementById(PROGRESS_FILL_ID);
    const text = document.getElementById(PROGRESS_TEXT_ID);
    if (!container || !fill || !text) return;

    container.classList.remove('hidden');
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    fill.style.width = pct + '%';
    text.textContent = `${current} / ${total}`;
  }

  function caseLog(message, type = 'info') {
    const log = document.getElementById(LOG_ID);
    if (!log) {
      console.log(`[SellerData Case] ${message}`);
      return;
    }
    log.classList.remove('hidden');
    const line = document.createElement('div');
    line.className = `sd-case-log-line sd-case-log-${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // ============================================================
  // MAIN PROCESSING
  // ============================================================

  function processAllCases() {
    const rows = getCaseRows();
    if (rows.length === 0) return [];

    const cases = rows.map(row => {
      const data = extractCaseData(row);
      highlightRow(data);
      injectAgeBadge(data);
      return data;
    });

    createSummaryBanner(cases);
    return cases;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isCaseLogPage() {
    const url = window.location.href;
    return /\/cu\/case-lobby/.test(url) ||
           /\/case-dashboard\/lobby/.test(url) ||
           /\/gp\/case-dashboard/.test(url);
  }

  async function init() {
    if (!isCaseLogPage()) return;

    // Wait for case list content to render
    try {
      await waitForElement(
        'table, [data-testid*="case"], [class*="case"], [class*="Case"], ' +
        '[role="table"], [role="grid"], kat-table, [class*="kat-row"]',
        20000
      );
    } catch {
      // Layout may differ — still attempt
    }

    await sleep(1500);

    const cases = processAllCases();
    const total = cases.length;
    const sellerAction = cases.filter(c => c.bucket === STATUS_BUCKET.SELLER_ACTION).length;
    const amazonAction = cases.filter(c => c.bucket === STATUS_BUCKET.AMAZON_ACTION).length;
    console.log(`[SellerData] Case log: ${total} cases — ${sellerAction} need your reply, ${amazonAction} waiting on Amazon`);

    // Re-process when page updates (pagination, filters, AJAX)
    const observer = new MutationObserver(() => {
      processAllCases();
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });
  }

  init();
})();
