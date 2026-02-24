// Datarova Bulk Report Downloader - Content Script
//
// Runs on app.datarova.com pages:
//   /projects              → detects project cards (name, ASIN, marketplace)
//   /projects/<id>/ranks/* → triggers Export > Daily Ranks
//   /download-report       → clicks download buttons on Ready rows

(function () {
  'use strict';

  // No guard — allows re-injection after extension reload.
  // Duplicate listeners are harmless (Chrome only honours the first sendResponse).
  console.log('[Datarova Bulk] content script loaded v4, url:', location.href);

  // ── Project Detection (runs on /projects page) ───────────────────────────

  function detectProjects() {
    var projects = [];
    var seen = new Set();

    var allLinks = document.querySelectorAll('a[href*="/projects/"]');
    console.log('[Datarova Bulk] found', allLinks.length, 'project links');

    allLinks.forEach(function (a) {
      try {
        var href = a.href || a.getAttribute('href') || '';
        var match = href.match(/\/projects\/(\d+)(?:\/\w+\/([A-Z0-9]{10}))?/);
        if (!match) {
          console.log('[Datarova Bulk]   skip link (no match):', href);
          return;
        }

        var projectId = match[1];
        if (seen.has(projectId)) return;
        seen.add(projectId);

        var asin = match[2] || extractAsinFromText(a);
        var card = findCardContainer(a);

        console.log('[Datarova Bulk]   project', projectId,
          'card id:', card ? card.id : '(none)',
          'card tag:', card ? card.tagName : '(none)');

        var name = extractNameFromCard(card, asin);

        var marketplace = 'US';
        try {
          marketplace = extractMarketplace(card) || 'US';
        } catch (e) {
          console.warn('[Datarova Bulk] marketplace detection error:', e);
        }

        projects.push({
          id: projectId,
          name: name || nameFromCardId(card) || 'Project ' + projectId,
          asin: asin || '',
          marketplace: marketplace,
        });
      } catch (err) {
        console.error('[Datarova Bulk] error detecting project:', err);
      }
    });

    console.log('[Datarova Bulk] detected', projects.length, 'projects:', JSON.stringify(projects));
    return projects;
  }

  /**
   * Find the card container by walking up from the <a> link.
   * Datarova cards have id="card-{project-name-slug}", e.g.:
   *   card-cad-bamboo-cutting-board, card-utensil-holder-uk, card-popcorn-maker
   * The <a> is typically a direct child of this card div.
   */
  function findCardContainer(el) {
    var current = el;
    for (var i = 0; i < 10 && current.parentElement; i++) {
      current = current.parentElement;

      // Primary: Datarova cards have id="card-..."
      if (current.id && current.id.indexOf('card-') === 0) {
        return current;
      }

      // Fallback: generic card detection
      var text = current.textContent || '';
      if (current.querySelector('img') &&
          (text.includes('Keyword') || text.includes('ASIN'))) {
        var links = current.querySelectorAll('a[href*="/projects/"]');
        var uniqueIds = new Set();
        links.forEach(function (l) {
          var m = (l.href || '').match(/\/projects\/(\d+)/);
          if (m) uniqueIds.add(m[1]);
        });
        if (uniqueIds.size <= 1) return current;
      }
    }
    return el.parentElement || el;
  }

  function extractNameFromCard(card, asin) {
    if (!card) return '';

    if (asin) {
      var fullText = card.textContent || '';
      var idx = fullText.indexOf(asin);
      if (idx > 0) {
        var name = fullText.substring(0, idx)
          .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
          .replace(/\s+/g, ' ')
          .trim();
        name = name.replace(/[^a-zA-Z0-9)]+$/, '').trim();
        if (name.length > 1) return name;
      }
    }

    var headings = card.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (var i = 0; i < headings.length; i++) {
      var t = (headings[i].textContent || '').trim();
      if (t.length > 1 && !/^B0[A-Z0-9]{8}$/.test(t)) return t;
    }

    var walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var txt = walker.currentNode.textContent.trim();
      if (txt.length > 2 &&
          !/^B0[A-Z0-9]{8}/.test(txt) &&
          !/^\d+\s*(ASIN|Keyword)/i.test(txt) &&
          !/^(Export|Delete|Edit|Settings)/i.test(txt)) {
        return txt;
      }
    }

    return '';
  }

  /**
   * Fallback name extraction from the card ID.
   * "card-cad-bamboo-cutting-board" → "Cad Bamboo Cutting Board"
   */
  function nameFromCardId(card) {
    if (!card || !card.id || card.id.indexOf('card-') !== 0) return '';
    var slug = card.id.substring(5); // remove "card-"
    return slug.split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function extractAsinFromText(el) {
    var text = (el.textContent || '') + ' ' + (el.href || '');
    var match = text.match(/\b(B0[A-Z0-9]{8})\b/);
    return match ? match[1] : null;
  }

  // ── Marketplace Detection ────────────────────────────────────────────────
  //
  // Primary strategy: parse the card id attribute.
  // Datarova card IDs encode the project name slug, which includes
  // marketplace codes:
  //   "card-cad-bamboo-cutting-board"  → "cad" = Canada
  //   "card-utensil-holder-uk"         → "uk"  = UK
  //   "card-popcorn-maker"             → no code = US (default)

  // 3-letter codes: safe to match anywhere in the slug
  var SLUG_CODES_3 = {
    'cad': 'CA', 'can': 'CA', 'mex': 'MX',
    'ger': 'DE', 'fra': 'FR', 'ita': 'IT', 'esp': 'ES',
    'jpn': 'JP', 'aus': 'AU', 'ind': 'IN', 'bra': 'BR',
  };

  // 2-letter codes: only match at start or end of slug to avoid false positives
  var SLUG_CODES_2 = {
    'uk': 'UK', 'gb': 'UK', 'ca': 'CA', 'mx': 'MX',
    'de': 'DE', 'fr': 'FR', 'it': 'IT', 'es': 'ES',
    'jp': 'JP', 'au': 'AU', 'in': 'IN', 'br': 'BR',
    'us': 'US',
  };

  function extractMarketplace(card) {
    if (!card) return null;

    // Strategy 1: Parse the card ID (most reliable)
    if (card.id && card.id.indexOf('card-') === 0) {
      var result = parseMarketplaceFromCardId(card.id);
      if (result) return result;
    }

    // Strategy 2: Walk up to find a parent with card- ID
    var parent = card.parentElement;
    for (var i = 0; i < 5 && parent; i++) {
      if (parent.id && parent.id.indexOf('card-') === 0) {
        var result2 = parseMarketplaceFromCardId(parent.id);
        if (result2) return result2;
      }
      parent = parent.parentElement;
    }

    // Strategy 3: Check card text content for marketplace indicators
    var text = (card.textContent || '').toLowerCase();
    if (text.indexOf(' cad ') !== -1 || text.indexOf('cad ') === 0) return 'CA';
    if (text.indexOf(' uk ') !== -1 || text.indexOf(' uk') === text.length - 3) return 'UK';

    return null;
  }

  function parseMarketplaceFromCardId(cardId) {
    var parts = cardId.toLowerCase().split('-');
    if (parts[0] !== 'card' || parts.length < 2) return null;
    parts = parts.slice(1); // remove "card" prefix

    // Check first segment (most common position for marketplace prefix)
    if (SLUG_CODES_3[parts[0]]) return SLUG_CODES_3[parts[0]];
    if (SLUG_CODES_2[parts[0]]) return SLUG_CODES_2[parts[0]];

    // Check last segment (common for suffix like "butter-dish-uk")
    var last = parts[parts.length - 1];
    if (parts.length > 1) {
      if (SLUG_CODES_3[last]) return SLUG_CODES_3[last];
      if (SLUG_CODES_2[last]) return SLUG_CODES_2[last];
    }

    // Check all segments for 3+ letter codes (safe, unlikely false positives)
    for (var i = 1; i < parts.length - 1; i++) {
      if (SLUG_CODES_3[parts[i]]) return SLUG_CODES_3[parts[i]];
    }

    return null;
  }

  // ── Export Triggering (runs on /projects/<id>/ranks/<asin> page) ──────────

  async function triggerExport() {
    var exportBtn = findButtonByText('export');
    if (!exportBtn) {
      throw new Error('Export button not found on page');
    }

    exportBtn.click();
    await sleep(800);

    var menu = await waitForElement(
      '[role="menu"], [role="presentation"] ul, ' +
      '.MuiMenu-list, .MuiPopover-paper, .MuiPaper-root ul',
      5000
    );

    if (!menu) {
      throw new Error('Export menu did not open');
    }

    await sleep(300);

    var menuItems = document.querySelectorAll(
      '[role="menuitem"], .MuiMenuItem-root, ' +
      '.MuiListItem-root, [role="presentation"] li'
    );

    var dailyRanksItem = null;
    for (var i = 0; i < menuItems.length; i++) {
      var text = (menuItems[i].textContent || '').trim().toLowerCase();
      if (text.includes('daily') && text.includes('rank')) {
        dailyRanksItem = menuItems[i];
        break;
      }
    }

    if (!dailyRanksItem) {
      document.body.click();
      throw new Error('Daily Ranks option not found in export menu');
    }

    dailyRanksItem.click();
    await sleep(3000);
    return true;
  }

  // ── Download Page Handling (runs on /download-report page) ────────────────

  async function downloadReadyReports(count) {
    var table = await waitForElement('table.MuiTable-root, table', 8000);
    if (!table) {
      throw new Error('Download report table not found');
    }

    var rows = table.querySelectorAll('tbody tr[id^="body-row-"]');
    if (rows.length === 0) {
      rows = table.querySelectorAll('tbody tr');
    }
    if (rows.length === 0) {
      throw new Error('No report rows found');
    }

    var targetRows = Array.from(rows).slice(0, count || rows.length);
    targetRows.reverse();

    var downloaded = 0;
    var skipped = 0;

    for (var i = 0; i < targetRows.length; i++) {
      var row = targetRows[i];

      if (!isRowReady(row)) {
        skipped++;
        continue;
      }

      var downloadBtn = findDownloadButton(row);
      if (!downloadBtn) {
        skipped++;
        continue;
      }

      downloadBtn.click();
      downloaded++;
      await sleep(1500);
    }

    return { downloaded: downloaded, skipped: skipped, total: targetRows.length };
  }

  function isRowReady(row) {
    var cells = row.querySelectorAll('td');
    for (var c = 0; c < cells.length; c++) {
      var text = (cells[c].textContent || '').trim().toLowerCase();
      if (text === 'ready' || text.includes('ready')) {
        return true;
      }
    }
    return false;
  }

  function findDownloadButton(row) {
    var cells = row.querySelectorAll('td');
    if (cells.length === 0) return null;

    var lastCell = cells[cells.length - 1];

    var allBtns = lastCell.querySelectorAll(
      'button, [role="button"], .MuiIconButton-root, a'
    );
    for (var b = 0; b < allBtns.length; b++) {
      var label = (
        allBtns[b].getAttribute('aria-label') ||
        allBtns[b].title || ''
      ).toLowerCase();
      if (label.includes('download') || label.includes('export') || label.includes('save')) {
        return allBtns[b];
      }
    }

    if (allBtns.length >= 1) {
      return allBtns[0];
    }

    if (cells.length >= 2) {
      var secondLast = cells[cells.length - 2];
      var btns2 = secondLast.querySelectorAll(
        'button, [role="button"], .MuiIconButton-root, a'
      );
      if (btns2.length >= 1) return btns2[0];
    }

    return null;
  }

  // ── Utility Functions ───────────────────────────────────────────────────

  function findButtonByText(searchText) {
    var candidates = document.querySelectorAll(
      'button, [role="button"], a.MuiButtonBase-root, .MuiButton-root'
    );
    var search = searchText.toLowerCase();
    for (var i = 0; i < candidates.length; i++) {
      var text = (candidates[i].textContent || '').trim().toLowerCase();
      if (text.includes(search)) {
        return candidates[i];
      }
    }
    return null;
  }

  function waitForElement(selector, timeout) {
    if (timeout === undefined) timeout = 5000;
    return new Promise(function (resolve) {
      var el = document.querySelector(selector);
      if (el) return resolve(el);

      var observer = new MutationObserver(function () {
        var found = document.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(function () {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ── Message Handling ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    console.log('[Datarova Bulk] received message:', message.action);

    if (message.action === 'getProjects') {
      try {
        var projects = detectProjects();
        sendResponse({ projects: projects });
      } catch (err) {
        console.error('[Datarova Bulk] detectProjects failed:', err);
        sendResponse({ projects: [] });
      }
      return true;
    }

    if (message.action === 'triggerExport') {
      triggerExport()
        .then(function () { sendResponse({ success: true }); })
        .catch(function (err) { sendResponse({ success: false, error: err.message }); });
      return true;
    }

    if (message.action === 'downloadReports') {
      downloadReadyReports(message.count)
        .then(function (result) { sendResponse({ success: true, result: result }); })
        .catch(function (err) { sendResponse({ success: false, error: err.message }); });
      return true;
    }

    return false;
  });
})();
