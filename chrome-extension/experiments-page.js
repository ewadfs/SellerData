/**
 * Change Impact Tracker for SellerData.
 *
 * Dual-mode script:
 *
 * MODE 1 — Metric Collector (runs on Business Reports pages)
 *   Scrapes the Detail Page Sales & Traffic report to capture daily/weekly
 *   metrics per ASIN: sessions, page views, unit session % (conversion rate),
 *   ordered product sales, units ordered, buy box %.
 *   Stores snapshots in chrome.storage.local keyed by ASIN + date.
 *
 * MODE 2 — Impact Dashboard (runs on /experiments/ page)
 *   Reads the inventory changelog (from inventory-page.js) to know WHEN
 *   each listing field was changed, and reads the metric snapshots to
 *   compare performance BEFORE vs AFTER each change.
 *   Calculates statistical significance (z-test for proportions, t-test
 *   for means) and presents results as a dashboard of "tests".
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTS
  // ============================================================

  const PANEL_ID = 'sd-exp-panel';
  const CHANGELOG_KEY = 'sd_inventory_changelog';
  const METRICS_KEY = 'sd_metrics_snapshots';

  // Fields we consider "testable" — changes to these trigger tracking
  const TESTABLE_FIELDS = {
    title: 'Title',
    bullet_points: 'Bullet Points',
    description: 'Description',
    image: 'Main Image',
    image_positions: 'Image Order',
    a_plus_content: 'A+ Content',
    keywords: 'Keywords',
    price: 'Price'
  };

  // Compare this many days before vs after a change
  const COMPARISON_WINDOW_DAYS = 14;

  // Minimum data points needed to draw a conclusion
  const MIN_DATA_POINTS = 3;

  // ============================================================
  // HELPERS
  // ============================================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatDateShort(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function dateKey(d) {
    // YYYY-MM-DD
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toISOString().split('T')[0];
  }

  function daysBetween(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    return Math.floor((db - da) / 86400000);
  }

  function parseNumber(text) {
    if (!text) return 0;
    return parseFloat(text.replace(/[^0-9.-]/g, '')) || 0;
  }

  // ============================================================
  // STORAGE
  // ============================================================

  function loadChangelog() {
    return new Promise(resolve => {
      chrome.storage.local.get(CHANGELOG_KEY, result => {
        resolve(result[CHANGELOG_KEY] || {});
      });
    });
  }

  function loadMetrics() {
    return new Promise(resolve => {
      chrome.storage.local.get(METRICS_KEY, result => {
        resolve(result[METRICS_KEY] || {});
      });
    });
  }

  function saveMetrics(metrics) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [METRICS_KEY]: metrics }, resolve);
    });
  }

  // ============================================================
  // MODE 1: METRIC COLLECTOR (Business Reports pages)
  // ============================================================

  /**
   * Metric snapshot shape (per ASIN per date):
   * {
   *   "B01XXXXX": {
   *     "2026-02-20": {
   *       sessions: 150,
   *       pageViews: 210,
   *       conversionRate: 12.5,    // unit session percentage
   *       unitsOrdered: 19,
   *       orderedSales: 475.00,
   *       buyBoxPct: 98.2
   *     },
   *     ...
   *   }
   * }
   */

  function isBusinessReportsPage() {
    const url = window.location.href;
    return /\/business-reports/.test(url) ||
           /\/reportcentral/.test(url) ||
           /detailSalesTraffic/.test(url) ||
           /site\/detail/.test(url);
  }

  async function collectMetrics() {
    if (!isBusinessReportsPage()) return;

    // Wait for data table to load
    await sleep(3000);

    const metrics = await loadMetrics();
    let captured = 0;

    // Find the data table
    const table = findReportTable();
    if (!table) {
      console.log('[SellerData] Metric collector: no report table found');
      return;
    }

    // Identify columns
    const headers = identifyColumns(table);
    if (!headers.asin) {
      console.log('[SellerData] Metric collector: could not identify ASIN column');
      return;
    }

    // Determine the report date range
    const reportDate = detectReportDate();

    // Extract rows
    const rows = table.querySelectorAll('tbody tr, [role="row"]');
    rows.forEach(row => {
      if (row.querySelector('th')) return;
      const cells = row.querySelectorAll('td, [role="cell"]');
      if (cells.length < 3) return;

      // Extract ASIN
      const asinText = getCellText(cells, headers.asin);
      const asinMatch = asinText.match(/\b(B[A-Z0-9]{9})\b/);
      if (!asinMatch) return;
      const asin = asinMatch[1];

      // Extract metrics
      const snapshot = {};
      if (headers.sessions !== null) snapshot.sessions = parseNumber(getCellText(cells, headers.sessions));
      if (headers.pageViews !== null) snapshot.pageViews = parseNumber(getCellText(cells, headers.pageViews));
      if (headers.conversionRate !== null) snapshot.conversionRate = parseNumber(getCellText(cells, headers.conversionRate));
      if (headers.unitsOrdered !== null) snapshot.unitsOrdered = parseNumber(getCellText(cells, headers.unitsOrdered));
      if (headers.orderedSales !== null) snapshot.orderedSales = parseNumber(getCellText(cells, headers.orderedSales));
      if (headers.buyBoxPct !== null) snapshot.buyBoxPct = parseNumber(getCellText(cells, headers.buyBoxPct));
      snapshot.capturedAt = new Date().toISOString();

      // Store
      if (!metrics[asin]) metrics[asin] = {};
      metrics[asin][reportDate] = snapshot;
      captured++;
    });

    if (captured > 0) {
      // Trim old data (keep last 120 days per ASIN)
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 120);
      const cutoffKey = dateKey(cutoff);
      for (const asin of Object.keys(metrics)) {
        for (const dk of Object.keys(metrics[asin])) {
          if (dk < cutoffKey) delete metrics[asin][dk];
        }
        if (Object.keys(metrics[asin]).length === 0) delete metrics[asin];
      }

      await saveMetrics(metrics);
      showCollectorBadge(captured);
      console.log(`[SellerData] Metric collector: captured ${captured} ASIN rows for ${reportDate}`);
    }
  }

  function findReportTable() {
    const selectors = [
      '#report-table', '[data-testid*="report-table"]',
      'table.a-table', 'table[class*="report"]',
      'table[class*="data"]', '[class*="dashboard-table"] table',
      'kat-table', 'table'
    ];

    for (const sel of selectors) {
      const tables = document.querySelectorAll(sel);
      for (const t of tables) {
        const rowCount = t.querySelectorAll('tbody tr, [role="row"]').length;
        if (rowCount >= 1) return t;
      }
    }
    return null;
  }

  function identifyColumns(table) {
    const result = {
      asin: null,
      sessions: null,
      pageViews: null,
      conversionRate: null,
      unitsOrdered: null,
      orderedSales: null,
      buyBoxPct: null
    };

    const headerCells = table.querySelectorAll('thead th, thead td, [role="columnheader"]');
    headerCells.forEach((cell, i) => {
      const text = (cell.textContent || '').toLowerCase();

      if (/asin|child|sku|product/i.test(text) && result.asin === null) result.asin = i;
      if (/\bsession[s]?\b/.test(text) && !/percentage|%|session\s*%/.test(text) && result.sessions === null) result.sessions = i;
      if (/page\s*view/i.test(text) && !/percentage|%/.test(text) && result.pageViews === null) result.pageViews = i;
      if (/unit\s*session\s*%|conversion\s*rate|unit\s*session\s*percentage/i.test(text)) result.conversionRate = i;
      if (/units?\s*ordered/i.test(text) && result.unitsOrdered === null) result.unitsOrdered = i;
      if (/ordered\s*product\s*sales/i.test(text) && result.orderedSales === null) result.orderedSales = i;
      if (/buy\s*box\s*%|buy\s*box\s*percentage/i.test(text)) result.buyBoxPct = i;
    });

    // Fallback: if no header found for ASIN, try the first text column
    if (result.asin === null) {
      const firstRow = table.querySelector('tbody tr');
      if (firstRow) {
        const cells = firstRow.querySelectorAll('td');
        for (let i = 0; i < cells.length; i++) {
          if (/B[A-Z0-9]{9}/.test(cells[i].textContent)) {
            result.asin = i;
            break;
          }
        }
      }
    }

    return result;
  }

  function getCellText(cells, index) {
    if (index === null || index === undefined || !cells[index]) return '';
    return cells[index].textContent.trim();
  }

  function detectReportDate() {
    // Look for date range display on the page
    const dateSelectors = [
      '[class*="date-range"], [data-testid*="date-range"]',
      '[class*="DateRange"], [class*="dateRange"]',
      '[class*="report-period"], [class*="reportPeriod"]',
      '[class*="time-period"], [class*="timePeriod"]'
    ];

    for (const sel of dateSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent;
        const match = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (match) {
          const d = new Date(match[1]);
          if (!isNaN(d.getTime())) return dateKey(d);
        }
        const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
        if (isoMatch) return isoMatch[1];
      }
    }

    // Fallback: use today's date
    return dateKey(new Date());
  }

  function showCollectorBadge(count) {
    let badge = document.getElementById('sd-metric-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sd-metric-badge';
      badge.style.cssText =
        'position:fixed;bottom:20px;right:20px;z-index:99999;' +
        'padding:8px 14px;border-radius:20px;background:#16a34a;color:#fff;' +
        'font-size:12px;font-weight:700;font-family:-apple-system,sans-serif;' +
        'box-shadow:0 2px 8px rgba(0,0,0,0.15);transition:opacity 0.3s;';
      document.body.appendChild(badge);
    }
    badge.textContent = `SellerData: captured ${count} ASIN metrics`;
    badge.style.opacity = '1';
    setTimeout(() => { badge.style.opacity = '0'; }, 4000);
  }

  // ============================================================
  // MODE 2: IMPACT DASHBOARD (Experiments page)
  // ============================================================

  function isExperimentsPage() {
    return /\/experiments/.test(window.location.href);
  }

  /**
   * Build "tests" from the changelog — each distinct listing change on a
   * testable field becomes a test with a before/after period.
   */
  function buildTests(changelog, metrics) {
    const tests = [];

    for (const [sku, entries] of Object.entries(changelog)) {
      if (!entries || entries.length === 0) continue;

      // Find the ASIN for this SKU from the metrics (metrics are keyed by ASIN)
      // The changelog may use SKU or ASIN as key depending on what inventory-page found
      const asin = findAsinForSku(sku, metrics);
      const metricsData = metrics[asin] || metrics[sku] || {};
      const metricDates = Object.keys(metricsData).sort();

      for (const entry of entries) {
        if (!TESTABLE_FIELDS[entry.field]) continue;

        const changeDate = dateKey(entry.date);
        const fieldLabel = TESTABLE_FIELDS[entry.field];

        // Gather "before" metrics: COMPARISON_WINDOW_DAYS before the change
        const beforeStart = new Date(entry.date);
        beforeStart.setDate(beforeStart.getDate() - COMPARISON_WINDOW_DAYS);
        const beforeEnd = new Date(entry.date);
        beforeEnd.setDate(beforeEnd.getDate() - 1);

        // Gather "after" metrics: day of change through COMPARISON_WINDOW_DAYS after
        const afterStart = new Date(entry.date);
        const afterEnd = new Date(entry.date);
        afterEnd.setDate(afterEnd.getDate() + COMPARISON_WINDOW_DAYS);

        const beforeMetrics = gatherMetrics(metricsData, dateKey(beforeStart), dateKey(beforeEnd));
        const afterMetrics = gatherMetrics(metricsData, dateKey(afterStart), dateKey(afterEnd));

        const analysis = analyzeImpact(beforeMetrics, afterMetrics);

        tests.push({
          sku,
          asin: asin || sku,
          field: entry.field,
          fieldLabel,
          changeDate: entry.date,
          oldVal: entry.oldVal,
          newVal: entry.newVal,
          beforeMetrics,
          afterMetrics,
          analysis,
          hasData: beforeMetrics.dataPoints > 0 || afterMetrics.dataPoints > 0
        });
      }
    }

    // Sort: tests with data first, then by date (newest first)
    tests.sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1;
      return new Date(b.changeDate) - new Date(a.changeDate);
    });

    return tests;
  }

  function findAsinForSku(sku, metrics) {
    // If the SKU is already an ASIN pattern, return it
    if (/^B[A-Z0-9]{9}$/.test(sku)) return sku;
    // Check if metrics has this key
    if (metrics[sku]) return sku;
    // Otherwise we can't match — return the sku as-is
    return sku;
  }

  function gatherMetrics(metricsData, startDate, endDate) {
    const result = {
      sessions: [],
      pageViews: [],
      conversionRate: [],
      unitsOrdered: [],
      orderedSales: [],
      buyBoxPct: [],
      dataPoints: 0
    };

    for (const [dk, snapshot] of Object.entries(metricsData)) {
      if (dk >= startDate && dk <= endDate) {
        if (snapshot.sessions !== undefined) result.sessions.push(snapshot.sessions);
        if (snapshot.pageViews !== undefined) result.pageViews.push(snapshot.pageViews);
        if (snapshot.conversionRate !== undefined) result.conversionRate.push(snapshot.conversionRate);
        if (snapshot.unitsOrdered !== undefined) result.unitsOrdered.push(snapshot.unitsOrdered);
        if (snapshot.orderedSales !== undefined) result.orderedSales.push(snapshot.orderedSales);
        if (snapshot.buyBoxPct !== undefined) result.buyBoxPct.push(snapshot.buyBoxPct);
        result.dataPoints++;
      }
    }

    return result;
  }

  // ============================================================
  // STATISTICAL ANALYSIS
  // ============================================================

  function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function stddev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1));
  }

  /**
   * Two-sample t-test (Welch's, unequal variance).
   * Returns { tStat, pValue, significant } at 95% confidence.
   */
  function tTest(before, after) {
    if (before.length < MIN_DATA_POINTS || after.length < MIN_DATA_POINTS) {
      return { tStat: 0, pValue: 1, significant: false, insufficient: true };
    }

    const m1 = mean(before);
    const m2 = mean(after);
    const s1 = stddev(before);
    const s2 = stddev(after);
    const n1 = before.length;
    const n2 = after.length;

    const se = Math.sqrt((s1 * s1) / n1 + (s2 * s2) / n2);
    if (se === 0) return { tStat: 0, pValue: 1, significant: false, insufficient: false };

    const tStat = (m2 - m1) / se;

    // Welch-Satterthwaite degrees of freedom
    const v1 = (s1 * s1) / n1;
    const v2 = (s2 * s2) / n2;
    const df = Math.floor(((v1 + v2) ** 2) / ((v1 ** 2) / (n1 - 1) + (v2 ** 2) / (n2 - 1))) || 1;

    // Approximate p-value from t-distribution using normal approximation for df > 30
    const pValue = approxPValue(Math.abs(tStat), df);

    return {
      tStat: Math.round(tStat * 100) / 100,
      pValue: Math.round(pValue * 1000) / 1000,
      significant: pValue < 0.05,
      insufficient: false
    };
  }

  /**
   * Approximate two-tailed p-value from t-distribution.
   * Uses the normal CDF approximation for simplicity.
   */
  function approxPValue(t, df) {
    // For large df, t ~ normal. For small df, use a rough adjustment.
    const adjusted = df > 4 ? t * Math.sqrt((df - 2) / df) : t * 0.8;
    // Normal CDF approximation (Abramowitz & Stegun)
    const z = Math.abs(adjusted);
    const p = 0.5 * Math.exp(-0.5 * z * z) * (
      1.0 / (1.0 + 0.2316419 * z) * (
        0.319381530 +
        (-0.356563782 + (1.781477937 + (-1.821255978 + 1.330274429 / (1.0 + 0.2316419 * z)) / (1.0 + 0.2316419 * z)) / (1.0 + 0.2316419 * z)) / (1.0 + 0.2316419 * z)
      )
    );
    return Math.min(1, 2 * p); // two-tailed
  }

  function analyzeImpact(before, after) {
    const results = {};

    // Analyze each metric
    const metricKeys = ['sessions', 'pageViews', 'conversionRate', 'unitsOrdered', 'orderedSales', 'buyBoxPct'];
    const metricLabels = {
      sessions: 'Sessions',
      pageViews: 'Page Views',
      conversionRate: 'Conversion Rate',
      unitsOrdered: 'Units Ordered',
      orderedSales: 'Sales',
      buyBoxPct: 'Buy Box %'
    };

    for (const key of metricKeys) {
      if (before[key].length === 0 && after[key].length === 0) continue;

      const beforeMean = mean(before[key]);
      const afterMean = mean(after[key]);
      const change = beforeMean > 0 ? ((afterMean - beforeMean) / beforeMean) * 100 : 0;
      const test = tTest(before[key], after[key]);

      results[key] = {
        label: metricLabels[key],
        beforeMean: Math.round(beforeMean * 100) / 100,
        afterMean: Math.round(afterMean * 100) / 100,
        changePct: Math.round(change * 10) / 10,
        beforeN: before[key].length,
        afterN: after[key].length,
        ...test,
        direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
      };
    }

    return results;
  }

  // ============================================================
  // UI: IMPACT DASHBOARD
  // ============================================================

  function createDashboard(tests, metrics) {
    let panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    // Summary stats
    const withData = tests.filter(t => t.hasData);
    const significant = withData.filter(t =>
      Object.values(t.analysis).some(a => a.significant)
    );
    const positive = withData.filter(t =>
      Object.values(t.analysis).some(a => a.significant && a.direction === 'up')
    );
    const negative = withData.filter(t =>
      Object.values(t.analysis).some(a => a.significant && a.direction === 'down')
    );
    const asinCount = Object.keys(metrics).length;
    const totalSnapshots = Object.values(metrics).reduce(
      (s, asinData) => s + Object.keys(asinData).length, 0
    );

    const statsHTML = `
      <div class="sd-exp-stats">
        <div class="sd-exp-stat sd-exp-stat-running">
          <span class="sd-exp-stat-count">${tests.length}</span>
          <span class="sd-exp-stat-label">Changes Tracked</span>
        </div>
        <div class="sd-exp-stat sd-exp-stat-completed">
          <span class="sd-exp-stat-count">${withData.length}</span>
          <span class="sd-exp-stat-label">With Metric Data</span>
        </div>
        <div class="sd-exp-stat sd-exp-stat-review">
          <span class="sd-exp-stat-count">${significant.length}</span>
          <span class="sd-exp-stat-label">Statistically Significant</span>
        </div>
        <div class="sd-exp-stat sd-exp-stat-draft">
          <span class="sd-exp-stat-count">${asinCount} / ${totalSnapshots}</span>
          <span class="sd-exp-stat-label">ASINs / Snapshots</span>
        </div>
      </div>
    `;

    // Tests list
    let testsHTML = '';
    if (tests.length === 0) {
      testsHTML = `
        <div class="sd-exp-no-suggestions">
          No listing changes detected yet. As you edit titles, images, bullets, and
          other listing fields on the Manage Inventory page, changes will appear here.<br><br>
          <strong>To collect metrics:</strong> Visit the Detail Page Sales & Traffic report
          in Business Reports regularly. SellerData will automatically capture sessions,
          page views, conversion rate, and sales per ASIN.
        </div>
      `;
    } else {
      testsHTML = tests.slice(0, 25).map(t => buildTestCard(t)).join('');
    }

    panel.innerHTML = `
      <div class="sd-exp-header">
        <span class="sd-exp-logo">SellerData</span>
        <span class="sd-exp-title">Change Impact Tracker</span>
      </div>
      <div class="sd-exp-desc">
        Tracks listing changes and compares ${COMPARISON_WINDOW_DAYS}-day performance before vs. after.
        Visit <strong>Business Reports &gt; Detail Page Sales &amp; Traffic</strong> regularly to collect metric data.
      </div>
      ${statsHTML}
      <div class="sd-exp-tests-section">
        <div class="sd-exp-suggestions-title">
          Listing Changes
          <span class="sd-exp-suggestions-subtitle">
            ${positive.length} positive | ${negative.length} negative | ${withData.length - significant.length} inconclusive
          </span>
        </div>
        ${testsHTML}
      </div>
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

  function buildTestCard(test) {
    const changeDateStr = formatDate(test.changeDate);
    const oldShort = escapeHtml((test.oldVal || '').substring(0, 50));
    const newShort = escapeHtml((test.newVal || '').substring(0, 50));

    // Build metric rows
    let metricsHTML = '';
    if (!test.hasData) {
      metricsHTML = `
        <div class="sd-exp-test-nodata">
          No metric data available for this period. Visit Business Reports to collect data.
        </div>
      `;
    } else {
      const metricRows = Object.values(test.analysis).map(a => {
        if (a.insufficient) {
          return `
            <div class="sd-exp-metric-row sd-exp-metric-insufficient">
              <span class="sd-exp-metric-name">${a.label}</span>
              <span class="sd-exp-metric-detail">Insufficient data (need ${MIN_DATA_POINTS}+ days before & after)</span>
            </div>
          `;
        }

        const arrow = a.direction === 'up' ? '&#9650;' : a.direction === 'down' ? '&#9660;' : '&#9644;';
        const colorClass = a.significant
          ? (a.direction === 'up' ? 'sd-exp-metric-positive' : 'sd-exp-metric-negative')
          : 'sd-exp-metric-neutral';
        const sigLabel = a.significant ? 'Significant' : 'Not significant';
        const pLabel = a.pValue < 0.001 ? 'p<0.001' : `p=${a.pValue.toFixed(3)}`;

        return `
          <div class="sd-exp-metric-row ${colorClass}">
            <span class="sd-exp-metric-name">${a.label}</span>
            <span class="sd-exp-metric-before">${a.beforeMean.toLocaleString()} <small>(n=${a.beforeN})</small></span>
            <span class="sd-exp-metric-arrow">&rarr;</span>
            <span class="sd-exp-metric-after">${a.afterMean.toLocaleString()} <small>(n=${a.afterN})</small></span>
            <span class="sd-exp-metric-change">${arrow} ${a.changePct > 0 ? '+' : ''}${a.changePct}%</span>
            <span class="sd-exp-metric-sig ${a.significant ? 'sd-exp-sig-yes' : 'sd-exp-sig-no'}" title="${pLabel}">${sigLabel}</span>
          </div>
        `;
      }).join('');

      metricsHTML = `<div class="sd-exp-metric-table">${metricRows}</div>`;
    }

    // Overall verdict
    const sigResults = Object.values(test.analysis).filter(a => a.significant);
    let verdictClass = 'sd-exp-verdict-pending';
    let verdictText = 'Collecting data...';

    if (test.hasData) {
      if (sigResults.length === 0) {
        verdictClass = 'sd-exp-verdict-neutral';
        verdictText = 'No significant impact detected';
      } else {
        const positiveCount = sigResults.filter(a => a.direction === 'up').length;
        const negativeCount = sigResults.filter(a => a.direction === 'down').length;
        if (positiveCount > negativeCount) {
          verdictClass = 'sd-exp-verdict-positive';
          verdictText = `Positive impact (${positiveCount} metric${positiveCount > 1 ? 's' : ''} improved)`;
        } else if (negativeCount > positiveCount) {
          verdictClass = 'sd-exp-verdict-negative';
          verdictText = `Negative impact (${negativeCount} metric${negativeCount > 1 ? 's' : ''} declined)`;
        } else {
          verdictClass = 'sd-exp-verdict-neutral';
          verdictText = 'Mixed results';
        }
      }
    }

    return `
      <div class="sd-exp-suggestion">
        <div class="sd-exp-suggestion-header">
          <span class="sd-exp-suggestion-sku">${escapeHtml(test.asin)}</span>
          <span class="sd-exp-suggestion-field">${test.fieldLabel}</span>
          <span class="sd-exp-suggestion-date">${changeDateStr}</span>
          <span class="sd-exp-verdict ${verdictClass}">${verdictText}</span>
        </div>
        <div class="sd-exp-suggestion-detail">
          <span class="sd-exp-old-val">${oldShort}${(test.oldVal || '').length > 50 ? '...' : ''}</span>
          &rarr; <span class="sd-exp-new-val">${newShort}${(test.newVal || '').length > 50 ? '...' : ''}</span>
        </div>
        ${metricsHTML}
      </div>
    `;
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async function init() {
    // Mode 1: Collect metrics on Business Reports pages
    if (isBusinessReportsPage()) {
      collectMetrics();
      // Re-collect when user changes date range or report type
      const observer = new MutationObserver(() => {
        setTimeout(collectMetrics, 2000);
      });
      const target = document.querySelector(
        '#sc-content-container, .content-container, main, #content, [role="main"]'
      ) || document.body;
      observer.observe(target, { childList: true, subtree: true });
    }

    // Mode 2: Show impact dashboard on Experiments page
    if (isExperimentsPage()) {
      await sleep(2000);

      const changelog = await loadChangelog();
      const metrics = await loadMetrics();
      const tests = buildTests(changelog, metrics);

      createDashboard(tests, metrics);

      console.log(`[SellerData] Change Impact Tracker: ${tests.length} changes, ${tests.filter(t => t.hasData).length} with data`);
    }
  }

  init();
})();
