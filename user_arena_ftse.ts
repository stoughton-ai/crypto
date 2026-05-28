import { adminDb } from './src/lib/firebase-admin';

async function main() {
  const users = await adminDb!.collection('agent_configs').where('automationEnabled', '==', true).limit(1).get();
  if (users.empty) { console.log('No user'); return; }
  const doc = await adminDb!.collection('arena_config_ftse').doc(users.docs[0].id).get();
  const data = doc.data();
  console.log(JSON.stringify({
    totalBudget: data?.totalBudget,
    sharedCash: data?.sharedCash,
    sharedDcaContributions: data?.sharedDcaContributions,
  }, null, 2));
}

main().catch(console.error);
