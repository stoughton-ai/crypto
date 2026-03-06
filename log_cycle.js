const { adminDb } = require('./src/lib/firebase-admin');
const { getAgentConfig } = require('./src/services/agentConfigService');

async function check() {
  const config = await getAgentConfig('SF87h3pQoxfkkFfD7zCSOXgtz5h1');
  console.log(JSON.stringify(config.cycle_logs?.[0] || {}, null, 2));
  process.exit();
}
check();
