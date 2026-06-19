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