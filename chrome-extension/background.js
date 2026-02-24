/**
 * Datarova Bulk Report Downloader - Background Service Worker
 *
 * Manages download operations by coordinating between the popup and
 * content scripts. Handles sequential report downloads with rate limiting
 * to avoid overwhelming the Datarova servers.
 */

const DOWNLOAD_DELAY_MS = 2000; // Delay between downloads to be respectful

// ── Message Handling ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'downloadReport') {
    handleDownloadReport(message.params)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
  return false;
});

// ── Download Handler ──────────────────────────────────────────────────────

async function handleDownloadReport(params) {
  const { reportType, marketplace, projectId, format, dateRange } = params;

  try {
    // Find the active Datarova tab
    const tabs = await chrome.tabs.query({ url: 'https://*.datarova.com/*' });
    if (tabs.length === 0) {
      throw new Error('No Datarova tab found. Please open datarova.com first.');
    }

    const tabId = tabs[0].id;

    // Send download command to the content script
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'triggerDownload',
      params: { reportType, marketplace, projectId, format, dateRange },
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Download failed');
    }

    // Respectful delay between downloads
    await sleep(DOWNLOAD_DELAY_MS);

    return { success: true };
  } catch (err) {
    console.error('Download error:', err);
    return { success: false, error: err.message };
  }
}

// ── Utility Functions ─────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Extension Install Handler ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Datarova Bulk Downloader installed successfully.');
  } else if (details.reason === 'update') {
    console.log(`Datarova Bulk Downloader updated to version ${chrome.runtime.getManifest().version}`);
  }
});
