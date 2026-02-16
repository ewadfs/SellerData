/**
 * Content script for Amazon Seller Central messaging pages.
 * Detects customer messages and injects quick-action toolbar.
 */

(function () {
  'use strict';

  const TOOLBAR_ID = 'sellerdata-toolbar';

  /**
   * Try to extract the customer's message text from the page.
   * Amazon Seller Central uses various layouts; we try common selectors.
   */
  function extractCustomerMessage() {
    // Buyer message containers (various SC layouts)
    const selectors = [
      '.message-body',
      '.buyer-message-text',
      '[data-test-id="message-body"]',
      '.comm-mgr-message-content',
      '.message-text-content',
      '.message-content-body'
    ];

    for (const sel of selectors) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        // Get the latest customer message (usually the last one)
        const lastMsg = elements[elements.length - 1];
        return lastMsg.innerText.trim();
      }
    }

    return '';
  }

  /**
   * Try to extract order ID from the page.
   */
  function extractOrderId() {
    const selectors = [
      '[data-test-id="order-id"]',
      '.order-id-value',
      '.comm-mgr-order-id'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.innerText.trim();
    }

    // Fallback: look for order ID pattern in page text
    const pageText = document.body.innerText;
    const orderIdMatch = pageText.match(/\b\d{3}-\d{7}-\d{7}\b/);
    return orderIdMatch ? orderIdMatch[0] : '';
  }

  /**
   * Find the reply textarea on the page.
   */
  function findReplyTextarea() {
    const selectors = [
      '#message-text-area',
      'textarea[name="message"]',
      '.message-textarea',
      '[data-test-id="reply-textarea"]',
      'textarea.kat-textarea'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Fallback: any textarea on the page
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.offsetHeight > 0 && ta.offsetWidth > 0) {
        return ta;
      }
    }
    return null;
  }

  /**
   * Insert text into the reply textarea.
   */
  function insertIntoReply(text) {
    const textarea = findReplyTextarea();
    if (!textarea) {
      alert('SellerData: Could not find the reply textarea on this page.');
      return false;
    }

    // Set value and trigger input events so Amazon's JS picks up the change
    textarea.focus();
    textarea.value = text;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * Create and inject the SellerData toolbar into the messaging page.
   */
  function injectToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;

    const toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.innerHTML = `
      <div class="sellerdata-toolbar-inner">
        <span class="sellerdata-logo">SellerData</span>
        <button class="sellerdata-btn sellerdata-btn-ai" id="sellerdata-ai-btn">
          AI Response
        </button>
        <button class="sellerdata-btn sellerdata-btn-refund" id="sellerdata-refund-btn">
          Refund
        </button>
        <button class="sellerdata-btn sellerdata-btn-replace" id="sellerdata-replace-btn">
          Replacement
        </button>
        <div class="sellerdata-status" id="sellerdata-status"></div>
      </div>
    `;

    // Insert toolbar before the reply area, or at the top of the page
    const replyArea = findReplyTextarea();
    if (replyArea && replyArea.parentElement) {
      replyArea.parentElement.insertBefore(toolbar, replyArea);
    } else {
      document.body.prepend(toolbar);
    }

    // AI Response button
    document.getElementById('sellerdata-ai-btn').addEventListener('click', async () => {
      const statusEl = document.getElementById('sellerdata-status');
      statusEl.textContent = 'Generating...';

      const customerMessage = extractCustomerMessage();
      if (!customerMessage) {
        statusEl.textContent = 'No customer message found on page.';
        return;
      }

      const settings = await loadSettings();
      if (!settings.apiKey) {
        statusEl.textContent = 'Set your API key in the extension popup.';
        return;
      }

      chrome.runtime.sendMessage(
        {
          action: 'generateResponse',
          apiKey: settings.apiKey,
          customerMessage,
          tone: settings.tone,
          sellerName: settings.sellerName
        },
        (response) => {
          if (response && response.success) {
            insertIntoReply(response.response);
            statusEl.textContent = 'Response inserted!';
          } else {
            statusEl.textContent = `Error: ${response?.error || 'Unknown error'}`;
          }
        }
      );
    });

    // Refund button - navigate to order page
    document.getElementById('sellerdata-refund-btn').addEventListener('click', () => {
      const orderId = extractOrderId();
      chrome.runtime.sendMessage({
        action: 'openRefundPage',
        orderId
      });
    });

    // Replacement button - navigate to order page
    document.getElementById('sellerdata-replace-btn').addEventListener('click', () => {
      const orderId = extractOrderId();
      chrome.runtime.sendMessage({
        action: 'openReplacementPage',
        orderId
      });
    });
  }

  // Notify popup that we're on a Seller Central messaging page
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'getPageInfo') {
      sendResponse({
        isMessagingPage: true,
        customerMessage: extractCustomerMessage(),
        orderId: extractOrderId()
      });
      return false;
    }

    if (request.action === 'insertReply') {
      const success = insertIntoReply(request.text);
      sendResponse({ success });
      return false;
    }
  });

  // Inject toolbar when the page is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectToolbar);
  } else {
    injectToolbar();
  }

  // Re-inject if the page dynamically updates (SPA navigation)
  const observer = new MutationObserver(() => {
    if (!document.getElementById(TOOLBAR_ID)) {
      injectToolbar();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
