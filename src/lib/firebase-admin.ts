import * as admin from 'firebase-admin';

if (!admin.apps.length) {
    try {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
            : null;

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        } else {
            // Fallback for development/build without secrets - avoids crash but won't send
            console.warn("FIREBASE_SERVICE_ACCOUNT_JSON not found. Admin SDK not initialized.");
        }
    } catch (error) {
        console.error('Firebase admin initialization error', error);
    }
}

export const adminDb = admin.apps.length ? admin.firestore() : null;
export const adminMessaging = admin.apps.length ? admin.messaging() : null;
export const firebaseAdmin = admin;
