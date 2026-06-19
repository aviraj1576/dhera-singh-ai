const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../db/supabase');
require('dotenv').config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function buildSystemPrompt(instagramLink) {
  // Fetch company context
  const { data: ctx } = await supabase.from('company_context').select('key, value');
  const contextStr = (ctx || []).map(c => `${c.key}: ${c.value}`).join('\n');

  // Fetch products — if we have a specific link, prioritise that product
  let products = [];
  if (instagramLink) {
    const { data: linked } = await supabase
      .from('products')
      .select('*')
      .eq('instagram_link', instagramLink);
    if (linked?.length) products = linked;
  }
  if (!products.length) {
    const { data: all } = await supabase.from('products').select('*').limit(200);
    products = all || [];
  }

  const productStr = products.map(p =>
    `• ${p.name} | ID: ${p.product_id} | Price: ₹${p.price} | Weight: ${p.weight}g | Purity: ${p.purity}${p.instagram_link ? ` | Post: ${p.instagram_link}` : ''}`
  ).join('\n') || 'No products currently in database.';

  return `You are the AI customer service representative for Dhera Singh Jewellers.

SHOP INFORMATION:
${contextStr}

LIVE PRODUCT CATALOGUE (prices updated 4× daily):
${productStr}

YOUR RULES — follow these strictly, no exceptions:
1. Only answer questions about Dhera Singh Jewellers, our products, and our services.
2. Greet every response with "Sat Shri Akal Ji 🙏" or "Waheguru Ji".
3. For price/weight/purity questions, look up the exact product in the catalogue above.
4. If a post link is provided, use it to identify the exact product being asked about.
5. If the customer asks about a product NOT in the catalogue, say you will check and escalate — respond ONLY with the text: HANDOFF_NEEDED
6. If you are confused about what they are asking, respond ONLY with: HANDOFF_NEEDED
7. Never answer questions unrelated to jewellery or this shop.
8. Use warm, respectful Punjabi-style language. Add "Ji" often. Use ₹ for prices.
9. Keep responses to 3–5 sentences maximum. Be helpful, not verbose.
10. For service questions (resizing, custom orders, availability), use the shop information above.`;
}

async function processMessage(input, instagramLink = null) {
  const systemPrompt = await buildSystemPrompt(instagramLink);

  const userContent = instagramLink
    ? `[Context: Customer is asking about the product at this Instagram post: ${instagramLink}]\n\nCustomer says: ${input}`
    : input;

  const t0 = Date.now();
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }]
  });
  const latencyMs = Date.now() - t0;

  const raw = msg.content[0].text.trim();
  const isHandoff = raw.includes('HANDOFF_NEEDED');

  return {
    output: isHandoff
      ? 'Sat Shri Akal Ji 🙏 This query needs our personal attention. Our team will reply within 30 minutes. Thank you for your patience, Ji! ✨'
      : raw,
    status: isHandoff ? 'human_needed' : 'answered',
    latencyMs
  };
}

module.exports = { processMessage };