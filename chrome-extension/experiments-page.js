/**
 * Manage Experiments Page Enhancements for SellerData.
 *
 * Runs on: sellercentral.amazon.com/experiments/
 *
 * Features:
 *   1. Change-Log Powered Suggestions — reads the inventory changelog
 *      from chrome.storage (populated by inventory-page.js) and surfaces
 *      ASINs/SKUs with frequent listing changes as A/B test candidates.
 *      "You changed the title on ASIN X 4 times this month — consider
 *       running an experiment instead of guessing."
 *   2. Experiment Status Summary — stat cards showing active, completed,
 *      and needs-review experiments at a glance.
 *   3. Results Highlights — for completed experiments, highlights the
 *      winning variant and projected revenue impact.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_ID = 'sd-exp-panel';
  const CHANGELOG_KEY = 'sd_inventory_changelog';

  // Only suggest experiments for these testable fields
  const TESTABLE_FIELDS = {
    title: 'Title',
    bullet_points: 'Bullet Points',
    description: 'Description',
    image: 'Main Image',
    image_positions: 'Image Order',
    a_plus_content: 'A+ Content'
  };

  // Minimum number of changes on a field to trigger a suggestion
  const MIN_CHANGES_FOR_SUGGESTION = 2;

  // Look back this many days for recent changes
  const LOOKBACK_DAYS = 60;

  // ============================================================
  // HELPERS
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function daysSince(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return Infinity;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ============================================================
  // CHANGELOG ANALYSIS
  // ============================================================

  function loadChangelog() {
    return new Promise(resolve => {
      chrome.storage.local.get(CHANGELOG_KEY, result => {
        resolve(result[CHANGELOG_KEY] || {});
      });
    });
  }

  /**
   * Analyze the changelog and find SKUs that are good A/B test candidates.
   * Returns an array of suggestion objects sorted by priority.
   */
  function analyzeChangelog(changelog) {
    const suggestions = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);

    for (const [sku, entries] of Object.entries(changelog)) {
      if (!entries || entries.length === 0) continue;

      // Count recent changes per testable field
      const fieldCounts = {};
      const fieldHistory = {};

      for (const entry of entries) {
        if (!TESTABLE_FIELDS[entry.field]) continue;

        const entryDate = new Date(entry.date);
        if (entryDate < cutoffDate) continue;

        if (!fieldCounts[entry.field]) fieldCounts[entry.field] = 0;
        fieldCounts[entry.field]++;

        if (!fieldHistory[entry.field]) fieldHistory[entry.field] = [];
        fieldHistory[entry.field].push(entry);
      }

      // Generate suggestions for fields with enough changes
      for (const [field, count] of Object.entries(fieldCounts)) {
        if (count < MIN_CHANGES_FOR_SUGGESTION) continue;

        const history = fieldHistory[field];
        const latest = history[0];
        const earliest = history[history.length - 1];
        const daysBetween = Math.max(1, daysSince(earliest.date) - daysSince(latest.date));

        suggestions.push({
          sku,
          field,
          fieldLabel: TESTABLE_FIELDS[field],
          changeCount: count,
          frequency: (count / daysBetween * 7).toFixed(1), // changes per week
          latestChange: latest,
          earliestChange: earliest,
          history,
          // Priority: more changes = higher priority, title/image changes > bullets
          priority: count * (field === 'title' || field === 'image' ? 2 : 1)
        });
      }
    }

    // Sort by priority (highest first)
    suggestions.sort((a, b) => b.priority - a.priority);
    return suggestions;
  }

  // ============================================================
  // EXPERIMENT ROW DISCOVERY
  // ============================================================

  function getExperimentRows() {
    const selectors = [
      'table tbody tr',
      '[data-testid*="experiment-row"]',
      '[class*="experiment-row"]',
      '[class*="ExperimentRow"]',
      '[class*="experiment-card"]',
      '[class*="ExperimentCard"]',
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

  /**
   * Classify experiment status from a row.
   */
  function classifyExperiment(row) {
    const text = (row.textContent || '').toLowerCase();

    if (/completed|finished|ended/.test(text)) return 'completed';
    if (/running|active|in.?progress|live/.test(text)) return 'running';
    if (/review|needs.?review|results.?available|action.?needed/.test(text)) return 'needs_review';
    if (/draft|pending|scheduled/.test(text)) return 'draft';
    if (/cancelled|canceled|stopped/.test(text)) return 'cancelled';
    return 'unknown';
  }

  /**
   * Extract experiment data from a row.
   */
  function extractExperimentData(row) {
    const status = classifyExperiment(row);
    const titleEl = row.querySelector(
      'a, [class*="title"], [class*="Title"], [class*="name"], [class*="Name"], ' +
      '[data-testid*="title"], [data-testid*="name"]'
    );
    const title = titleEl ? titleEl.textContent.trim() : '';
    const asinMatch = row.textContent.match(/\b(B[A-Z0-9]{9})\b/);
    const asin = asinMatch ? asinMatch[1] : '';

    return { row, status, title, asin };
  }

  // ============================================================
  // HIGHLIGHT EXPERIMENT RESULTS
  // ============================================================

  function highlightExperiments() {
    const rows = getExperimentRows();
    if (rows.length === 0) return { running: 0, completed: 0, needsReview: 0, draft: 0 };

    const counts = { running: 0, completed: 0, needsReview: 0, draft: 0 };

    rows.forEach(row => {
      row.classList.remove(
        'sd-exp-running', 'sd-exp-completed', 'sd-exp-needs-review', 'sd-exp-draft'
      );

      const data = extractExperimentData(row);

      switch (data.status) {
        case 'running':
          row.classList.add('sd-exp-running');
          counts.running++;
          break;
        case 'completed':
          row.classList.add('sd-exp-completed');
          counts.completed++;
          // Look for winner indication
          highlightWinner(row);
          break;
        case 'needs_review':
          row.classList.add('sd-exp-needs-review');
          counts.needsReview++;
          break;
        case 'draft':
          row.classList.add('sd-exp-draft');
          counts.draft++;
          break;
      }
    });

    return counts;
  }

  /**
   * For completed experiments, try to identify and highlight the winning variant.
   */
  function highlightWinner(row) {
    // Remove existing badges
    row.querySelectorAll('.sd-exp-winner-badge').forEach(el => el.remove());

    const text = row.textContent.toLowerCase();

    // Look for winning indicators
    const winnerPatterns = [
      /winner:\s*([ab])/i,
      /variant\s*([ab])\s*(?:wins|won|winner)/i,
      /(\w+)\s*(?:is the winner|won|outperformed)/i
    ];

    let winner = null;
    for (const pattern of winnerPatterns) {
      const match = text.match(pattern);
      if (match) { winner = match[1]; break; }
    }

    // Look for percentage improvement
    const liftMatch = text.match(/(\+?\d+\.?\d*)\s*%\s*(?:improvement|lift|increase|better|higher)/i);
    const lift = liftMatch ? liftMatch[1] + '%' : null;

    if (winner || lift) {
      const badge = document.createElement('span');
      badge.className = 'sd-exp-winner-badge';
      const parts = [];
      if (winner) parts.push(`Winner: ${winner.toUpperCase()}`);
      if (lift) parts.push(`+${lift} lift`);
      badge.textContent = parts.join(' | ');

      const lastCell = row.querySelector('td:last-child');
      if (lastCell) lastCell.appendChild(badge);
      else row.appendChild(badge);
    }
  }

  // ============================================================
  // UI: PANEL
  // ============================================================

  function createPanel(suggestions, counts) {
    let panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    // Experiment status summary
    const hasExperiments = counts.running + counts.completed + counts.needsReview + counts.draft > 0;

    let statsHTML = '';
    if (hasExperiments) {
      statsHTML = `
        <div class="sd-exp-stats">
          <div class="sd-exp-stat sd-exp-stat-running">
            <span class="sd-exp-stat-count">${counts.running}</span>
            <span class="sd-exp-stat-label">Running</span>
          </div>
          <div class="sd-exp-stat sd-exp-stat-review">
            <span class="sd-exp-stat-count">${counts.needsReview}</span>
            <span class="sd-exp-stat-label">Needs Review</span>
          </div>
          <div class="sd-exp-stat sd-exp-stat-completed">
            <span class="sd-exp-stat-count">${counts.completed}</span>
            <span class="sd-exp-stat-label">Completed</span>
          </div>
          <div class="sd-exp-stat sd-exp-stat-draft">
            <span class="sd-exp-stat-count">${counts.draft}</span>
            <span class="sd-exp-stat-label">Draft</span>
          </div>
        </div>
      `;
    }

    // Change-log based suggestions
    let suggestionsHTML = '';
    if (suggestions.length > 0) {
      const sugRows = suggestions.slice(0, 10).map(s => {
        const latest = s.latestChange;
        const latestDate = formatDate(latest.date);
        const oldVal = escapeHtml((latest.oldVal || '').substring(0, 60));
        const newVal = escapeHtml((latest.newVal || '').substring(0, 60));

        return `
          <div class="sd-exp-suggestion">
            <div class="sd-exp-suggestion-header">
              <span class="sd-exp-suggestion-sku">${escapeHtml(s.sku)}</span>
              <span class="sd-exp-suggestion-field">${s.fieldLabel}</span>
              <span class="sd-exp-suggestion-count">${s.changeCount} changes in ${LOOKBACK_DAYS}d</span>
            </div>
            <div class="sd-exp-suggestion-detail">
              Latest: <span class="sd-exp-old-val">${oldVal}${latest.oldVal.length > 60 ? '...' : ''}</span>
              &rarr; <span class="sd-exp-new-val">${newVal}${latest.newVal.length > 60 ? '...' : ''}</span>
              <span class="sd-exp-suggestion-date">${latestDate}</span>
            </div>
            <div class="sd-exp-suggestion-tip">
              You've changed <strong>${s.fieldLabel}</strong> ${s.changeCount} times.
              Consider running an A/B experiment to measure which version performs best.
            </div>
          </div>
        `;
      }).join('');

      suggestionsHTML = `
        <div class="sd-exp-suggestions-section">
          <div class="sd-exp-suggestions-title">
            A/B Test Candidates
            <span class="sd-exp-suggestions-subtitle">Based on your recent listing changes</span>
          </div>
          ${sugRows}
        </div>
      `;
    } else {
      suggestionsHTML = `
        <div class="sd-exp-suggestions-section">
          <div class="sd-exp-suggestions-title">
            A/B Test Candidates
            <span class="sd-exp-suggestions-subtitle">Based on your recent listing changes</span>
          </div>
          <div class="sd-exp-no-suggestions">
            No frequent listing changes detected. As you edit titles, images, and bullets
            on the Manage Inventory page, suggestions will appear here.
          </div>
        </div>
      `;
    }

    panel.innerHTML = `
      <div class="sd-exp-header">
        <span class="sd-exp-logo">SellerData</span>
        <span class="sd-exp-title">Experiments Dashboard</span>
      </div>
      ${statsHTML}
      ${suggestionsHTML}
    `;

    const anchor = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    );
    if (anchor) {
      anchor.insertBefore(panel, anchor.firstChild);
    } else {
      document.body.prepend(panel);
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  function isExperimentsPage() {
    return /\/experiments/.test(window.location.href);
  }

  async function init() {
    if (!isExperimentsPage()) return;

    await sleep(2000);

    // Highlight existing experiments
    const counts = highlightExperiments();

    // Load inventory changelog and analyze for suggestions
    const changelog = await loadChangelog();
    const suggestions = analyzeChangelog(changelog);

    // Build panel
    createPanel(suggestions, counts);

    // Re-process on page updates
    const observer = new MutationObserver(() => {
      highlightExperiments();
    });
    const target = document.querySelector(
      '#sc-content-container, .content-container, main, #content, [role="main"]'
    ) || document.body;
    observer.observe(target, { childList: true, subtree: true });

    console.log(`[SellerData] Experiments page: ${suggestions.length} A/B test suggestions from changelog`);
  }

  init();
})();
