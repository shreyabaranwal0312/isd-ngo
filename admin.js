// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyCvmaXbrriN-59AXhwqy8iSp7RpEILhHlQ",
    authDomain: "ngo-80069.firebaseapp.com",
    projectId: "ngo-80069",
    storageBucket: "ngo-80069.firebasestorage.app",
    messagingSenderId: "99259281046",
    appId: "1:99259281046:web:f81c73674b269f732adcb7",
    measurementId: "G-96VRY8N2DW"
  };

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const roleCards = document.querySelectorAll('.role-card');
const modal = document.getElementById('userModal');
const modalClose = document.getElementById('modalClose');
const userForm = document.getElementById('userForm');
const roleInput = document.getElementById('userRole');

let selectedRole = '';

// User Role Management
roleCards.forEach(card => {
    card.addEventListener('click', () => {
        selectedRole = card.getAttribute('data-role');
        roleInput.value = selectedRole;
        modal.style.display = 'flex';
    });
});

modalClose.addEventListener('click', () => {
    modal.style.display = 'none';
    userForm.reset();
});

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.style.display = 'none';
        userForm.reset();
    }
});

userForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('userName').value.trim();
    const email = document.getElementById('userEmail').value.trim();
    const password = document.getElementById('userPassword').value;
    const phone = document.getElementById('userPhone').value.trim();
    const role = document.getElementById('userRole').value;

    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        const uid = userCredential.user.uid;

        await db.collection('users').doc(email).set({
            uid,
            email,
            name,
            role,
            phone,
            createdAt: firebase.firestore.Timestamp.now(),
            isActive: true
        });

        showAlert('User registered successfully!', 'success');
        userForm.reset();
        modal.style.display = 'none';
    } catch (error) {
        console.error(error);
        showAlert(error.message, 'error');
    }
});

// Operating Days Management
const operatingDaysContainer = document.querySelector('.operating-days-container');
const addDateBtn = document.getElementById('addDateBtn');

function createDateInputRow() {
    const row = document.createElement('div');
    row.className = 'date-input-row';
    row.innerHTML = `
        <input type="date" class="operating-date" required />
        <button type="button" class="btn-remove-date">×</button>
    `;
    
    const removeBtn = row.querySelector('.btn-remove-date');
    removeBtn.addEventListener('click', () => {
        row.remove();
        updateRemoveButtons();
    });
    
    return row;
}

function updateRemoveButtons() {
    const rows = operatingDaysContainer.querySelectorAll('.date-input-row');
    rows.forEach((row, index) => {
        const removeBtn = row.querySelector('.btn-remove-date');
        removeBtn.style.display = rows.length > 1 ? 'block' : 'none';
    });
}

addDateBtn.addEventListener('click', () => {
    const newRow = createDateInputRow();
    operatingDaysContainer.appendChild(newRow);
    updateRemoveButtons();
});

// Initialize remove button visibility
updateRemoveButtons();

function showAlert(message, type) {
    const alertContainer = document.getElementById('alertContainer');
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${type}`;
    alertDiv.textContent = message;
    alertContainer.appendChild(alertDiv);
    setTimeout(() => {
        alertDiv.remove();
    }, 4000);
}

// Sponsor Form
const sponsorForm = document.getElementById("sponsorForm");
sponsorForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("sponsorName").value.trim();
    const code = document.getElementById("sponsorCode").value.trim().toUpperCase();

    if (!name || !code) {
        showAlert("Please fill all sponsor fields", "error");
        return;
    }

    try {
        await db.collection("sponsors").add({
            name,
            code,
            isActive: true,
            createdAt: firebase.firestore.Timestamp.now()
        });
        showAlert("Sponsor created successfully!", "success");
        sponsorForm.reset();
        populateSponsors();
    } catch (error) {
        console.error("Error creating sponsor:", error);
        showAlert("Failed to create sponsor", "error");
    }
});

// Camp Management Variables
let existingCampId = null;
let existingOperatingDays = [];

// Check for existing camp when form fields change
function checkForExistingCamp() {
    const name = document.getElementById("campName").value.trim();
    const location = document.getElementById("campLocation").value.trim();
    const sponsorId = document.getElementById("campSponsor").value;
    
    if (name && location && sponsorId) {
        findExistingCamp(name, location, sponsorId);
    } else {
        hideExistingCampInfo();
    }
}

async function findExistingCamp(name, location, sponsorId) {
    try {
        const snapshot = await db.collection("camps")
            .where("name", "==", name)
            .where("location", "==", location)
            .where("sponsorId", "==", sponsorId)
            .get();
        
        if (!snapshot.empty) {
            const campDoc = snapshot.docs[0];
            const campData = campDoc.data();
            existingCampId = campDoc.id;
            existingOperatingDays = campData.operatingDays || [];
            showExistingCampInfo(campData);
        } else {
            hideExistingCampInfo();
        }
    } catch (error) {
        console.error("Error checking for existing camp:", error);
        hideExistingCampInfo();
    }
}

function showExistingCampInfo(campData) {
    const infoDiv = document.getElementById("existingCampInfo");
    const detailsSpan = document.getElementById("existingCampDetails");
    const daysSpan = document.getElementById("currentOperatingDays");
    const submitBtn = document.getElementById("campSubmitBtn");
    
    detailsSpan.textContent = `${campData.name} - ${campData.location}`;
    
    const formattedDays = existingOperatingDays
        .map(timestamp => timestamp.toDate().toLocaleDateString())
        .sort()
        .join(', ');
    daysSpan.textContent = formattedDays || 'None';
    
    infoDiv.style.display = 'block';
    submitBtn.textContent = 'Add Operating Days';
}

function hideExistingCampInfo() {
    const infoDiv = document.getElementById("existingCampInfo");
    const submitBtn = document.getElementById("campSubmitBtn");
    
    infoDiv.style.display = 'none';
    submitBtn.textContent = 'Create Camp';
    existingCampId = null;
    existingOperatingDays = [];
}

// Add event listeners for camp field changes
document.getElementById("campName").addEventListener('input', checkForExistingCamp);
document.getElementById("campLocation").addEventListener('input', checkForExistingCamp);
document.getElementById("campSponsor").addEventListener('change', checkForExistingCamp);

// Camp Form
const campForm = document.getElementById("campForm");
campForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("campName").value.trim();
    const location = document.getElementById("campLocation").value.trim();
    const sponsorId = document.getElementById("campSponsor").value;
    
    // Collect all operating dates
    const dateInputs = operatingDaysContainer.querySelectorAll('.operating-date');
    const newOperatingDays = [];
    
    for (const input of dateInputs) {
        if (!input.value) {
            showAlert("Please fill all operating dates", "error");
            return;
        }
        newOperatingDays.push(firebase.firestore.Timestamp.fromDate(new Date(input.value)));
    }

    if (!name || !location || !sponsorId || newOperatingDays.length === 0) {
        showAlert("Please fill all camp fields", "error");
        return;
    }

    // Combine existing and new operating days
    const allOperatingDays = [...existingOperatingDays, ...newOperatingDays];
    
    // Check for duplicate dates across all operating days
    const uniqueDates = new Set(allOperatingDays.map(d => d.toDate().toDateString()));
    if (uniqueDates.size !== allOperatingDays.length) {
        showAlert("Some dates already exist for this camp or are duplicated", "error");
        return;
    }

    try {
        if (existingCampId) {
            // Update existing camp with new operating days
            await db.collection("camps").doc(existingCampId).update({
                operatingDays: allOperatingDays.sort((a, b) => a.toDate() - b.toDate()),
                updatedAt: firebase.firestore.Timestamp.now()
            });
            showAlert("Operating days added to existing camp successfully!", "success");
        } else {
            // Create new camp
            await db.collection("camps").add({
                name,
                sponsorId,
                location,
                operatingDays: newOperatingDays.sort((a, b) => a.toDate() - b.toDate()),
                status: "planned",
                createdBy: "admin-user",
                createdAt: firebase.firestore.Timestamp.now()
            });
            showAlert("Camp created successfully!", "success");
        }
        
        campForm.reset();
        resetOperatingDays();
        hideExistingCampInfo();
    } catch (error) {
        console.error("Error managing camp:", error);
        showAlert("Failed to save camp", "error");
    }
});

function resetOperatingDays() {
    operatingDaysContainer.innerHTML = `
        <div class="date-input-row">
            <input type="date" class="operating-date" required />
            <button type="button" class="btn-remove-date" style="display: none;">×</button>
        </div>
    `;
    updateRemoveButtons();
}

async function populateSponsors() {
    const select = document.getElementById("campSponsor");
    select.innerHTML = '<option value="">Select Sponsor</option>';
    try {
        const snapshot = await db.collection("sponsors").where("isActive", "==", true).get();
        snapshot.forEach(doc => {
            const s = doc.data();
            const opt = document.createElement("option");
            opt.value = doc.id;
            opt.textContent = `${s.name} (${s.code})`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Error loading sponsors:", err);
    }
}

document.addEventListener("DOMContentLoaded", populateSponsors);
