const axios = require('axios');

const BASE = 'https://graph.instagram.com/v19.0';

async function sendInstagramDM(recipientId, text) {
  try {
    await axios.post(
      `${BASE}/me/messages`,
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: process.env.META_IG_ACCESS_TOKEN } }
    );
  } catch (err) {
    console.error('[IG DM error]', err.response?.data || err.message);
  }
}

async function replyInstagramComment(commentId, text) {
  try {
    await axios.post(
      `${BASE}/${commentId}/replies`,
      { message: text },
      { params: { access_token: process.env.META_IG_ACCESS_TOKEN } }
    );
  } catch (err) {
    console.error('[IG comment reply error]', err.response?.data || err.message);
  }
}

module.exports = { sendInstagramDM, replyInstagramComment };