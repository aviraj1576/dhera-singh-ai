const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const { processMessage } = require('../services/ai-agent');
const { sendInstagramDM, replyInstagramComment } = require('../services/instagram');
const { sendWhatsAppMessage } = require('../services/whatsapp');

const PUBLIC_COMMENT_REPLY = 'Sat Shri Akal Ji 🙏, please check your DM for more details!';

// ── Verification handshake (GET)
router.get('/', (req, res) => {
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN
  ) {
    console.log('[Webhook] Verified');
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// ── Receive events (POST)
router.post('/', async (req, res) => {
  res.sendStatus(200); // Always ACK immediately — Meta requires < 20s

  const body = req.body;

  // ── Instagram events
  if (body.object === 'instagram') {
    for (const entry of body.entry || []) {
      // DMs (and story replies — they arrive here too)
      for (const event of entry.messaging || []) {
        if (event.message && !event.message.is_echo) {
          await handleInstagramDM(event).catch(console.error);
        }
      }
      // Comments on posts/reels
      for (const change of entry.changes || []) {
        if (change.field === 'comments') {
          await handleInstagramComment(change.value).catch(console.error);
        }
      }
    }
  }

  // ── WhatsApp events
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const msgs = change.value?.messages || [];
        const meta = change.value?.metadata;
        for (const msg of msgs) {
          if (msg.type === 'text') {
            await handleWhatsAppMessage(msg, meta).catch(console.error);
          }
        }
      }
    }
  }
});

// ──────────────────────────────────────────
async function handleInstagramComment(value) {
  const commentId = value.id;
  const commentText = value.text;
  const senderId = value.from?.id;
  const mediaId = value.media?.id || '';

  // Build the Instagram post URL (we store this format in products.instagram_link)
  // Resolve shortcode from media ID via Graph API if needed — for now use ID-based URL
  const postLink = `https://www.instagram.com/p/${mediaId}/`;

  // 1. Reply publicly — redirect to DM
  await replyInstagramComment(commentId, PUBLIC_COMMENT_REPLY);

  // 2. Generate AI answer
  const result = await processMessage(commentText, postLink);

  // 3. Log the conversation
  await supabase.from('conversations').insert({
    hyperlink: postLink,
    input: commentText,
    output: result.output,
    status: result.status,
    platform: 'instagram_comment',
    sender_id: senderId,
    latency_ms: result.latencyMs
  });

  // 4. Send real answer via DM
  if (senderId) await sendInstagramDM(senderId, result.output);
}

async function handleInstagramDM(event) {
  const senderId = event.sender.id;
  const text = event.message.text;
  if (!text) return;

  // Check if this sender recently commented on a post (to get context link)
  const { data: prev } = await supabase
    .from('conversations')
    .select('hyperlink')
    .eq('sender_id', senderId)
    .not('hyperlink', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  const link = prev?.[0]?.hyperlink || null;
  const result = await processMessage(text, link);

  await supabase.from('conversations').insert({
    hyperlink: link,
    input: text,
    output: result.output,
    status: result.status,
    platform: 'instagram_dm',
    sender_id: senderId,
    latency_ms: result.latencyMs
  });

  await sendInstagramDM(senderId, result.output);
}

async function handleWhatsAppMessage(message, metadata) {
  const from = message.from;
  const text = message.text.body;

  const result = await processMessage(text, null);

  await supabase.from('conversations').insert({
    hyperlink: null,
    input: text,
    output: result.output,
    status: result.status,
    platform: 'whatsapp',
    sender_id: from,
    latency_ms: result.latencyMs
  });

  await sendWhatsAppMessage(from, result.output, metadata.phone_number_id);
}

module.exports = router;