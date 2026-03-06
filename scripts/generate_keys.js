
const crypto = require('crypto');

console.log('--- GENERATING ED25519 KEY PAIR ---');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: {
        format: 'pem',
        type: 'pkcs8'
    },
    publicKeyEncoding: {
        format: 'pem',
        type: 'spki'
    }
});

console.log('\n--- PRIVATE KEY (Copy this into the App Settings) ---');
console.log(privateKey);

console.log('\n--- PUBLIC KEY (Upload this to Revolut X) ---');
console.log(publicKey);

console.log('\n------------------------------------------------');
