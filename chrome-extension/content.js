/**
 * Datarova Bulk Report Downloader - Content Script
 *
 * Runs on app.datarova.com pages. On the /projects page it detects project
 * cards. On a project's /ranks page it triggers the Export > Daily Ranks flow.
 */

(function () {
  'use strict';

  // ── Project Detection (runs on /projects page) ───────────────────────────

  /**
   * Detect projects from the card grid on the Datarova projects page.
   * Each card contains a link like /projects/<id>/ranks/<asin>, a project
   * name, a marketplace flag image, and stats.
   */
  function detectProjects() {
    const projects = [];
    const seen = new Set();

    // Find all links that point to project subpages
    document.querySelectorAll('a[href*="/projects/"]').forEach((a) => {
      const href = a.href || '';
      // Match /projects/<id> with optional /ranks/<asin> or other subpath
      const match = href.match(/\/projects\/(\d+)(?:\/\w+\/([A-Z0-9]{10}))?/);
      if (!match) return;

      const projectId = match[1];
      if (seen.has(projectId)) return;
      seen.add(projectId);

      const asin = match[2] || extractAsinFromText(a);

      // Walk up the DOM to find the enclosing card element
      const card = findCardContainer(a, projectId);

      // Extract info from the card
      const name = extractNameFromCard(card, asin);
      const marketplace = extractMarketplace(card);

      projects.push({
        id: projectId,
        name: name || 'Project ' + projectId,
        asin: asin || '',
        marketplace: marketplace || 'US',
      });
    });

    return projects;
  }

  /**
   * Walk up from a link element to find the enclosing card container.
   * Stop when we find an element that contains exactly one project link
   * (so we don't overshoot to a parent grid that holds multiple cards).
   */
  function findCardContainer(el, projectId) {
    let current = el;
    for (let i = 0; i < 10 && current.parentElement; i++) {
      current = current.parentElement;
      // A card typically contains an image and keyword/ASIN stats
      const text = current.textContent || '';
      if (current.querySelector('img') &&
          (text.includes('Keyword') || text.includes('ASIN'))) {
        // Verify this is a single-project card, not the whole grid
        const links = current.querySelectorAll('a[href*="/projects/"]');
        const uniqueIds = new Set();
        links.forEach((l) => {
          const m = (l.href || '').match(/\/projects\/(\d+)/);
          if (m) uniqueIds.add(m[1]);
        });
        if (uniqueIds.size <= 1) return current;
      }
    }
    return el.parentElement || el;
  }

  /**
   * Extract the project name from a card element.
   * The card text typically looks like: "Spoon Rest 🇺🇸 B0874S275K 2 ASINs 130 Keywords"
   * We want just the name portion (before the ASIN).
   */
  function extractNameFromCard(card, asin) {
    if (!card) return '';

    // Strategy 1: Split card text at the ASIN to isolate the name
    if (asin) {
      const fullText = card.textContent || '';
      const idx = fullText.indexOf(asin);
      if (idx > 0) {
        let name = fullText.substring(0, idx)
          .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // remove flag emojis
          .replace(/\s+/g, ' ')
          .trim();
        // Remove any trailing non-letter chars (flag remnants, etc.)
        name = name.replace(/[^a-zA-Z0-9)]+$/, '').trim();
        if (name.length > 1) return name;
      }
    }

    // Strategy 2: Look for heading or prominent text elements
    const headings = card.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const h of headings) {
      const text = h.textContent?.trim();
      if (text && text.length > 1 && !/^B0[A-Z0-9]{8}$/.test(text)) {
        return text;
      }
    }

    // Strategy 3: Find the first meaningful text node (not an ASIN or stat)
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      if (text.length > 2 &&
          !/^B0[A-Z0-9]{8}/.test(text) &&
          !/^\d+\s*(ASIN|Keyword)/i.test(text) &&
          !/^(Export|Delete|Edit|Settings)/i.test(text)) {
        return text;
      }
    }

    return '';
  }

  /**
   * Extract an ASIN (B0XXXXXXXXX format) from element text.
   */
  function extractAsinFromText(el) {
    const text = (el.textContent || '') + ' ' + (el.href || '');
    const match = text.match(/\b(B0[A-Z0-9]{8})\b/);
    return match ? match[1] : null;
  }

  /**
   * Detect marketplace from flag images or emojis in a card element.
   */
  function extractMarketplace(card) {
    if (!card) return null;

    // Check for flag images (common pattern: /flags/us.svg, /us.png, alt="US")
    const imgs = card.querySelectorAll('img');
    for (const img of imgs) {
      const src = (img.src || '').toLowerCase();
      const alt = (img.alt || '').toLowerCase();
      const combined = src + ' ' + alt;

      const codes = {
        '/us': 'US', '_us': 'US', 'united states': 'US',
        '/ca': 'CA', '_ca': 'CA', 'canada': 'CA',
        '/mx': 'MX', '_mx': 'MX', 'mexico': 'MX',
        '/uk': 'UK', '_uk': 'UK', '/gb': 'UK', '_gb': 'UK', 'united kingdom': 'UK',
        '/de': 'DE', '_de': 'DE', 'germany': 'DE',
        '/fr': 'FR', '_fr': 'FR', 'france': 'FR',
        '/it': 'IT', '_it': 'IT', 'italy': 'IT',
        '/es': 'ES', '_es': 'ES', 'spain': 'ES',
        '/jp': 'JP', '_jp': 'JP', 'japan': 'JP',
        '/au': 'AU', '_au': 'AU', 'australia': 'AU',
        '/in': 'IN', '_in': 'IN', 'india': 'IN',
      };

      for (const [pattern, code] of Object.entries(codes)) {
        if (combined.includes(pattern)) return code;
      }
    }

    // Check for flag emojis
    const text = card.textContent || '';
    const flagMap = {
      '\u{1F1FA}\u{1F1F8}': 'US', '\u{1F1E8}\u{1F1E6}': 'CA',
      '\u{1F1F2}\u{1F1FD}': 'MX', '\u{1F1EC}\u{1F1E7}': 'UK',
      '\u{1F1E9}\u{1F1EA}': 'DE', '\u{1F1EB}\u{1F1F7}': 'FR',
      '\u{1F1EE}\u{1F1F9}': 'IT', '\u{1F1EA}\u{1F1F8}': 'ES',
      '\u{1F1EF}\u{1F1F5}': 'JP', '\u{1F1E6}\u{1F1FA}': 'AU',
      '\u{1F1EE}\u{1F1F3}': 'IN',
    };
    for (const [emoji, code] of Object.entries(flagMap)) {
      if (text.includes(emoji)) return code;
    }

    return null;
  }

  // ── Export Triggering (runs on /projects/<id>/ranks/<asin> page) ──────────

  /**
   * Trigger Export > Daily Ranks on a project's ranks page.
   * The page uses Material UI components for the export menu.
   */
  async function triggerExport() {
    // Step 1: Find the "Export" button
    const exportBtn = findButtonByText('export');
    if (!exportBtn) {
      throw new Error('Export button not found on page');
    }

    // Step 2: Click to open the MUI dropdown menu
    exportBtn.click();
    await sleep(800);

    // Step 3: Wait for the MUI menu/popover to appear
    const menu = await waitForElement(
      '[role="menu"], [role="presentation"] ul, ' +
      '.MuiMenu-list, .MuiPopover-paper, .MuiPaper-root ul',
      5000
    );

    if (!menu) {
      throw new Error('Export menu did not open');
    }

    await sleep(300);

    // Step 4: Find and click "Daily Ranks" menu item
    const menuItems = document.querySelectorAll(
      '[role="menuitem"], .MuiMenuItem-root, ' +
      '.MuiListItem-root, [role="presentation"] li'
    );

    let dailyRanksItem = null;
    for (const item of menuItems) {
      const text = item.textContent?.trim().toLowerCase() || '';
      if (text.includes('daily') && text.includes('rank')) {
        dailyRanksItem = item;
        break;
      }
    }

    if (!dailyRanksItem) {
      // Close the menu if we can't find Daily Ranks
      document.body.click();
      throw new Error('Daily Ranks option not found in export menu');
    }

    dailyRanksItem.click();

    // Step 5: Wait for the download to initiate
    await sleep(3000);
    return true;
  }

  /**
   * Find a button element by its visible text content.
   */
  function findButtonByText(searchText) {
    const candidates = document.querySelectorAll(
      'button, [role="button"], a.MuiButtonBase-root, .MuiButton-root'
    );
    for (const btn of candidates) {
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (text.includes(searchText.toLowerCase())) {
        return btn;
      }
    }
    return null;
  }

  // ── Utility Functions ───────────────────────────────────────────────────

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
    if (message.action === 'getProjects') {
      var projects = detectProjects();
      sendResponse({ projects: projects });
      return true;
    }

    if (message.action === 'triggerExport') {
      triggerExport()
        .then(function () { sendResponse({ success: true }); })
        .catch(function (err) { sendResponse({ success: false, error: err.message }); });
      return true; // async response
    }

    return false;
  });
})();
