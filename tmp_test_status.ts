import { adminDb } from './src/lib/firebase-admin';
import { getArenaStatus, getUnifiedAuditTrail } from './src/app/actions';

(async () => {
  try {
    const status = await getArenaStatus('SF87h3pQoxfkkFfD7zCSOXgtz5h1', 'CRYPTO');
    console.log('Arena:', status.arena ? 'Exists' : 'Null');
    console.log('Shared Cash:', status.arena?.sharedCash);
    
    const trail = await getUnifiedAuditTrail('SF87h3pQoxfkkFfD7zCSOXgtz5h1');
    console.log('Trail length:', trail.length);
  } catch (e) {
    console.error('Error:', e);
  }
})();
