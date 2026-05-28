import { adminDb } from './src/lib/firebase-admin';
import { getUnifiedAuditTrail, getArenaStatus } from './src/app/actions';

(async () => {
  try {
    const res = await getUnifiedAuditTrail('SF87h3pQoxfkkFfD7zCSOXgtz5h1');
    console.log('Events length:', res.length);
    const status = await getArenaStatus('SF87h3pQoxfkkFfD7zCSOXgtz5h1', 'CRYPTO');
    console.log('Shared cash:', status.arena?.sharedCash);
  } catch (e) {
    console.error(e);
  }
})();
