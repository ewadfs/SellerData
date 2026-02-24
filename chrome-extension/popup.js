/**
 * Datarova Bulk Report Downloader - Popup Script
 *
 * Handles UI interactions, communicates with the content script to detect
 * projects, and orchestrates bulk report downloads via the background script.
 */

const MARKETPLACES = ['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES'];

// DOM elements
const reportTypeSelect = document.getElementById('report-type');
const dateRangeSelect = document.getElementById('date-range');
const customDates = document.getElementById('custom-dates');
const dateStart = document.getElementById('date-start');
const dateEnd = document.getElementById('date-end');
const downloadFormat = document.getElementById('download-format');
const btnDownload = document.getElementById('btn-download');
const btnCancel = document.getElementById('btn-cancel');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const downloadLog = document.getElementById('download-log');
const projectsLoading = document.getElementById('projects-loading');
const projectsList = document.getElementById('projects-list');
const noProjects = document.getElementById('no-projects');
const notOnDatarova = document.getElementById('not-on-datarova');
const mainControls = document.getElementById('main-controls');

let isDownloading = false;
let cancelRequested = false;

// ── Initialization ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkActiveTab();
  await loadSavedPreferences();
});

function setupEventListeners() {
  // Date range toggle
  dateRangeSelect.addEventListener('change', () => {
    customDates.classList.toggle('hidden', dateRangeSelect.value !== 'custom');
  });

  // Select/deselect all marketplaces
  document.getElementById('select-all-markets').addEventListener('click', () => {
    toggleAllCheckboxes('marketplace-list', true);
  });
  document.getElementById('deselect-all-markets').addEventListener('click', () => {
    toggleAllCheckboxes('marketplace-list', false);
  });

  // Select/deselect all projects
  document.getElementById('select-all-projects').addEventListener('click', () => {
    toggleAllCheckboxes('projects-list', true);
  });
  document.getElementById('deselect-all-projects').addEventListener('click', () => {
    toggleAllCheckboxes('projects-list', false);
  });

  // Download button
  btnDownload.addEventListener('click', startBulkDownload);
  btnCancel.addEventListener('click', () => {
    cancelRequested = true;
    btnCancel.disabled = true;
    addLogEntry('Cancellation requested...', 'info');
  });
}

// ── Tab Detection ───────────────────────────────────────────────────────────

async function checkActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('datarova.com')) {
      notOnDatarova.classList.remove('hidden');
      mainControls.classList.add('hidden');
      return;
    }
    await detectProjects(tab.id);
  } catch (err) {
    console.error('Tab check failed:', err);
    showProjectsError();
  }
}

async function detectProjects(tabId) {
  const MAX_RETRIES = 4;
  const RETRY_DELAY_MS = 1500;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // On first failure, try injecting the content script on-demand
      if (attempt === 1) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          });
          // Give injected script time to initialize
          await new Promise((r) => setTimeout(r, 500));
        } catch (injectErr) {
          console.warn('Script injection skipped (may already be loaded):', injectErr);
        }
      }

      const response = await chrome.tabs.sendMessage(tabId, { action: 'getProjects' });
      if (response && response.projects && response.projects.length > 0) {
        renderProjects(response.projects);
        return;
      }

      // No projects found yet - wait and retry (SPA may still be rendering)
      if (attempt < MAX_RETRIES - 1) {
        projectsLoading.textContent = `Scanning for projects (attempt ${attempt + 2}/${MAX_RETRIES})...`;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    } catch (err) {
      console.warn(`Project detection attempt ${attempt + 1} failed:`, err);
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  // All retries exhausted
  showProjectsError();
}

function renderProjects(projects) {
  projectsLoading.classList.add('hidden');
  projectsList.classList.remove('hidden');
  projectsList.innerHTML = '';

  projects.forEach((project) => {
    const label = document.createElement('label');
    label.className = 'checkbox-item';
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(project.id)}" checked>
      ${escapeHtml(project.name)}
    `;
    projectsList.appendChild(label);
  });
}

function showProjectsError() {
  projectsLoading.classList.add('hidden');
  noProjects.classList.remove('hidden');
}

// ── Bulk Download ───────────────────────────────────────────────────────────

async function startBulkDownload() {
  const selectedMarkets = getSelectedValues('marketplace-list');
  const selectedProjects = getSelectedValues('projects-list');
  const reportType = reportTypeSelect.value;
  const format = downloadFormat.value;
  const dateRange = getDateRange();

  if (selectedMarkets.length === 0) {
    alert('Please select at least one marketplace.');
    return;
  }

  // Begin download process
  isDownloading = true;
  cancelRequested = false;
  btnDownload.disabled = true;
  btnText.textContent = 'Downloading...';
  btnSpinner.classList.remove('hidden');
  btnCancel.classList.remove('hidden');
  progressSection.classList.remove('hidden');
  downloadLog.innerHTML = '';

  const totalTasks = selectedMarkets.length * Math.max(selectedProjects.length, 1);
  let completedTasks = 0;

  addLogEntry(`Starting bulk download: ${totalTasks} report(s)`, 'info');

  for (const market of selectedMarkets) {
    if (cancelRequested) break;

    if (selectedProjects.length > 0) {
      for (const project of selectedProjects) {
        if (cancelRequested) break;

        try {
          updateProgress(completedTasks, totalTasks,
            `Downloading ${reportType} for ${market} - Project: ${project}...`);

          await requestDownload({
            reportType,
            marketplace: market,
            projectId: project,
            format,
            dateRange,
          });

          completedTasks++;
          addLogEntry(`${market} / ${project}: Downloaded`, 'success');
        } catch (err) {
          completedTasks++;
          addLogEntry(`${market} / ${project}: Failed - ${err.message}`, 'error');
        }
      }
    } else {
      // No projects detected, download per marketplace only
      try {
        updateProgress(completedTasks, totalTasks,
          `Downloading ${reportType} for ${market}...`);

        await requestDownload({
          reportType,
          marketplace: market,
          projectId: null,
          format,
          dateRange,
        });

        completedTasks++;
        addLogEntry(`${market}: Downloaded`, 'success');
      } catch (err) {
        completedTasks++;
        addLogEntry(`${market}: Failed - ${err.message}`, 'error');
      }
    }
  }

  // Done
  updateProgress(totalTasks, totalTasks,
    cancelRequested ? 'Download cancelled.' : 'All downloads complete!');
  finishDownload();
  savePreferences();
}

async function requestDownload(params) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: 'downloadReport', params },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Unknown error'));
        }
      }
    );
  });
}

function finishDownload() {
  isDownloading = false;
  btnDownload.disabled = false;
  btnText.textContent = 'Download Reports';
  btnSpinner.classList.add('hidden');
  btnCancel.classList.add('hidden');
  btnCancel.disabled = false;
}

// ── UI Helpers ──────────────────────────────────────────────────────────────

function updateProgress(completed, total, message) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${message} (${completed}/${total})`;
}

function addLogEntry(message, type) {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  downloadLog.appendChild(entry);
  downloadLog.scrollTop = downloadLog.scrollHeight;
}

function getSelectedValues(containerId) {
  const container = document.getElementById(containerId);
  const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value);
}

function toggleAllCheckboxes(containerId, checked) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = checked;
  });
}

function getDateRange() {
  const value = dateRangeSelect.value;
  if (value === 'custom') {
    return { type: 'custom', start: dateStart.value, end: dateEnd.value };
  }
  const days = parseInt(value.replace('last-', ''), 10);
  return { type: 'relative', days };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Preferences Persistence ─────────────────────────────────────────────────

async function savePreferences() {
  try {
    await chrome.storage.local.set({
      preferences: {
        reportType: reportTypeSelect.value,
        dateRange: dateRangeSelect.value,
        format: downloadFormat.value,
        selectedMarkets: getSelectedValues('marketplace-list'),
      },
    });
  } catch (err) {
    console.error('Failed to save preferences:', err);
  }
}

async function loadSavedPreferences() {
  try {
    const { preferences } = await chrome.storage.local.get('preferences');
    if (!preferences) return;

    if (preferences.reportType) reportTypeSelect.value = preferences.reportType;
    if (preferences.dateRange) {
      dateRangeSelect.value = preferences.dateRange;
      customDates.classList.toggle('hidden', preferences.dateRange !== 'custom');
    }
    if (preferences.format) downloadFormat.value = preferences.format;
    if (preferences.selectedMarkets) {
      const container = document.getElementById('marketplace-list');
      container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.checked = preferences.selectedMarkets.includes(cb.value);
      });
    }
  } catch (err) {
    console.error('Failed to load preferences:', err);
  }
}
