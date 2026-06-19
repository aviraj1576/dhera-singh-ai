# Dhera Singh Jewellers — AI Implementation Guide
**Stack:** Node.js/Express · Supabase (PostgreSQL) · Claude AI · Meta Graph API  
**Target time:** ~2 hours  

---

## Architecture at a Glance

```
[Ornate DB (Local PC)]
       │  bridge/sync.js polls + pushes via internet
       ▼
[Supabase DB] ◄──────────── [Express Backend (Render)]
   products                        │
   conversations            ┌──────┴──────┐
   company_context          │             │
   sync_requests     [Instagram/WA     [React Frontend]
                      Webhook Handler]   (served from Express)
                            │
                     [Claude claude-sonnet-4-6]
```

---

## Phase 0 — Prerequisites (5 min)

### Accounts you need right now (open in parallel tabs):
1. **Supabase** — https://supabase.com → Create Project → name: `dhera-singh` → region: Singapore  
2. **Anthropic** — https://console.anthropic.com → API Keys → Create key  
3. **Render** — https://render.com → Sign up with GitHub  
4. **Meta Developer** — https://developers.facebook.com → Create App → Business type  
5. **GitHub** — Create a new repo `dhera-singh-ai` (you'll push to this for Render deploy)

### On your build machine:
```bash
node -v   # Must be 18+
npm -v    # Must be 8+
git -v
```

---

## Phase 1 — Supabase Database Setup (10 min)

Go to: Supabase project → SQL Editor → New Query → paste and run each block.

### 1A. Core Tables

```sql
-- Products synced from Ornate
CREATE TABLE products (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id      TEXT UNIQUE NOT NULL,
  name            TEXT,
  weight          DECIMAL(10, 3),
  purity          TEXT,
  price           DECIMAL(12, 2),
  instagram_link  TEXT,
  last_synced     TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Company knowledge base (1×1 context fed to AI)
CREATE TABLE company_context (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key        TEXT,
  value      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- All AI conversations
CREATE TABLE conversations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  hyperlink   TEXT,               -- Instagram post link the question was about
  input       TEXT NOT NULL,      -- customer message
  output      TEXT,               -- AI reply
  status      TEXT DEFAULT 'answered'
              CHECK (status IN ('answered', 'human_needed')),
  platform    TEXT,               -- 'instagram_comment' | 'instagram_dm' | 'whatsapp'
  sender_id   TEXT,               -- Meta user/phone ID
  latency_ms  INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Manual sync requests from frontend (bridge polls this)
CREATE TABLE sync_requests (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'done'))
);
```

### 1B. Seed Company Context (run once with your actual data)

```sql
INSERT INTO company_context (key, value) VALUES
  ('shop_name',      'Dhera Singh Jewellers'),
  ('location',       'Ludhiana, Punjab, India'),
  ('services',       'Gold jewellery, Silver jewellery, Custom bridal sets, Ring resizing (3-5 days, starts ₹350), Polki work, Meenakari, Kaleere, Maang tikka, Bangles, Necklaces, Earrings'),
  ('working_hours',  'Monday to Saturday, 10AM–8PM IST'),
  ('whatsapp',       '+91-XXXXXXXXXX'),  -- fill in
  ('instagram',      '@dherasinghjewellers'),
  ('language',       'Punjabi and Hindi preferred, English accepted'),
  ('price_note',     'Gold prices update 4 times daily at 12 noon, 2PM, 4PM, 6PM IST. Always quote live price.'),
  ('greeting',       'Always greet with Sat Shri Akal Ji'),
  ('escalation_msg', 'This query has been shared with our team. We will personally get back to you within 30 minutes, Ji. Waheguru Ji.');
```

### 1C. Get Your Supabase Keys

Go to: Supabase → Project Settings → API

Copy these:
```
Project URL:        https://XXXXXXXXXXXX.supabase.co
anon/public key:    eyJxxxxxxxx... (for frontend if needed)
service_role key:   eyJxxxxxxxx... (for backend — keep SECRET)
```

---

## Phase 2 — Backend (Express) (25 min)

### 2A. Scaffold the project

```bash
mkdir dhera-singh-ai && cd dhera-singh-ai
mkdir -p backend/src/{routes,services,db}
mkdir -p frontend ornate-bridge
```

### 2B. Backend `package.json`

```bash
cd backend && npm init -y
npm install express cors dotenv @supabase/supabase-js @anthropic-ai/sdk axios
```

### 2C. `backend/.env`

```env
PORT=3001
SUPABASE_URL=https://XXXXXXXXXXXX.supabase.co
SUPABASE_SERVICE_KEY=eyJxxxxxxxxxxxxxxxxxxxxxxxx

ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

META_VERIFY_TOKEN=dhera_singh_webhook_2024    # you choose this string
META_IG_ACCESS_TOKEN=                          # from Meta App dashboard (Step 5)
META_WA_ACCESS_TOKEN=                          # from Meta App dashboard (Step 5)
META_IG_PAGE_ID=                               # Instagram Business Account ID
```

### 2D. `backend/src/db/supabase.js`

```js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = { supabase };
```

### 2E. `backend/src/services/ai-agent.js`

```js
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
```

### 2F. `backend/src/services/instagram.js`

```js
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
```

### 2G. `backend/src/services/whatsapp.js`

```js
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
```

### 2H. `backend/src/routes/webhook.js`

```js
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
```

### 2I. `backend/src/routes/dashboard.js`

```js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');

router.get('/stats', async (req, res) => {
  try {
    const [answeredRes, humanRes, latencyRes, volumeRes] = await Promise.all([
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'answered'),
      supabase.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'human_needed'),
      supabase.from('conversations').select('latency_ms').not('latency_ms', 'is', null).order('created_at', { ascending: false }).limit(100),
      supabase.from('conversations').select('created_at').gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
    ]);

    // Average latency
    const lats = (latencyRes.data || []).map(r => r.latency_ms);
    const avgLatency = lats.length ? (lats.reduce((a, b) => a + b, 0) / lats.length / 1000).toFixed(1) : '0.0';

    // Volume by day of week
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const counts = Array(7).fill(0);
    (volumeRes.data || []).forEach(r => { counts[new Date(r.created_at).getDay()]++; });
    // Rotate Mon→Sun
    const volumeData = [1,2,3,4,5,6,0].map(i => ({ day: dayNames[i], queries: counts[i] }));

    // Latency timeline (last 8 records, chronological)
    const latencyData = lats.slice(0, 8).reverse().map((ms, i) => ({
      time: i === 7 ? 'Now' : `T-${7 - i}`,
      latency: parseFloat((ms / 1000).toFixed(2))
    }));

    res.json({
      aiAnswered: answeredRes.count || 0,
      humanPending: humanRes.count || 0,
      avgLatency: `${avgLatency}s`,
      volumeData,
      latencyData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

### 2J. `backend/src/routes/automation.js`

```js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');

// Add context (keyword + explanation → company_context table)
router.post('/context', async (req, res) => {
  try {
    const { keyword, explanation } = req.body;
    const rows = [];
    if (keyword) rows.push({ key: 'keyword', value: keyword });
    if (explanation) rows.push({ key: 'context_note', value: explanation });
    if (rows.length) await supabase.from('company_context').insert(rows);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Link a product (Instagram link + Product ID)
router.post('/product', async (req, res) => {
  try {
    const { instagramLink, productId } = req.body;
    if (!instagramLink || !productId) {
      return res.status(400).json({ error: 'Both Instagram link and Product ID are required' });
    }

    // If product already synced from Ornate, just update the link
    const { data: existing } = await supabase.from('products').select('id').eq('product_id', productId).single();

    if (existing) {
      await supabase.from('products').update({ instagram_link: instagramLink }).eq('product_id', productId);
      return res.json({ success: true, message: 'Instagram link updated for existing product' });
    }

    // Product not yet synced — insert placeholder (Ornate bridge will fill details on next sync)
    await supabase.from('products').insert({
      product_id: productId,
      instagram_link: instagramLink,
      name: 'Pending Ornate Sync…',
      price: 0,
      weight: 0,
      purity: '—'
    });
    res.json({ success: true, message: 'Product queued. Details will auto-fill at next Ornate sync.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual sync trigger (bridge polls this)
router.post('/sync', async (req, res) => {
  try {
    await supabase.from('sync_requests').insert({ requested_at: new Date().toISOString(), status: 'pending' });
    res.json({ success: true, message: 'Sync requested. Bridge will pick up within 2 minutes.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

### 2K. `backend/src/server.js`

```js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/automation', require('./routes/automation'));
app.use('/api/dashboard', require('./routes/dashboard'));

// Serve React build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

### 2L. Run backend locally

```bash
# From dhera-singh-ai/backend
node src/server.js
# Should print: Server running on port 3001
```

---

## Phase 3 — Frontend (30 min)

### 3A. Scaffold

```bash
cd ../frontend
npm create vite@latest . -- --template react-ts
npm install
npm install lucide-react recharts
```

### 3B. `frontend/vite.config.ts`

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001'  // Proxy API calls to Express in dev
    }
  }
})
```

### 3C. `frontend/src/App.tsx` — Full File (replace entire content)

```tsx
import React, { useState, useEffect } from 'react';
import {
  Sparkles, User, Clock, ArrowRight, MessageSquare, Send,
  Image as ImageIcon, BarChart3, TrendingUp, Bot, Activity,
  Database, Link as LinkIcon, CheckCircle2, AlertCircle,
  RefreshCw, Loader2
} from 'lucide-react';
import {
  BarChart, Bar, Cell, ResponsiveContainer, Tooltip,
  XAxis, YAxis, CartesianGrid, AreaChart, Area
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────
interface DashboardStats {
  aiAnswered: number;
  humanPending: number;
  avgLatency: string;
  volumeData: { day: string; queries: number }[];
  latencyData: { time: string; latency: number }[];
}

interface Conversation {
  id: string;
  hyperlink: string | null;
  input: string;
  output: string;
  status: 'answered' | 'human_needed';
  platform: string;
  created_at: string;
  latency_ms: number;
}

// ─── App Root ─────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const tabs = [
    { id: 'Dashboard', label: 'Dashboard', disabled: false },
    { id: 'Automation', label: 'Automation', disabled: false },
    { id: 'Tips', label: 'Tips', disabled: true },
  ];

  return (
    <div className="min-h-screen bg-[#FCFDFD] text-[#2A2A2A] font-sans relative overflow-hidden selection:bg-[#D4AF37]/20 selection:text-[#967520]">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#EADDCD]/30 blur-[120px] pointer-events-none" />
      <div className="absolute top-[40%] right-[-10%] w-[40%] h-[50%] rounded-full bg-[#D4AF37]/5 blur-[100px] pointer-events-none" />

      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-2xl border-b border-[#EADDCD]/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="relative flex items-center justify-center w-12 h-12 rounded-full border border-[#D4AF37]/30 bg-gradient-to-br from-white to-[#FDFBF7] shadow-[0_4px_20px_rgba(212,175,55,0.15)]">
              <Sparkles className="text-[#CFA052] w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="flex flex-col">
              <h1 className="text-2xl font-serif text-[#1A1A1A] tracking-wide">Dhera Singh</h1>
              <span className="text-[0.65rem] uppercase tracking-[0.3em] text-[#CFA052] font-semibold mt-0.5">Jewellers</span>
            </div>
          </div>

          <nav className="flex items-center bg-[#F8F7F5] p-1.5 rounded-full border border-[#EADDCD]/60 shadow-inner">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
                title={tab.disabled ? 'Coming in V2' : undefined}
                className={`relative px-8 py-2.5 text-xs uppercase tracking-[0.15em] transition-all duration-500 rounded-full ${
                  activeTab === tab.id
                    ? 'text-white font-medium bg-[#2A2A2A] shadow-[0_4px_15px_rgba(0,0,0,0.1)]'
                    : tab.disabled
                    ? 'text-[#C0C0C0] cursor-not-allowed opacity-50'
                    : 'text-[#8A8A8A] hover:text-[#2A2A2A] hover:bg-white/50'
                }`}
              >
                {tab.label}
                {tab.disabled && (
                  <span className="ml-1 text-[7px] align-super tracking-wider opacity-70">SOON</span>
                )}
              </button>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3 px-5 py-2 rounded-full border border-[#D4AF37]/30 bg-white shadow-sm">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#CFA052] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#CFA052]" />
            </div>
            <span className="text-xs uppercase tracking-[0.15em] text-[#8A8A8A] font-medium">Agent Active</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12 pb-24 relative z-10">
        {activeTab === 'Dashboard' && <DashboardTab />}
        {activeTab === 'Automation' && <AutomationTab />}
        {activeTab === 'Tips' && <TipsTab />}
      </main>
    </div>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────
function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats>({
    aiAnswered: 0, humanPending: 0, avgLatency: '—',
    volumeData: [], latencyData: []
  });
  const [activity, setActivity] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [sRes, aRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/dashboard/activity')
      ]);
      setStats(await sRes.json());
      setActivity(await aRes.json());
    } catch (e) { console.error('Dashboard fetch error:', e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 30000);
    return () => clearInterval(iv);
  }, []);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white p-3 border border-[#EADDCD] shadow-[0_4px_20px_rgba(0,0,0,0.08)] rounded-xl">
        <p className="text-[10px] text-[#8A8A8A] uppercase tracking-wider font-semibold mb-1">{label}</p>
        <p className="text-sm text-[#CFA052] font-bold">
          {payload[0].value} {payload[0].dataKey === 'latency' ? 'sec' : 'queries'}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-12">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="AI Answered Questions"
          value={loading ? '…' : stats.aiAnswered.toLocaleString()}
          icon={<Bot size={22} className="text-[#CFA052]" strokeWidth={1.5} />}
        />
        <StatCard
          title="Pending Human Interactions"
          value={loading ? '…' : String(stats.humanPending).padStart(2, '0')}
          icon={<User size={22} className="text-[#D9534F]" strokeWidth={1.5} />}
          alert={stats.humanPending > 0}
        />
        <StatCard
          title="Average Answering Time"
          value={loading ? '…' : stats.avgLatency}
          icon={<Clock size={22} className="text-[#CFA052]" strokeWidth={1.5} />}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
        <div className="lg:col-span-2 bg-gradient-to-b from-white to-[#FDFBF7] rounded-3xl p-8 border border-[#EADDCD]/60 shadow-sm flex flex-col">
          <h3 className="text-sm uppercase tracking-[0.2em] text-[#8A8A8A] font-medium flex items-center gap-3 mb-2">
            <BarChart3 size={16} className="text-[#CFA052]" /> Query Volume
          </h3>
          <div className="h-64 mt-6 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.volumeData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0EBE1" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F8F7F5' }} />
                <Bar dataKey="queries" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {stats.volumeData.map((_, i) => (
                    <Cell key={i} fill={i === 5 ? '#D4AF37' : '#EADDCD'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-3 bg-gradient-to-b from-white to-[#FDFBF7] rounded-3xl p-8 border border-[#EADDCD]/60 shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm uppercase tracking-[0.2em] text-[#8A8A8A] font-medium flex items-center gap-3">
              <Activity size={16} className="text-[#CFA052]" /> Response Latency
            </h3>
            <span className="text-[10px] uppercase tracking-widest text-[#2A2A2A] border border-[#EADDCD] bg-white px-4 py-1.5 rounded-full font-medium shadow-sm">Real-time</span>
          </div>
          <div className="h-64 mt-6 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.latencyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorLatency" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#CFA052" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#CFA052" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0EBE1" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#8A8A8A' }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="latency" stroke="#CFA052" strokeWidth={3}
                  fillOpacity={1} fill="url(#colorLatency)"
                  activeDot={{ r: 6, fill: '#CFA052', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-3xl border border-[#EADDCD]/60 shadow-[0_15px_50px_rgba(0,0,0,0.02)] p-8 md:p-12 relative overflow-hidden">
        <div className="absolute -right-10 -top-10 text-[150px] font-serif text-[#F8F7F5] font-bold pointer-events-none select-none">Log</div>
        <h3 className="text-2xl font-serif text-[#1A1A1A] flex items-center gap-4 mb-12 relative z-10">
          <span className="w-10 h-[1px] bg-[#CFA052]" />
          Live Activity Feed
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-[#CFA052]">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : activity.length === 0 ? (
          <p className="text-[#8A8A8A] text-center py-20 font-light">No conversations yet. Activity will appear here when customers interact.</p>
        ) : (
          <div className="pl-6 md:pl-10 border-l-2 border-[#EADDCD]/50 space-y-14 relative z-10">
            {activity.map((log) => {
              const timeAgo = getTimeAgo(log.created_at);
              const latencySec = log.latency_ms ? `${(log.latency_ms / 1000).toFixed(1)}s` : '—';
              const isAnswered = log.status === 'answered';
              return (
                <div key={log.id} className="relative">
                  <div className="absolute -left-[31px] md:-left-[47px] top-1 w-4 h-4 rounded-full bg-white border-[3px] border-[#CFA052] shadow-[0_0_12px_rgba(212,175,55,0.3)]" />
                  <div className="flex flex-col gap-5">

                    {/* Customer Query */}
                    <div className="bg-[#FBFBFA] border border-[#EADDCD] p-6 md:p-7 rounded-2xl rounded-tl-none shadow-sm hover:border-[#CFA052]/40 transition-colors">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-[#2A2A2A] flex items-center justify-center shadow-md">
                            <User size={18} className="text-white" />
                          </div>
                          <div>
                            <span className="block text-xs font-bold text-[#2A2A2A] uppercase tracking-wider">Customer</span>
                            <span className="block text-[11px] text-[#8A8A8A] mt-0.5">
                              {timeAgo} · <span className="capitalize">{(log.platform || '').replace('_', ' ')}</span>
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-[#8A8A8A] bg-white border border-[#EADDCD] px-3 py-1.5 rounded-full font-semibold shadow-sm">Query</span>
                      </div>
                      {/* Hyperlinked query text */}
                      {log.hyperlink ? (
                        <a href={log.hyperlink} target="_blank" rel="noreferrer"
                          className="text-[#1A1A1A] font-serif text-lg md:text-xl leading-relaxed hover:text-[#CFA052] transition-colors underline underline-offset-4 decoration-[#EADDCD]">
                          "{log.input}"
                        </a>
                      ) : (
                        <p className="text-[#1A1A1A] font-serif text-lg md:text-xl leading-relaxed">"{log.input}"</p>
                      )}
                    </div>

                    {/* AI Response — Answered */}
                    {isAnswered ? (
                      <div className="bg-gradient-to-br from-white to-[#FDFBF7] border border-[#CFA052]/30 p-6 md:p-7 rounded-2xl rounded-bl-none shadow-[0_8px_30px_rgba(212,175,55,0.06)] ml-4 md:ml-12 hover:border-[#CFA052]/60 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#D4AF37] to-[#CFA052] flex items-center justify-center shadow-md">
                              <Bot size={18} className="text-white" />
                            </div>
                            <div>
                              <span className="block text-xs font-bold text-[#CFA052] uppercase tracking-wider">AI Agent</span>
                              <span className="block text-[11px] text-[#8A8A8A] mt-0.5">{timeAgo} · <span className="text-[#CFA052] font-medium">{latencySec}</span></span>
                            </div>
                          </div>
                          <span className="text-[10px] uppercase tracking-widest text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/20 px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5">
                            <CheckCircle2 size={12} strokeWidth={2.5} /> Answered
                          </span>
                        </div>
                        <p className="text-[#4A4A4A] font-light text-base md:text-lg leading-relaxed">{log.output}</p>
                      </div>
                    ) : (
                      /* Human Intervention Needed */
                      <div className="bg-gradient-to-br from-white to-red-50/40 border border-red-200 p-6 md:p-7 rounded-2xl rounded-bl-none shadow-[0_8px_30px_rgba(217,83,79,0.06)] ml-4 md:ml-12 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center border border-red-200 shadow-sm">
                              <AlertCircle size={18} className="text-[#D9534F]" />
                            </div>
                            <div>
                              <span className="block text-xs font-bold text-[#D9534F] uppercase tracking-wider">Requires Human Review</span>
                              <span className="block text-[11px] text-[#8A8A8A] mt-0.5">{timeAgo} · Escalated</span>
                            </div>
                          </div>
                          <span className="text-[10px] uppercase tracking-widest text-[#D9534F] bg-red-50 border border-red-200 px-3 py-1.5 rounded-full font-bold flex items-center gap-1.5 animate-pulse">
                            <AlertCircle size={12} strokeWidth={2.5} /> Pending
                          </span>
                        </div>
                        <p className="text-[#8A8A8A] font-light text-sm italic border-l-2 border-red-200 pl-4">
                          This query was beyond the AI's context. A customer reply was sent and the conversation has been flagged for your personal attention, Ji.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Automation Tab ───────────────────────────────────────────
function AutomationTab() {
  const [keyword, setKeyword] = useState('');
  const [explanation, setExplanation] = useState('');
  const [instagramLink, setInstagramLink] = useState('');
  const [productId, setProductId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setMessage(null);
    try {
      const ops: Promise<Response>[] = [];

      if (keyword.trim() || explanation.trim()) {
        ops.push(fetch('/api/automation/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, explanation })
        }));
      }

      if (instagramLink.trim() && productId.trim()) {
        ops.push(fetch('/api/automation/product', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instagramLink, productId })
        }));
      }

      if (!ops.length) {
        setMessage({ type: 'error', text: 'Please fill at least one set of fields.' });
        return;
      }

      await Promise.all(ops);
      setMessage({ type: 'success', text: 'Knowledge base updated successfully, Ji! ✨' });
      setKeyword(''); setExplanation(''); setInstagramLink(''); setProductId('');
    } catch {
      setMessage({ type: 'error', text: 'Something went wrong. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-4">
      <div className="mb-20 text-center relative">
        <div className="inline-flex items-center justify-center gap-3 mb-6">
          <span className="h-[1px] w-12 bg-[#D4AF37]/50" />
          <span className="text-[#CFA052] font-semibold text-xs uppercase tracking-[0.3em]">Knowledge Base</span>
          <span className="h-[1px] w-12 bg-[#D4AF37]/50" />
        </div>
        <h2 className="text-4xl md:text-5xl font-serif text-[#1A1A1A] tracking-wide mb-4">Automated Agent Training</h2>
        <p className="text-[#8A8A8A] font-light text-sm max-w-xl mx-auto leading-relaxed">
          Seamlessly integrate new collections, keywords, and promotional content into your AI concierge's active memory bank.
        </p>
      </div>

      <div className="relative">
        <div className="absolute left-[24px] md:left-1/2 top-0 bottom-0 w-[1px] bg-gradient-to-b from-[#EADDCD] via-[#CFA052] to-transparent md:-translate-x-1/2" />
        <div className="space-y-16">

          {/* Step 01: Keywords */}
          <div className="relative flex flex-col md:flex-row items-center md:justify-between group">
            <div className="hidden md:block md:w-[45%] text-right pr-12 relative">
              <span className="absolute -right-8 top-1/2 -translate-y-1/2 text-[120px] font-serif text-[#F8F7F5] font-bold z-0 pointer-events-none select-none">01</span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] relative z-10 mb-2">Add Context</h3>
              <p className="text-sm text-[#8A8A8A] tracking-wide">Define semantic triggers</p>
            </div>
            <div className="absolute left-0 md:left-1/2 w-12 h-12 rounded-full bg-white border border-[#CFA052] shadow-[0_0_20px_rgba(212,175,55,0.2)] md:-translate-x-1/2 flex items-center justify-center z-10">
              <Database className="text-[#CFA052] w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="w-full pl-20 md:pl-0 md:w-[45%]">
              <div className="bg-white p-6 rounded-2xl border border-[#EADDCD] shadow-[0_10px_40px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.08)] transition-all duration-500 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-transparent to-[#CFA052] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <label className="block text-xs uppercase tracking-[0.2em] text-[#CFA052] mb-3 font-semibold md:hidden">01. Context</label>
                <div className="flex items-center gap-4">
                  <span className="text-[#8A8A8A] font-light italic shrink-0">Keywords:</span>
                  <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
                    placeholder="e.g. Polki, Choker, Bridal…"
                    className="w-full bg-transparent border-b border-[#EADDCD] p-2 text-[#2A2A2A] focus:outline-none focus:border-[#CFA052] placeholder:text-[#D1D1D1] font-light transition-colors" />
                  <ArrowRight className="text-[#D1D1D1] group-hover:text-[#CFA052] transition-colors shrink-0" size={20} strokeWidth={1.5} />
                </div>
              </div>
            </div>
          </div>

          {/* Step 02: Explanation */}
          <div className="relative flex flex-col md:flex-row-reverse items-center md:justify-between group">
            <div className="hidden md:block md:w-[45%] text-left pl-12 relative">
              <span className="absolute -left-8 top-1/2 -translate-y-1/2 text-[120px] font-serif text-[#F8F7F5] font-bold z-0 pointer-events-none select-none">02</span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] relative z-10 mb-2">Explain Addition</h3>
              <p className="text-sm text-[#8A8A8A] tracking-wide">Provide AI reasoning</p>
            </div>
            <div className="absolute left-0 md:left-1/2 w-12 h-12 rounded-full bg-white border border-[#CFA052] shadow-[0_0_20px_rgba(212,175,55,0.2)] md:-translate-x-1/2 flex items-center justify-center z-10">
              <MessageSquare className="text-[#CFA052] w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="w-full pl-20 md:pl-0 md:w-[45%] text-right">
              <div className="bg-white p-6 rounded-2xl border border-[#EADDCD] shadow-[0_10px_40px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.08)] transition-all duration-500 relative overflow-hidden text-left">
                <div className="absolute top-0 right-0 w-1 h-full bg-gradient-to-b from-transparent to-[#CFA052] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <label className="block text-xs uppercase tracking-[0.2em] text-[#CFA052] mb-3 font-semibold md:hidden">02. Explain Addition</label>
                <div className="relative">
                  <textarea value={explanation} onChange={e => setExplanation(e.target.value)}
                    placeholder="Type your explanation here to train the agent…"
                    rows={3}
                    className="w-full bg-[#FBFBFA] border border-[#EADDCD] rounded-xl p-4 text-[#2A2A2A] focus:outline-none focus:border-[#CFA052] focus:ring-1 focus:ring-[#CFA052] placeholder:text-[#D1D1D1] font-light resize-none transition-all shadow-inner" />
                  <div className="absolute bottom-4 right-4 bg-white rounded-full p-2 shadow-sm border border-[#EADDCD]">
                    <ArrowRight className="text-[#D1D1D1] group-hover:text-[#CFA052] transition-colors" size={16} strokeWidth={2} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 03: Product Sync */}
          <div className="relative flex flex-col md:flex-row items-center md:justify-between group">
            <div className="hidden md:block md:w-[45%] text-right pr-12 relative">
              <span className="absolute -right-8 top-1/2 -translate-y-1/2 text-[120px] font-serif text-[#F8F7F5] font-bold z-0 pointer-events-none select-none">03</span>
              <h3 className="text-2xl font-serif text-[#1A1A1A] relative z-10 mb-2">Product Sync</h3>
              <p className="text-sm text-[#8A8A8A] tracking-wide">Link inventory to media</p>
            </div>
            <div className="absolute left-0 md:left-1/2 w-12 h-12 rounded-full bg-[#2A2A2A] border border-[#2A2A2A] shadow-[0_0_20px_rgba(0,0,0,0.2)] md:-translate-x-1/2 flex items-center justify-center z-10">
              <LinkIcon className="text-white w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="w-full pl-20 md:pl-0 md:w-[45%]">
              <div className="bg-white p-6 rounded-2xl border border-[#EADDCD] shadow-[0_10px_40px_rgba(0,0,0,0.03)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.08)] transition-all duration-500 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-transparent to-[#2A2A2A] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <label className="block text-xs uppercase tracking-[0.2em] text-[#CFA052] mb-3 font-semibold md:hidden">03. Product / Reel Details</label>
                <div className="flex flex-col gap-5">
                  <div className="flex items-center gap-4">
                    <input type="text" value={instagramLink} onChange={e => setInstagramLink(e.target.value)}
                      placeholder="Instagram Post Link (e.g. https://www.instagram.com/p/…)"
                      className="flex-1 bg-transparent border-b border-[#EADDCD] p-2 text-[#2A2A2A] focus:outline-none focus:border-[#2A2A2A] placeholder:text-[#D1D1D1] font-light transition-colors" />
                    <ArrowRight className="text-[#D1D1D1] group-hover:text-[#2A2A2A] transition-colors shrink-0" size={18} strokeWidth={1.5} />
                  </div>
                  <div className="flex items-center gap-4">
                    <input type="text" value={productId} onChange={e => setProductId(e.target.value)}
                      placeholder="Product ID (e.g. SKU-1049)"
                      className="w-1/2 bg-transparent border-b border-[#EADDCD] p-2 text-[#2A2A2A] focus:outline-none focus:border-[#2A2A2A] placeholder:text-[#D1D1D1] font-light transition-colors" />
                    <ArrowRight className="text-[#D1D1D1] group-hover:text-[#2A2A2A] transition-colors shrink-0" size={18} strokeWidth={1.5} />
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Submit */}
      <div className="mt-20 flex flex-col items-center gap-4">
        {message && (
          <div className={`px-6 py-3 rounded-full text-sm font-medium ${
            message.type === 'success'
              ? 'bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/20'
              : 'bg-red-50 text-red-500 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}
        <button onClick={handleSubmit} disabled={submitting}
          className="group relative px-10 py-4 bg-[#2A2A2A] text-white rounded-full overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.15)] hover:shadow-[0_10px_40px_rgba(212,175,55,0.3)] transition-all duration-500 disabled:opacity-60">
          <div className="absolute inset-0 bg-gradient-to-r from-[#CFA052] to-[#D4AF37] opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <span className="relative z-10 flex items-center gap-3 text-sm uppercase tracking-[0.2em] font-medium">
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Updating…</>
              : <><Sparkles size={16} /> Update Knowledge Base</>
            }
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Tips Tab (Coming Soon) ────────────────────────────────────
function TipsTab() {
  return (
    <div className="max-w-5xl mx-auto h-[80vh] flex flex-col items-center justify-center relative z-10">
      <div className="text-center space-y-6">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[#F8F7F5] border border-[#EADDCD] shadow-inner">
          <Sparkles className="text-[#CFA052] w-8 h-8" strokeWidth={1.5} />
        </div>
        <h2 className="text-4xl font-serif text-[#1A1A1A] tracking-wide">Marketing Concierge</h2>
        <p className="text-[#8A8A8A] font-light text-sm max-w-sm mx-auto leading-relaxed">
          AI-powered caption writing, reel scripting, and hashtag strategy is coming in <span className="text-[#CFA052] font-medium">Version 2</span>.
        </p>
        <div className="inline-flex items-center gap-3 px-6 py-3 rounded-full border border-[#D4AF37]/30 bg-white shadow-sm">
          <span className="text-xs uppercase tracking-[0.3em] text-[#CFA052] font-semibold">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────
function StatCard({ title, value, icon, alert = false }: { title: string; value: string | number; icon: React.ReactNode; alert?: boolean }) {
  return (
    <div className={`relative p-6 md:p-8 rounded-3xl border shadow-sm group overflow-hidden transition-all duration-500 hover:-translate-y-1 ${
      alert
        ? 'bg-gradient-to-br from-white to-red-50/40 border-red-100 hover:border-red-200 hover:shadow-[0_10px_30px_rgba(217,83,79,0.1)]'
        : 'bg-gradient-to-br from-white to-[#F8F7F5] border-[#EADDCD]/60 hover:border-[#CFA052]/40 hover:shadow-[0_10px_30px_rgba(212,175,55,0.08)]'
    }`}>
      <div className="flex justify-between items-start mb-8 relative z-10">
        <div className={`p-3 rounded-2xl border shadow-sm ${alert ? 'bg-red-50 border-red-100' : 'bg-white border-[#EADDCD]'}`}>
          {icon}
        </div>
        {alert && (
          <span className="text-[9px] uppercase tracking-widest text-red-600 bg-red-50 border border-red-100 px-3 py-1.5 rounded-full font-bold animate-pulse">
            Attention Needed
          </span>
        )}
      </div>
      <div className="relative z-10">
        <div className="flex items-end gap-3 mb-1">
          <span className="text-4xl md:text-5xl font-serif text-[#1A1A1A]">{value}</span>
        </div>
        <h4 className="text-[#8A8A8A] font-medium text-[10px] md:text-xs uppercase tracking-[0.2em] mt-3">{title}</h4>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function getTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

### 3D. Run frontend locally

```bash
# From dhera-singh-ai/frontend
npm run dev
# Open http://localhost:5173 — API calls proxy to port 3001
```

---

## Phase 4 — Ornate Bridge Script (do tomorrow when DB is accessible)

### 4A. Discovery (run these on the Ornate PC, inside DB client)

First, figure out what DB type Ornate uses. Open Ornate's config folder (usually `C:\Program Files\Ornate\` or `C:\Ornate\`) and look for:
- `config.ini` / `app.config` / `connection.ini` → look for `server=`, `port=`, `database=`
- Port **3306** = MySQL/MariaDB
- Port **1433** = Microsoft SQL Server
- Port **5432** = PostgreSQL (rare)

Once connected, run:
```sql
-- MySQL/MariaDB:
SHOW TABLES;
-- Then on likely tables:
DESCRIBE stock_master;     -- common name
DESCRIBE product_master;   -- try these
DESCRIBE tbl_product;

-- MSSQL:
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE';
-- Then:
EXEC sp_columns 'stock_master';
```

Look for columns containing: **product code, name, weight, purity, rate/price, active flag**

### 4B. Create the View in Ornate DB

**MySQL version** (adjust table/column names from your discovery above):
```sql
CREATE OR REPLACE VIEW ai_user_view AS
SELECT
  ProductCode   AS product_id,
  ProductName   AS name,
  GrossWeight   AS weight,
  Purity        AS purity,
  Rate          AS price
FROM stock_master          -- ← replace with your actual table name
WHERE IsActive = 1;        -- ← replace with your active filter column

-- Verify:
SELECT * FROM ai_user_view LIMIT 10;
```

**MSSQL version:**
```sql
CREATE OR ALTER VIEW dbo.ai_user_view AS
SELECT
  ProductCode AS product_id,
  ProductName AS name,
  GrossWeight AS weight,
  Purity      AS purity,
  Rate        AS price
FROM dbo.stock_master
WHERE IsActive = 1;
GO
```

### 4C. `ornate-bridge/package.json`

```json
{
  "name": "ornate-bridge",
  "version": "1.0.0",
  "scripts": { "start": "node sync.js" },
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "dotenv": "^16.0.0",
    "node-cron": "^3.0.0",
    "mssql": "^10.0.0"
  }
}
```

> If Ornate is MySQL, run: `npm install mysql2` instead of `mssql`

### 4D. `ornate-bridge/.env`

```env
SUPABASE_URL=https://XXXXXXXXXXXX.supabase.co
SUPABASE_SERVICE_KEY=eyJxxxxxxxx

# MSSQL:
ORNATE_HOST=localhost
ORNATE_DB=OrnateDB          # actual DB name from connection string
ORNATE_USER=sa              # your DB user
ORNATE_PASS=yourpassword

# MySQL (if applicable):
ORNATE_PORT=3306
```

### 4E. `ornate-bridge/sync.js`

```js
require('dotenv').config();
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Choose your DB driver: uncomment ONE block ─────────────

// OPTION A: MSSQL (SQL Server)
const sql = require('mssql');
const dbConfig = {
  server: process.env.ORNATE_HOST,
  database: process.env.ORNATE_DB,
  user: process.env.ORNATE_USER,
  password: process.env.ORNATE_PASS,
  options: { trustServerCertificate: true, encrypt: false }
};

async function queryOrnate() {
  const pool = await sql.connect(dbConfig);
  const result = await pool.request().query('SELECT * FROM ai_user_view');
  await sql.close();
  return result.recordset;
}

// OPTION B: MySQL — comment out option A and uncomment this
// const mysql = require('mysql2/promise');
// async function queryOrnate() {
//   const conn = await mysql.createConnection({
//     host: process.env.ORNATE_HOST,
//     port: parseInt(process.env.ORNATE_PORT || '3306'),
//     user: process.env.ORNATE_USER,
//     password: process.env.ORNATE_PASS,
//     database: process.env.ORNATE_DB
//   });
//   const [rows] = await conn.execute('SELECT * FROM ai_user_view');
//   await conn.end();
//   return rows;
// }

// ──────────────────────────────────────────────────────────

async function syncProducts() {
  console.log('[Ornate Bridge] Sync started:', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
  try {
    const products = await queryOrnate();
    console.log(`[Ornate Bridge] Fetched ${products.length} products`);

    for (const p of products) {
      const { error } = await supabase.from('products').upsert({
        product_id: String(p.product_id || p.ProductCode || ''),
        name: p.name || p.ProductName || '',
        weight: parseFloat(p.weight || p.GrossWeight || 0),
        purity: String(p.purity || p.Purity || ''),
        price: parseFloat(p.price || p.Rate || 0),
        last_synced: new Date().toISOString()
      }, { onConflict: 'product_id' });

      if (error) console.error('[Ornate Bridge] Upsert error:', error.message, 'for product:', p.product_id);
    }

    console.log('[Ornate Bridge] Sync complete.');

    // Mark any pending sync requests as done
    await supabase.from('sync_requests').update({ status: 'done' }).eq('status', 'pending');
  } catch (err) {
    console.error('[Ornate Bridge] Sync failed:', err.message);
  }
}

// Schedule: 12:00, 14:00, 16:00, 18:00 IST
cron.schedule('0 12,14,16,18 * * *', syncProducts, { timezone: 'Asia/Kolkata' });

// Poll every 2 minutes for manual sync requests from the frontend
cron.schedule('*/2 * * * *', async () => {
  const { data } = await supabase.from('sync_requests').select('id').eq('status', 'pending').limit(1);
  if (data?.length) {
    console.log('[Ornate Bridge] Manual sync requested from frontend');
    await syncProducts();
  }
});

// Run once on startup
syncProducts();
console.log('[Ornate Bridge] Running. Scheduled syncs at 12:00, 14:00, 16:00, 18:00 IST');
```

### 4F. How to keep the bridge running on the shop PC

**Option 1 — PM2 (recommended, free):**
```bash
npm install -g pm2
cd ornate-bridge
pm2 start sync.js --name "ornate-bridge"
pm2 save
pm2 startup    # follow the command it prints to auto-start on boot
```

**Option 2 — Windows Task Scheduler:**
Create a basic task → Trigger: At startup → Action: `node C:\ornate-bridge\sync.js`

---

## Phase 5 — Meta API Setup (20 min)

### 5A. Instagram Business API

1. Go to **https://developers.facebook.com/apps** → Create App → **Business** type
2. Add product: **Instagram**
3. In Instagram settings → Connect your Instagram Business Account
4. Generate a **System User Access Token** with these permissions:
   - `instagram_basic`
   - `instagram_manage_comments`
   - `instagram_manage_messages`
   - `pages_messaging`
5. Set token expiry to **never** (use System User token, not Page token)

### 5B. WhatsApp Business API

1. In the same Meta App → Add product: **WhatsApp**
2. Go to WhatsApp → Getting Started
3. Note your **Test Phone Number** and **Phone Number ID**
4. For production: submit for review (takes 1–3 days)

### 5C. Configure Webhooks (do after deploy in Phase 6)

In your Meta App dashboard:

**Instagram → Webhooks:**
```
Callback URL:    https://your-render-app.onrender.com/api/webhook
Verify Token:    dhera_singh_webhook_2024     ← must match .env
Subscribe to:    comments, messages, mentions
```

**WhatsApp → Configuration → Webhooks:**
```
Callback URL:    https://your-render-app.onrender.com/api/webhook
Verify Token:    dhera_singh_webhook_2024
Subscribe to:    messages
```

### 5D. Required Permissions for App Review

When you go live, submit these permissions for approval:
- `instagram_manage_comments` — to reply to post comments
- `instagram_manage_messages` — to send DMs
- `whatsapp_business_messaging` — to send WhatsApp replies

While pending approval, use the sandbox with your own account for testing.

---

## Phase 6 — Deploy to Render (10 min)

### 6A. Push to GitHub

```bash
cd dhera-singh-ai

# Create root package.json for mono-repo build
cat > package.json << 'EOF'
{
  "name": "dhera-singh-ai",
  "scripts": {
    "build": "cd frontend && npm install && npm run build",
    "start": "cd backend && node src/server.js"
  }
}
EOF

git init
git add .
git commit -m "Initial commit — Dhera Singh AI v1"
git remote add origin https://github.com/YOUR_USERNAME/dhera-singh-ai.git
git push -u origin main
```

### 6B. Create Render Web Service

1. Go to https://render.com → New → Web Service
2. Connect your GitHub repo
3. Settings:
   - **Environment:** Node
   - **Build Command:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - **Start Command:** `cd backend && NODE_ENV=production node src/server.js`
   - **Instance Type:** Free (or Starter for $7/mo — better reliability for webhooks)

### 6C. Add Environment Variables in Render

In Render → your service → Environment → Add all from `backend/.env`:
```
PORT                    10000
SUPABASE_URL            https://XXXX.supabase.co
SUPABASE_SERVICE_KEY    eyJxxx...
ANTHROPIC_API_KEY       sk-ant-xxx...
META_VERIFY_TOKEN       dhera_singh_webhook_2024
META_IG_ACCESS_TOKEN    (from Phase 5)
META_WA_ACCESS_TOKEN    (from Phase 5)
META_IG_PAGE_ID         (your IG Business Account ID)
NODE_ENV                production
```

4. Click **Deploy** — takes about 3 minutes.
5. Your URL: `https://dhera-singh-ai-xxxx.onrender.com`

---

## Phase 7 — Wire Everything Together (5 min)

### Final Checklist

```
[ ] Supabase tables created (Phase 1)
[ ] Backend running (port 3001 locally / Render in prod)
[ ] Frontend proxying to backend
[ ] Supabase company_context seeded with real shop info
[ ] Meta App created with Instagram + WhatsApp products
[ ] Webhook callback URL set to Render URL
[ ] Webhook verification passed (check Render logs)
[ ] Test by commenting on a post from a test IG account
[ ] Ornate bridge .env filled (do tomorrow with DB credentials)
[ ] Ornate ai_user_view created after discovering table names
[ ] Bridge running via PM2 on shop PC
```

### Quick Smoke Test

```bash
# 1. Test webhook verification:
curl "https://your-render-url.onrender.com/api/webhook?hub.mode=subscribe&hub.verify_token=dhera_singh_webhook_2024&hub.challenge=TESTCHALLENGE"
# Should return: TESTCHALLENGE

# 2. Test automation endpoint:
curl -X POST https://your-render-url.onrender.com/api/automation/context \
  -H "Content-Type: application/json" \
  -d '{"keyword":"Polki","explanation":"Polki is uncut diamond jewellery popular in Punjabi bridal sets"}'
# Should return: {"success":true}

# 3. Test dashboard:
curl https://your-render-url.onrender.com/api/dashboard/stats
# Should return JSON with zeros (no conversations yet)
```

---

## Important Notes for Tomorrow

### When you get Ornate DB type:
1. If **MySQL**: `cd ornate-bridge && npm install mysql2` and uncomment Option B in sync.js
2. If **MSSQL**: keep Option A as-is
3. Run `node sync.js` once manually on shop PC to verify data flows into Supabase
4. Check Supabase → Table Editor → products to confirm rows appeared

### Instagram link format for products:
When adding a product via the Automation tab, use the full post URL:
```
https://www.instagram.com/p/SHORTCODE_HERE/
```
The AI will match incoming comment webhooks to this URL to identify the product.

### WhatsApp Status Replies:
WhatsApp status replies come in as regular messages in the webhook — they're handled by the same `handleWhatsAppMessage` function. No extra code needed.

### Rate Limits:
- Instagram Graph API: 200 calls/hour per user
- WhatsApp Business API: 1000 conversations/24hr (free tier), unlimited on paid tier
- Claude claude-sonnet-4-6: 1000 requests/min (far above your needs)

---

## File Tree Reference

```
dhera-singh-ai/
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   ├── db/
│   │   │   └── supabase.js
│   │   ├── routes/
│   │   │   ├── webhook.js
│   │   │   ├── automation.js
│   │   │   └── dashboard.js
│   │   └── services/
│   │       ├── ai-agent.js
│   │       ├── instagram.js
│   │       └── whatsapp.js
│   ├── package.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── ornate-bridge/
│   ├── sync.js
│   ├── package.json
│   └── .env
└── package.json   (root, for Render build)
```
