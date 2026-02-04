importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyCeP1T7CEOqBK8H8Gn3_rFc-q5n3tmlkGA",
    authDomain: "travelbag-68431.firebaseapp.com",
    projectId: "travelbag-68431",
    storageBucket: "travelbag-68431.firebasestorage.app",
    messagingSenderId: "425263464264",
    appId: "1:425263464264:web:42c1697e3d14e8c857bd7d"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png'
    };

    self.registration.showNotification(notificationTitle,
        notificationOptions);
});
