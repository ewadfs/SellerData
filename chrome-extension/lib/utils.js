/**
 * Shared utilities for the SellerData Chrome Extension.
 */

const TEMPLATES = {
  apology: `Dear Customer,

I sincerely apologize for the inconvenience you've experienced. We take your satisfaction very seriously and want to make this right.

Please let us know how we can best resolve this for you, and we'll take immediate action.

Best regards,
{{sellerName}}`,

  shipping_delay: `Dear Customer,

Thank you for reaching out. I understand your concern about the shipping delay, and I apologize for the inconvenience.

I've looked into your order and can confirm it is on its way. Due to unexpected logistics delays, delivery may take a few extra days. We're actively monitoring the shipment.

If you have any further questions, please don't hesitate to reach out.

Best regards,
{{sellerName}}`,

  return_instructions: `Dear Customer,

Thank you for contacting us. I'm happy to help you with the return process.

To initiate a return:
1. Go to "Your Orders" in your Amazon account
2. Select the order you'd like to return
3. Choose a reason for the return
4. Select your preferred return method
5. Print the return label and ship the item back

Once we receive the returned item, your refund will be processed within 3-5 business days.

If you need any additional assistance, please let us know.

Best regards,
{{sellerName}}`,

  thank_you: `Dear Customer,

Thank you so much for your purchase and for taking the time to reach out! We truly appreciate your business.

If there's anything else we can help you with, please don't hesitate to ask.

Best regards,
{{sellerName}}`,

  refund_confirmation: `Dear Customer,

I'm writing to confirm that we've initiated a refund of {{amount}} for your order {{orderId}}.

Reason: {{reason}}

The refund should appear in your account within 3-5 business days, depending on your payment method.

We apologize for any inconvenience and appreciate your patience.

Best regards,
{{sellerName}}`,

  replacement_confirmation: `Dear Customer,

I'm writing to confirm that we're sending a replacement for your order {{orderId}}.

The new item will be shipped as soon as possible, and you'll receive a shipping confirmation with tracking information.

You do not need to return the original item.

We apologize for the inconvenience and appreciate your understanding.

Best regards,
{{sellerName}}`
};

const REASON_LABELS = {
  customer_request: 'Customer Request',
  damaged: 'Item Damaged',
  wrong_item: 'Wrong Item Sent',
  not_received: 'Not Received',
  defective: 'Defective Product',
  missing_parts: 'Missing Parts',
  other: 'Other'
};

/**
 * Load settings from Chrome storage.
 */
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['apiKey', 'sellerName', 'tone'],
      (result) => {
        resolve({
          apiKey: result.apiKey || '',
          sellerName: result.sellerName || 'Our Store',
          tone: result.tone || 'professional'
        });
      }
    );
  });
}

/**
 * Save settings to Chrome storage.
 */
function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}

/**
 * Fill template placeholders.
 */
function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return result;
}
