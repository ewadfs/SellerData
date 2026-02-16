/**
 * Popup script for SellerData Chrome Extension.
 * Handles UI interactions, AI message generation, and quick actions.
 */

(function () {
  'use strict';

  // DOM elements
  const mainSection = document.getElementById('main-section');
  const settingsSection = document.getElementById('settings-section');
  const refundSection = document.getElementById('refund-section');
  const replacementSection = document.getElementById('replacement-section');

  const settingsBtn = document.getElementById('settings-btn');
  const backBtn = document.getElementById('back-btn');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const settingsStatus = document.getElementById('settings-status');

  const apiKeyInput = document.getElementById('api-key-input');
  const sellerNameInput = document.getElementById('seller-name-input');
  const toneSelect = document.getElementById('tone-select');

  const pageStatus = document.getElementById('page-status');
  const customerMessageEl = document.getElementById('customer-message');
  const aiResponseEl = document.getElementById('ai-response');

  const generateBtn = document.getElementById('generate-btn');
  const copyBtn = document.getElementById('copy-btn');
  const insertBtn = document.getElementById('insert-btn');
  const regenerateBtn = document.getElementById('regenerate-btn');

  const refundBtn = document.getElementById('refund-btn');
  const replacementBtn = document.getElementById('replacement-btn');

  let currentSettings = {};

  // --- Section Navigation ---

  function showSection(section) {
    [mainSection, settingsSection, refundSection, replacementSection].forEach(
      (s) => s.classList.add('hidden')
    );
    section.classList.remove('hidden');
  }

  settingsBtn.addEventListener('click', () => showSection(settingsSection));
  backBtn.addEventListener('click', () => showSection(mainSection));

  document.querySelectorAll('.back-to-main').forEach((btn) => {
    btn.addEventListener('click', () => showSection(mainSection));
  });

  // --- Settings ---

  async function initSettings() {
    currentSettings = await loadSettings();
    apiKeyInput.value = currentSettings.apiKey;
    sellerNameInput.value = currentSettings.sellerName;
    toneSelect.value = currentSettings.tone;
  }

  saveSettingsBtn.addEventListener('click', async () => {
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      sellerName: sellerNameInput.value.trim() || 'Our Store',
      tone: toneSelect.value
    };
    await saveSettings(settings);
    currentSettings = settings;
    settingsStatus.textContent = 'Settings saved!';
    setTimeout(() => {
      settingsStatus.textContent = '';
    }, 2000);
  });

  // --- Page Detection ---

  async function detectPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      const url = tab.url || '';
      const isSellerCentral = url.includes('sellercentral.amazon.');

      if (isSellerCentral) {
        pageStatus.textContent = 'Connected to Seller Central';
        pageStatus.classList.add('active');

        // Try to get page info from content script
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageInfo' });
          if (response && response.customerMessage) {
            customerMessageEl.value = response.customerMessage;
          }
          if (response && response.orderId) {
            document.getElementById('refund-order-id').value = response.orderId;
            document.getElementById('replacement-order-id').value = response.orderId;
          }
        } catch {
          // Content script may not be loaded on this specific page
        }
      } else {
        pageStatus.textContent = 'Not on Seller Central';
        pageStatus.classList.remove('active');
      }
    } catch {
      // Permission not granted or tab not accessible
    }
  }

  // --- AI Response Generation ---

  async function generateResponse() {
    const message = customerMessageEl.value.trim();
    if (!message) {
      aiResponseEl.value = 'Please enter or paste a customer message first.';
      return;
    }

    if (!currentSettings.apiKey) {
      aiResponseEl.value = 'Please set your OpenAI API key in Settings.';
      showSection(settingsSection);
      return;
    }

    generateBtn.disabled = true;
    generateBtn.classList.add('loading');
    generateBtn.textContent = 'Generating...';
    aiResponseEl.value = '';

    chrome.runtime.sendMessage(
      {
        action: 'generateResponse',
        apiKey: currentSettings.apiKey,
        customerMessage: message,
        tone: currentSettings.tone,
        sellerName: currentSettings.sellerName
      },
      (response) => {
        generateBtn.disabled = false;
        generateBtn.classList.remove('loading');
        generateBtn.textContent = 'Generate AI Response';

        if (response && response.success) {
          aiResponseEl.value = response.response;
          copyBtn.disabled = false;
          insertBtn.disabled = false;
          regenerateBtn.disabled = false;
        } else {
          aiResponseEl.value = `Error: ${response?.error || 'Failed to generate response. Check your API key.'}`;
        }
      }
    );
  }

  generateBtn.addEventListener('click', generateResponse);
  regenerateBtn.addEventListener('click', generateResponse);

  // --- Copy & Insert ---

  copyBtn.addEventListener('click', async () => {
    const text = aiResponseEl.value;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    } catch {
      // Fallback
      aiResponseEl.select();
      document.execCommand('copy');
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1500);
    }
  });

  insertBtn.addEventListener('click', async () => {
    const text = aiResponseEl.value;
    if (!text) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'insertReply',
        text
      });

      if (response && response.success) {
        insertBtn.textContent = 'Inserted!';
        setTimeout(() => {
          insertBtn.textContent = 'Insert into Reply';
        }, 1500);
      } else {
        insertBtn.textContent = 'Failed';
        setTimeout(() => {
          insertBtn.textContent = 'Insert into Reply';
        }, 1500);
      }
    } catch {
      insertBtn.textContent = 'Not on messaging page';
      setTimeout(() => {
        insertBtn.textContent = 'Insert into Reply';
      }, 2000);
    }
  });

  // --- Quick Templates ---

  document.querySelectorAll('.template-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const templateKey = btn.dataset.template;
      const template = TEMPLATES[templateKey];
      if (template) {
        aiResponseEl.value = fillTemplate(template, {
          sellerName: currentSettings.sellerName
        });
        copyBtn.disabled = false;
        insertBtn.disabled = false;
        regenerateBtn.disabled = false;
      }
    });
  });

  // --- Quick Actions: Refund ---

  refundBtn.addEventListener('click', () => showSection(refundSection));

  document.getElementById('process-refund-btn').addEventListener('click', () => {
    const orderId = document.getElementById('refund-order-id').value.trim();
    chrome.runtime.sendMessage({ action: 'openRefundPage', orderId });
  });

  document.getElementById('refund-generate-msg-btn').addEventListener('click', () => {
    const orderId = document.getElementById('refund-order-id').value.trim();
    const amount = document.getElementById('refund-amount').value;
    const reason = document.getElementById('refund-reason').value;

    const msg = fillTemplate(TEMPLATES.refund_confirmation, {
      sellerName: currentSettings.sellerName,
      orderId: orderId || '[Order ID]',
      amount: amount ? `$${parseFloat(amount).toFixed(2)}` : '[Amount]',
      reason: REASON_LABELS[reason] || reason
    });

    aiResponseEl.value = msg;
    copyBtn.disabled = false;
    insertBtn.disabled = false;
    showSection(mainSection);
  });

  // --- Quick Actions: Replacement ---

  replacementBtn.addEventListener('click', () => showSection(replacementSection));

  document.getElementById('process-replacement-btn').addEventListener('click', () => {
    const orderId = document.getElementById('replacement-order-id').value.trim();
    chrome.runtime.sendMessage({ action: 'openReplacementPage', orderId });
  });

  document.getElementById('replacement-generate-msg-btn').addEventListener('click', () => {
    const orderId = document.getElementById('replacement-order-id').value.trim();

    const msg = fillTemplate(TEMPLATES.replacement_confirmation, {
      sellerName: currentSettings.sellerName,
      orderId: orderId || '[Order ID]'
    });

    aiResponseEl.value = msg;
    copyBtn.disabled = false;
    insertBtn.disabled = false;
    showSection(mainSection);
  });

  // --- Init ---

  initSettings().then(detectPage);
})();
