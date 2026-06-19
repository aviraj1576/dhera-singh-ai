const axios = require('axios');

const BASE = 'https://graph.facebook.com/v19.0';

async function sendWhatsAppMessage(to, text, phoneNumberId) {
  try {
    await axios.post(
      `${BASE}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      { headers: { Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}` } }
    );
  } catch (err) {
    console.error('[WA error]', err.response?.data || err.message);
  }
}

module.exports = { sendWhatsAppMessage };