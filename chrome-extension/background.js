/**
 * Background service worker for SellerData Chrome Extension.
 * Handles AI message generation via OpenAI API.
 */

/**
 * Generate an AI response to a customer message using OpenAI.
 */
async function generateAIResponse(apiKey, customerMessage, tone, sellerName, context) {
  const systemPrompt = `You are a customer service assistant for "${sellerName}", an Amazon seller.
Generate a response to the customer's message below.

Guidelines:
- Tone: ${tone}
- Be helpful and solution-oriented
- Follow Amazon's communication policies (no links to external sites, no promotional content)
- Never ask the customer to leave a review or modify a review
- Keep the response concise but thorough
- Address the customer's specific concern directly
- If the issue involves a defect or damage, express empathy and offer a resolution
- Sign off with the seller name
${context ? `\nAdditional context: ${context}` : ''}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Customer message:\n\n${customerMessage}` }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API request failed (${response.status})`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'generateResponse') {
    const { apiKey, customerMessage, tone, sellerName, context } = request;

    generateAIResponse(apiKey, customerMessage, tone, sellerName, context)
      .then((response) => sendResponse({ success: true, response }))
      .catch((error) => sendResponse({ success: false, error: error.message }));

    // Return true to indicate async response
    return true;
  }

  if (request.action === 'openRefundPage') {
    const orderId = request.orderId || '';
    const url = `https://sellercentral.amazon.com/orders-v3/order/${orderId}`;
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'openReplacementPage') {
    const orderId = request.orderId || '';
    const url = `https://sellercentral.amazon.com/orders-v3/order/${orderId}`;
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return false;
  }
});
