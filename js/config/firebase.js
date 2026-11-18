// js/config/firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBWnqoo0Q9p8hC1ZBYpQ0okfCuYMAFG7Oc",
  authDomain: "na-nyx.firebaseapp.com",
  projectId: "na-nyx",
  storageBucket: "na-nyx.firebasestorage.app",
  messagingSenderId: "932618856057",
  appId: "1:932618856057:web:22becc917e4128213116a8"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);