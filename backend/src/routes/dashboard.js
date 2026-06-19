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