// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyDMNqYb2V90qdPUTCOkW6EiFuCHvI9JT2s",
  authDomain: "smart-attend-d476c.firebaseapp.com",
  projectId: "smart-attend-d476c",
  storageBucket: "smart-attend-d476c.appspot.com",
  messagingSenderId: "834025214336",
  appId: "1:834025214336:web:6e62ddf29f440f68c5f165"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
console.log("Logging in with:", email, password);

const loginForm = document.getElementById("loginForm");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    const userDoc = await db.collection("users").doc(email).get();

    if (!userDoc.exists) {
      showAlert("User record not found in Firestore", "error");
      return;
    }

   const role = userDoc.data().role;
   console.log("Role from Firestore:", role);  // <-- Add this

    switch (role) {
      case "admin":
        window.location.href = "admin.html";
        break;
      case "registration":
        window.location.href = "registration.html";
        break;
      case "vitals":
        window.location.href = "vitals.html";
        break;
      case "doctor":
        window.location.href = "doctor.html";
        break;
      case "pharmacy":
        window.location.href = "pharmacy.html";
        break;
      default:
        showAlert("Unrecognized role: " + role, "error");
    }
  } catch (err) {
    console.error(err);
    showAlert(err.message, "error");
  }
});

function showAlert(message, type) {
  const alertContainer = document.getElementById("alertContainer");
  const alertDiv = document.createElement("div");
  alertDiv.className = "alert";
  alertDiv.textContent = message;
  alertContainer.appendChild(alertDiv);
  setTimeout(() => {
    alertDiv.remove();
  }, 4000);
}
