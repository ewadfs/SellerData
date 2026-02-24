/**
 * Datarova Bulk Report Downloader - Background Service Worker
 *
 * Two-phase bulk workflow:
 *   Phase 1 (Export): Navigate to each project's ranks page and trigger
 *                     Export > Daily Ranks.
 *   Phase 2 (Download): Navigate to /download-report, click download
 *                        buttons on the Ready rows.
 */

const EXPORT_DELAY_MS = 3000;
const PAGE_LOAD_WAIT_MS = 4000;
const DOWNLOAD_PAGE_WAIT_MS = 5000;

// ── Message Handling ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'bulkExport') {
    handleBulkExport(message.projects, message.tabId, message.returnUrl)
      .then((results) => sendResponse({ success: true, results }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
  return false;
});

// ── Bulk Export + Download Orchestrator ──────────────────────────────────

async function handleBulkExport(projects, tabId, returnUrl) {
  const results = [];
  const exportCount = projects.length;

  // ── Phase 1: Export Daily Ranks for each project ──
  reportPhase('export', 0, exportCount);

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];

    try {
      const url = buildRanksUrl(returnUrl, project.id, project.asin);
      await navigateTab(tabId, url);
      await sleep(PAGE_LOAD_WAIT_MS);

      await injectContentScript(tabId);
      await sleep(500);

      const response = await sendMessageToTab(tabId, { action: 'triggerExport' });

      if (response && response.success) {
        results.push({ id: project.id, name: project.name, success: true });
        reportProgress('export', project.name, true, null, i + 1, exportCount);
      } else {
        const error = response?.error || 'Export failed';
        results.push({ id: project.id, name: project.name, success: false, error });
        reportProgress('export', project.name, false, error, i + 1, exportCount);
      }
    } catch (err) {
      results.push({ id: project.id, name: project.name, success: false, error: err.message });
      reportProgress('export', project.name, false, err.message, i + 1, exportCount);
    }

    if (i < projects.length - 1) {
      await sleep(EXPORT_DELAY_MS);
    }
  }

  // ── Phase 2: Navigate to download page and click download buttons ──
  const successCount = results.filter((r) => r.success).length;

  if (successCount > 0) {
    reportPhase('download', 0, successCount);

    try {
      const downloadUrl = buildDownloadUrl(returnUrl);
      await navigateTab(tabId, downloadUrl);
      await sleep(DOWNLOAD_PAGE_WAIT_MS);

      await injectContentScript(tabId);
      await sleep(500);

      const dlResponse = await sendMessageToTab(tabId, {
        action: 'downloadReports',
        count: successCount,
      });

      if (dlResponse && dlResponse.success) {
        const r = dlResponse.result;
        reportProgress(
          'download', 'Downloads complete',
          true, null,
          r.downloaded, r.total
        );
      } else {
        reportProgress(
          'download', 'Download failed',
          false, dlResponse?.error || 'Unknown error',
          0, successCount
        );
      }
    } catch (err) {
      reportProgress('download', 'Download error', false, err.message, 0, successCount);
    }
  }

  // ── Return to projects page ──
  if (returnUrl) {
    try { await navigateTab(tabId, returnUrl); } catch (e) { /* best effort */ }
  }

  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildRanksUrl(returnUrl, projectId, asin) {
  const origin = getOrigin(returnUrl);
  let url = `${origin}/projects/${projectId}`;
  if (asin) url += `/ranks/${asin}`;
  return url;
}

function buildDownloadUrl(returnUrl) {
  return getOrigin(returnUrl) + '/download-report';
}

function getOrigin(returnUrl) {
  try { return new URL(returnUrl).origin; } catch (e) { return 'https://app.datarova.com'; }
}

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

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (e) {
    // May already be loaded
  }
}

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
 * Notify popup of phase changes (export → download).
 */
function reportPhase(phase, completed, total) {
  try {
    chrome.runtime.sendMessage({
      action: 'phaseChange',
      phase,
      completed,
      total,
    });
  } catch (e) { /* popup may be closed */ }
}

/**
 * Notify popup of per-item progress within a phase.
 */
function reportProgress(phase, projectName, success, error, completed, total) {
  try {
    chrome.runtime.sendMessage({
      action: 'exportProgress',
      phase,
      projectName,
      success,
      error,
      completed,
      total,
    });
  } catch (e) { /* popup may be closed */ }
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
