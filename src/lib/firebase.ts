// Cliente Firebase del sitio público — solo lectura, mismo proyecto que el POS/admin.
// Se inicializa en el navegador (no en build de Astro), así el contenido se lee en vivo
// desde Firestore en cada visita, sin necesitar rebuild/redeploy del sitio.
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDDqQ3pwmxEFY7mBve2wRGgop4nLBjyHjQ",
  authDomain: "supercolor-25505.firebaseapp.com",
  projectId: "supercolor-25505",
  storageBucket: "supercolor-25505.firebasestorage.app",
  messagingSenderId: "593847407002",
  appId: "1:593847407002:web:2308812d7159e4aaef6a23",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
