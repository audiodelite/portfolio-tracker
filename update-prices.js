const fs = require('fs');
const https = require('https');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ ok: res.statusCode === 200, json: () => JSON.parse(data) }));
    }).on('error', reject);
  });
}

async function getPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=6mo&interval=1mo&includePrePost=false`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = resp.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const history = {};
    timestamps.forEach((t, i) => {
      const d = new Date(t * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      history[key] = closes[i];
    });
    return {
      current: result.meta?.regularMarketPrice,
      dec: history['2025-12'] || null,
      jan: history['2026-01'] || null,
      feb: history['2026-02'] || null,
      mar: history['2026-03'] || null
    };
  } catch(e) {
    console.error(`Failed ${ticker}:`, e.message);
    return null;
  }
}

async function main() {
  let html = fs.readFileSync('index.html', 'utf8');

  // Extract tickers from the raw array
  const tickerMatch = html.match(/const raw = \[([\s\S]*?)\];/);
  if (!tickerMatch) { console.error('Could not find raw array'); process.exit(1); }
  const tickers = [...tickerMatch[1].matchAll(/\["([A-Z]+)"/g)].map(m => m[1]);
  console.log(`Found ${tickers.length} tickers`);

  // Fetch all prices (batch 10 at a time)
  const prices = {};
  for (let i = 0; i < tickers.length; i += 10) {
    const batch = tickers.slice(i, i + 10);
    const results = await Promise.all(batch.map(t => getPrice(t)));
    batch.forEach((t, idx) => { if (results[idx]) prices[t] = results[idx]; });
    console.log(`Fetched ${Math.min(i + 10, tickers.length)}/${tickers.length}`);
    if (i + 10 < tickers.length) await new Promise(r => setTimeout(r, 1000));
  }

  // Update the raw array current prices (index 6)
  for (const [ticker, data] of Object.entries(prices)) {
    if (data.current == null) continue;
    // Match: ["TICKER","SECTOR",shares,value,weight,costBasis,OLD_PRICE]
    const re = new RegExp(`(\\["${ticker}","[^"]*",\\d+,\\d+,[\\d.]+,[\\d.]+(?:null)?,)[\\d.]+(?:null)?\\]`);
    html = html.replace(re, `$1${data.current}]`);
  }

  // Update monthlyPrices object if it exists
  const mpJson = JSON.stringify(prices);
  if (html.includes('const monthlyPrices =')) {
    html = html.replace(/const monthlyPrices = \{[\s\S]*?\};/, `const monthlyPrices = ${mpJson};`);
  }

  // Update timestamp
  const now = new Date().toISOString();
  html = html.replace(/(Last updated <span id="ts">)[^<]*(<\/span>)/, `$1${now}$2`);

  fs.writeFileSync('index.html', html);
  console.log(`Updated ${Object.keys(prices).length} prices at ${now}`);
}

main().catch(e => { console.error(e); process.exit(1); });
