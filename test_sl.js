const { adminDb } = require('./src/lib/firebase-admin');

async function test() {
  const d = await adminDb.collection('agent_configs').doc('SF87h3pQoxfkkFfD7zCSOXgtz5h1').get();
  const config = d.data();
  console.log('portfolioStopLoss', config.portfolioStopLoss);
  const stopLossThreshold = Math.abs(config?.portfolioStopLoss || 25) / 100;
  console.log('stopLossThreshold', stopLossThreshold);
  
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).getTime();
  const resumedAt = config?.stopLossResumedAt ? new Date(config.stopLossResumedAt).getTime() : 0;
  console.log('twentyFourHoursAgo', twentyFourHoursAgo);
  console.log('resumedAt', resumedAt);
  const effectiveSinceMs = Math.max(twentyFourHoursAgo, resumedAt);
  const since = new Date(effectiveSinceMs).toISOString();

  console.log('since', since);
  
  const histSnap = await adminDb
            .collection('virtual_portfolio_history')
            .where('userId', '==', 'SF87h3pQoxfkkFfD7zCSOXgtz5h1')
            .where('date', '>=', since)
            .orderBy('date', 'asc')
            .get();

  const history = histSnap.docs.map(d => d.data());
  console.log('history size', history.length);
  if (history.length > 0) {
      const peakValue = Math.max(...history.map(h => h.totalValue));
      const currentValue = history[history.length - 1].totalValue;
        
      if (peakValue <= 0) {
          console.log('peakValue <= 0');
          process.exit(0);
      }

      const drawdownPct = (peakValue - currentValue) / peakValue;
      console.log('peakValue', peakValue, 'currentValue', currentValue);
      console.log('drawdownPct', drawdownPct);
      console.log('drawdownPct < stopLossThreshold', drawdownPct < stopLossThreshold);
  }
  process.exit(0);
}
test();
