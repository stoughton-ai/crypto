/**
 * Backfill BTC daily prices from EODHD and store in Firestore.
 * Uses the EOD (end-of-day) API endpoint for historical daily data.
 * 
 * Run: npx tsx scripts/backfill_btc_prices.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : null;
  if (!sa) { console.error('No FIREBASE_SERVICE_ACCOUNT_JSON'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const EODHD_API_KEY = process.env.EODHD_API_KEY || '';

async function backfill() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  BTC DAILY PRICE BACKFILL via EODHD');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!EODHD_API_KEY) {
    console.error('❌ EODHD_API_KEY not found');
    process.exit(1);
  }

  // Fetch daily EOD data from EODHD for the competition period
  // Competition started 2026-03-04, need data from March 3 to March 15
  const fromDate = '2026-03-03';
  const toDate = '2026-03-15';

  console.log(`📡 Fetching BTC EOD daily data: ${fromDate} → ${toDate}`);
  
  // EODHD EOD endpoint: /api/eod/{SYMBOL}.CC?from=YYYY-MM-DD&to=YYYY-MM-DD
  const url = `https://eodhd.com/api/eod/BTC-USD.CC?api_token=${EODHD_API_KEY}&fmt=json&from=${fromDate}&to=${toDate}`;
  console.log(`URL: ${url.replace(EODHD_API_KEY, '***')}\n`);
  
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ EODHD API failed: ${res.status} ${res.statusText}`);
    console.error(`Body: ${body.substring(0, 500)}`);
    
    // Try intraday as fallback
    console.log('\n🔄 Trying intraday endpoint (interval=1d)...');
    const fromTs = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000);
    const toTs = Math.floor(new Date(toDate + 'T23:59:59Z').getTime() / 1000);
    const url2 = `https://eodhd.com/api/intraday/BTC-USD.CC?api_token=${EODHD_API_KEY}&fmt=json&interval=1d&from=${fromTs}&to=${toTs}`;
    const res2 = await fetch(url2, { cache: 'no-store' });
    if (res2.ok) {
      const data = await res2.json();
      console.log('Intraday response:', JSON.stringify(data).substring(0, 1000));
      if (Array.isArray(data) && data.length > 0) {
        await processCandles(data, 'intraday');
        return;
      }
    } else {
      console.error(`Intraday also failed: ${res2.status}`);
    }
    
    // Try eod with just the ticker
    console.log('\n🔄 Trying eod with different format...');
    const url3 = `https://eodhd.com/api/eod/BTC-USD.CC?api_token=${EODHD_API_KEY}&fmt=json&period=d&from=${fromDate}&to=${toDate}`;
    const res3 = await fetch(url3, { cache: 'no-store' });
    if (res3.ok) {
      const data = await res3.json();
      console.log('eod/d response:', JSON.stringify(data).substring(0, 1000));
      if (Array.isArray(data) && data.length > 0) {
        await processCandles(data, 'eod');
        return;
      }
    } else {
      const body3 = await res3.text();
      console.error(`eod/d also failed: ${res3.status} - ${body3.substring(0, 300)}`);
    }

    process.exit(1);
  }

  const candles = await res.json();
  console.log(`Raw response type: ${typeof candles}, isArray: ${Array.isArray(candles)}`);
  if (Array.isArray(candles)) {
    console.log(`Items: ${candles.length}`);
    if (candles.length > 0) console.log('Sample:', JSON.stringify(candles[0]));
  } else {
    console.log('Response:', JSON.stringify(candles).substring(0, 500));
  }
  
  if (!Array.isArray(candles) || candles.length === 0) {
    console.error('❌ No candle data returned');
    process.exit(1);
  }

  await processCandles(candles, 'eod');
}

async function processCandles(candles: any[], source: string) {
  console.log(`\n✅ Processing ${candles.length} candles from ${source}\n`);

  const btcDailyPrices: Record<string, { open: number; close: number; high: number; low: number }> = {};

  for (const candle of candles) {
    // EOD format: {date: "YYYY-MM-DD", open, high, low, close, ...}
    // Intraday format: {timestamp, datetime: "YYYY-MM-DD HH:MM:SS", open, high, low, close, ...}
    let dateStr: string;
    if (candle.date) {
      dateStr = candle.date;
    } else if (candle.datetime) {
      dateStr = candle.datetime.split(' ')[0];
    } else if (candle.timestamp) {
      dateStr = new Date(candle.timestamp * 1000).toISOString().slice(0, 10);
    } else {
      continue;
    }

    const open = parseFloat(candle.open);
    const close = parseFloat(candle.close);
    const high = parseFloat(candle.high);
    const low = parseFloat(candle.low);

    if (isNaN(open) || open <= 0) continue;

    btcDailyPrices[dateStr] = { open, close, high, low };
    console.log(`  📊 ${dateStr}: Open $${open.toFixed(2)}, Close $${close.toFixed(2)}, High $${high.toFixed(2)}, Low $${low.toFixed(2)}`);
  }

  if (Object.keys(btcDailyPrices).length === 0) {
    console.error('❌ No valid price data found');
    return;
  }

  // Store in Firestore
  const batch = db.batch();
  for (const [date, prices] of Object.entries(btcDailyPrices)) {
    const ref = db.collection('btc_daily_prices').doc(date);
    batch.set(ref, {
      date,
      ...prices,
      source: `EODHD-${source}`,
      backfilledAt: new Date().toISOString(),
    });
  }
  await batch.commit();
  console.log(`\n💾 Stored ${Object.keys(btcDailyPrices).length} daily prices in btc_daily_prices collection`);

  // Embed in arena_config
  const configSnap = await db.collection('arena_config').limit(1).get();
  if (!configSnap.empty) {
    const userId = configSnap.docs[0].id;
    await db.collection('arena_config').doc(userId).set({
      btcDailyPrices,
    }, { merge: true });
    console.log(`💾 Embedded btcDailyPrices in arena_config for ${userId}`);
  }

  // Show the key dates for weekly report
  console.log('\n\n═══ WEEKLY REPORT REFERENCE PRICES ═══');
  const weekStart = '2026-03-08';
  const weekEnd = '2026-03-15';
  const startPrice = btcDailyPrices[weekStart];
  const endPrice = btcDailyPrices[weekEnd] || btcDailyPrices[Object.keys(btcDailyPrices).sort().pop()!];

  if (startPrice && endPrice) {
    const weeklyChange = ((endPrice.close - startPrice.open) / startPrice.open) * 100;
    console.log(`  Week start (${weekStart} open): $${startPrice.open.toFixed(2)}`);
    console.log(`  Latest close: $${endPrice.close.toFixed(2)}`);
    console.log(`  BTC weekly change: ${weeklyChange >= 0 ? '+' : ''}${weeklyChange.toFixed(2)}%`);
  }

  console.log('\n✅ Backfill complete!');
}

backfill().catch(console.error);
