const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');

// Add context (keyword + explanation -> company_context table)
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

    const { data: existing } = await supabase.from('products').select('id').eq('product_id', productId).single();

    if (existing) {
      await supabase.from('products').update({ instagram_link: instagramLink }).eq('product_id', productId);
      return res.json({ success: true, message: 'Instagram link updated for existing product' });
    }

    await supabase.from('products').insert({
      product_id: productId,
      instagram_link: instagramLink,
      name: 'Pending Ornate Sync',
      price: 0,
      weight: 0,
      purity: 'unknown'
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