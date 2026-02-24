/**
 * Datarova Bulk Report Downloader - Background Service Worker
 *
 * Orchestrates bulk export by navigating the tab to each project's ranks page
 * and triggering Export > Daily Ranks via the content script.
 */

const EXPORT_DELAY_MS = 3000; // Delay between exports to avoid overwhelming Datarova
const PAGE_LOAD_WAIT_MS = 4000; // Wait for SPA content to render after navigation

// ── Message Handling ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'bulkExport') {
    handleBulkExport(message.projects, message.tabId, message.returnUrl)
      .then((results) => sendResponse({ success: true, results }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
  return false;
});

// ── Bulk Export Orchestrator ──────────────────────────────────────────────

async function handleBulkExport(projects, tabId, returnUrl) {
  const results = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];

    try {
      // Build the ranks page URL for this project
      const url = buildRanksUrl(returnUrl, project.id, project.asin);

      // Navigate the tab to the project's ranks page
      await navigateTab(tabId, url);

      // Wait for the SPA to render
      await sleep(PAGE_LOAD_WAIT_MS);

      // Inject content script (may already be auto-injected via manifest)
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
      } catch (e) {
        // Content script may already be loaded, that's fine
      }
      await sleep(500);

      // Tell the content script to trigger Export > Daily Ranks
      const response = await sendMessageToTab(tabId, { action: 'triggerExport' });

      if (response && response.success) {
        results.push({ id: project.id, name: project.name, success: true });
        reportProgress(project.name, true, null, i + 1, projects.length);
      } else {
        const error = response?.error || 'Export failed';
        results.push({ id: project.id, name: project.name, success: false, error });
        reportProgress(project.name, false, error, i + 1, projects.length);
      }
    } catch (err) {
      results.push({ id: project.id, name: project.name, success: false, error: err.message });
      reportProgress(project.name, false, err.message, i + 1, projects.length);
    }

    // Delay between exports
    if (i < projects.length - 1) {
      await sleep(EXPORT_DELAY_MS);
    }
  }

  // Navigate back to the projects page when done
  if (returnUrl) {
    try {
      await navigateTab(tabId, returnUrl);
    } catch (e) {
      // Best effort
    }
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build the URL for a project's ranks page.
 * Uses the origin from the return URL (app.datarova.com).
 */
function buildRanksUrl(returnUrl, projectId, asin) {
  let origin = 'https://app.datarova.com';
  try {
    origin = new URL(returnUrl).origin;
  } catch (e) {
    // Use default
  }
  let url = `${origin}/projects/${projectId}`;
  if (asin) {
    url += `/ranks/${asin}`;
  }
  return url;
}

/**
 * Navigate a tab to a URL and wait for it to finish loading.
 */
function navigateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Navigation timeout'));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url });
  });
}

/**
 * Send a message to a content script in a tab, with retry logic.
 */
async function sendMessageToTab(tabId, message) {
  const MAX_RETRIES = 3;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
      if (i < MAX_RETRIES - 1) {
        await sleep(1000);
      } else {
        throw err;
      }
    }
  }
}

/**
 * Send progress updates to the popup (if it's still open).
 */
function reportProgress(projectName, success, error, completed, total) {
  try {
    chrome.runtime.sendMessage({
      action: 'exportProgress',
      projectName,
      success,
      error,
      completed,
      total,
    });
  } catch (e) {
    // Popup may have been closed, ignore
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Extension Install Handler ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Datarova Bulk Downloader installed.');
  } else if (details.reason === 'update') {
    console.log('Datarova Bulk Downloader updated to v' + chrome.runtime.getManifest().version);
  }
});
