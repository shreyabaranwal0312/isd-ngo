const firebaseConfig = {
    apiKey: "AIzaSyDMNqYb2V90qdPUTCOkW6EiFuCHvI9JT2s",
    authDomain: "smart-attend-d476c.firebaseapp.com",
    projectId: "smart-attend-d476c",
    storageBucket: "smart-attend-d476c.firebasestorage.app",
    messagingSenderId: "834025214336",
    appId: "1:834025214336:web:6e62ddf29f440f68c5f165",
    measurementId: "G-N46BB4YHQ3"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Global variables
let currentCamp = null;
let currentSponsor = null;
let selectedOperatingDay = null;
let currentPatient = null;
let currentVisit = null;
let vitalsStats = { today: 0, pending: 0 };
let availableCamps = [];

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    try {
        await loadAvailableCamps();
        const campExists = await checkForSelectedCamp();
        if (!campExists) {
            showCampSelectionModal();
        } else {
            await loadCurrentCamp();
            await updateVitalsStatistics();
            await loadAvailablePatients();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showAlert('Failed to initialize application', 'error');
    }
}

function setupEventListeners() {
    // Patient lookup
    document.getElementById('lookupBtn').addEventListener('click', lookupPatient);
    document.getElementById('clearLookupBtn').addEventListener('click', clearLookup);
    document.getElementById('regNumberInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            lookupPatient();
        }
    });
    
    // Camp selection modal
    document.getElementById('selectCampBtn').addEventListener('click', selectCamp);
    document.getElementById('refreshCampsBtn').addEventListener('click', loadAvailableCamps);
    document.getElementById('availableCamps').addEventListener('change', onCampSelectionChange);
    document.getElementById('operatingDaySelect').addEventListener('change', onOperatingDayChange);
    
    // Quick actions
    document.getElementById('changeCampBtn').addEventListener('click', showCampSelectionModal);
    document.getElementById('refreshDataBtn').addEventListener('click', refreshAllData);
    
    // BMI auto-calculation
    document.getElementById('height').addEventListener('input', calculateBMI);
    document.getElementById('weight').addEventListener('input', calculateBMI);
    
    // Form functionality
    document.getElementById('vitalsForm').addEventListener('submit', handleVitalsSubmit);
    document.getElementById('clearVitalsBtn').addEventListener('click', clearVitalsForm);
    
    // Modal functionality
    document.getElementById('continueBtn').addEventListener('click', function() {
        document.getElementById('successModal').style.display = 'none';
        clearLookup();
    });
    
    // Blood pressure validation
    document.getElementById('bloodPressure').addEventListener('input', validateBloodPressure);
    
    // Vital signs validation
    setupVitalSignsValidation();
}

async function loadAvailableCamps() {
    try {
        const refreshBtn = document.getElementById('refreshCampsBtn');
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = 'Loading...';
        refreshBtn.disabled = true;
        
        // Simplified query - get all camps
        const campsRef = db.collection('camps');
        const snapshot = await campsRef.get();
        
        availableCamps = [];
        const campSelect = document.getElementById('availableCamps');
        campSelect.innerHTML = '<option value="">Select a camp</option>';
        
        if (snapshot.empty) {
            campSelect.innerHTML = '<option value="">No camps available</option>';
            showAlert('No camps found. Please contact admin to create camps.', 'warning');
            return;
        }
        
        for (const doc of snapshot.docs) {
            const campData = { id: doc.id, ...doc.data() };
            
            // Skip completed or cancelled camps
            if (campData.status === 'completed' || campData.status === 'cancelled') {
                continue;
            }
            
            // Load sponsor information
            if (campData.sponsorId) {
                try {
                    const sponsorDoc = await db.collection('sponsors').doc(campData.sponsorId).get();
                    if (sponsorDoc.exists) {
                        campData.sponsor = sponsorDoc.data();
                    } else {
                        campData.sponsor = { name: 'Unknown Sponsor', code: 'UNK' };
                    }
                } catch (error) {
                    console.error(`Error loading sponsor for camp ${campData.name}:`, error);
                    campData.sponsor = { name: 'Unknown Sponsor', code: 'UNK' };
                }
            } else {
                campData.sponsor = { name: 'No Sponsor', code: 'GEN' };
            }
            
            availableCamps.push(campData);
        }
        
        // Sort by creation date (newest first)
        availableCamps.sort((a, b) => {
            const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
            const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
            return bTime - aTime;
        });
        
        // Populate dropdown
        availableCamps.forEach(camp => {
            const option = document.createElement('option');
            option.value = camp.id;
            
            const operatingDays = getOperatingDaysArray(camp);
            const dateText = operatingDays.length > 0 
                ? `${operatingDays.length} operating days`
                : 'No dates set';
            
            option.textContent = `${camp.name} - ${camp.location} (${dateText})`;
            campSelect.appendChild(option);
        });
        
        if (availableCamps.length === 0) {
            campSelect.innerHTML = '<option value="">No available camps found</option>';
            showAlert('No available camps found.', 'warning');
        } else {
            showAlert(`${availableCamps.length} camps loaded successfully`, 'success');
        }
        
    } catch (error) {
        console.error('Error loading camps:', error);
        document.getElementById('availableCamps').innerHTML = '<option value="">Error loading camps</option>';
        showAlert('Failed to load camps: ' + error.message, 'error');
    } finally {
        const refreshBtn = document.getElementById('refreshCampsBtn');
        refreshBtn.textContent = 'Refresh Camps';
        refreshBtn.disabled = false;
    }
}

// Get operating days as array (supporting both new and legacy formats)
function getOperatingDaysArray(camp) {
    if (camp.operatingDays && Array.isArray(camp.operatingDays)) {
        return camp.operatingDays.map(timestamp => timestamp.toDate());
    } else if (camp.date) {
        // Legacy format - single date
        return [camp.date.toDate()];
    }
    return [];
}

function onCampSelectionChange() {
    const campSelect = document.getElementById('availableCamps');
    const selectedCampId = campSelect.value;
    const operatingDayGroup = document.getElementById('operatingDayGroup');
    const operatingDaySelect = document.getElementById('operatingDaySelect');
    const selectBtn = document.getElementById('selectCampBtn');
    const campInfoDiv = document.getElementById('selectedCampInfo');
    
    if (selectedCampId) {
        const selectedCamp = availableCamps.find(camp => camp.id === selectedCampId);
        if (selectedCamp) {
            populateOperatingDays(selectedCamp);
            operatingDayGroup.style.display = 'block';
            campInfoDiv.style.display = 'none';
            selectBtn.disabled = true;
        }
    } else {
        operatingDayGroup.style.display = 'none';
        campInfoDiv.style.display = 'none';
        selectBtn.disabled = true;
    }
}

function populateOperatingDays(camp) {
    const operatingDaySelect = document.getElementById('operatingDaySelect');
    operatingDaySelect.innerHTML = '<option value="">Select an operating day</option>';
    
    const operatingDays = getOperatingDaysArray(camp);
    
    if (operatingDays.length === 0) {
        operatingDaySelect.innerHTML = '<option value="">No operating days available</option>';
        return;
    }
    
    const sortedDates = [...operatingDays].sort((a, b) => a - b);
    
    sortedDates.forEach((date, index) => {
        const option = document.createElement('option');
        option.value = date.toISOString();
        
        const dateString = date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        const isToday = date.toDateString() === new Date().toDateString();
        const todayIndicator = isToday ? ' (Today)' : '';
        
        option.textContent = `Day ${index + 1}: ${dateString}${todayIndicator}`;
        operatingDaySelect.appendChild(option);
    });
}

function onOperatingDayChange() {
    const campSelect = document.getElementById('availableCamps');
    const operatingDaySelect = document.getElementById('operatingDaySelect');
    const selectedCampId = campSelect.value;
    const selectedDay = operatingDaySelect.value;
    const selectBtn = document.getElementById('selectCampBtn');
    const campInfoDiv = document.getElementById('selectedCampInfo');
    
    if (selectedCampId && selectedDay) {
        const selectedCamp = availableCamps.find(camp => camp.id === selectedCampId);
        if (selectedCamp) {
            displaySelectedCampAndDayInfo(selectedCamp, new Date(selectedDay));
            campInfoDiv.style.display = 'block';
            selectBtn.disabled = false;
        }
    } else {
        campInfoDiv.style.display = 'none';
        selectBtn.disabled = true;
    }
}

function displaySelectedCampAndDayInfo(camp, selectedDate) {
    const campInfoDiv = document.getElementById('selectedCampInfo');
    const sponsorName = camp.sponsor ? camp.sponsor.name : 'Unknown';
    
    const dateString = selectedDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const isToday = selectedDate.toDateString() === new Date().toDateString();
    const todayIndicator = isToday ? ' 🌟 (Today)' : '';
    
    campInfoDiv.innerHTML = `
        <h5>📋 Selected Camp & Day</h5>
        <div class="camp-info-grid">
            <div class="camp-info-item">
                <div class="camp-info-label">Camp Name</div>
                <div class="camp-info-value">${camp.name}</div>
            </div>
            <div class="camp-info-item">
                <div class="camp-info-label">Location</div>
                <div class="camp-info-value">${camp.location}</div>
            </div>
            <div class="camp-info-item">
                <div class="camp-info-label">Selected Day</div>
                <div class="camp-info-value" style="color: var(--vitals-purple); font-weight: 700;">${dateString}${todayIndicator}</div>
            </div>
            <div class="camp-info-item">
                <div class="camp-info-label">Sponsor</div>
                <div class="camp-info-value">${sponsorName}</div>
            </div>
        </div>
    `;
}

function checkForSelectedCamp() {
    const selectedCampId = localStorage.getItem('selectedCampId');
    const selectedDay = localStorage.getItem('selectedOperatingDay');
    if (selectedCampId && selectedDay) {
        return db.collection('camps').doc(selectedCampId).get()
            .then(doc => {
                if (doc.exists && !['completed', 'cancelled'].includes(doc.data().status)) {
                    return true;
                } else {
                    localStorage.removeItem('selectedCampId');
                    localStorage.removeItem('selectedOperatingDay');
                    return false;
                }
            })
            .catch(() => {
                localStorage.removeItem('selectedCampId');
                localStorage.removeItem('selectedOperatingDay');
                return false;
            });
    }
    return Promise.resolve(false);
}

function showCampSelectionModal() {
    document.getElementById('campSelectionModal').style.display = 'block';
    
    // Reset the modal state
    document.getElementById('availableCamps').value = '';
    document.getElementById('operatingDayGroup').style.display = 'none';
    document.getElementById('selectedCampInfo').style.display = 'none';
    document.getElementById('selectCampBtn').disabled = true;
    
    loadAvailableCamps();
}

async function selectCamp() {
    const selectBtn = document.getElementById('selectCampBtn');
    const btnText = selectBtn.querySelector('.btn-text');
    const btnLoading = selectBtn.querySelector('.btn-loading');
    const selectedCampId = document.getElementById('availableCamps').value;
    const selectedDay = document.getElementById('operatingDaySelect').value;
    
    if (!selectedCampId) {
        showAlert('Please select a camp', 'warning');
        return;
    }
    
    if (!selectedDay) {
        showAlert('Please select an operating day', 'warning');
        return;
    }
    
    selectBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    try {
        localStorage.setItem('selectedCampId', selectedCampId);
        localStorage.setItem('selectedOperatingDay', selectedDay);
        
        await loadCurrentCamp();
        await updateVitalsStatistics();
        await loadAvailablePatients();
        
        hideCampSelectionModal();
        showAlert('Camp and day selected successfully!', 'success');
        
    } catch (error) {
        console.error('Error selecting camp:', error);
        showAlert('Failed to select camp', 'error');
    } finally {
        selectBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
}

function hideCampSelectionModal() {
    document.getElementById('campSelectionModal').style.display = 'none';
    
    // Reset modal state
    document.getElementById('availableCamps').value = '';
    document.getElementById('operatingDaySelect').innerHTML = '<option value="">Select a day</option>';
    document.getElementById('operatingDayGroup').style.display = 'none';
    document.getElementById('selectedCampInfo').style.display = 'none';
    document.getElementById('selectCampBtn').disabled = true;
}

async function loadCurrentCamp() {
    try {
        const selectedCampId = localStorage.getItem('selectedCampId');
        const selectedDay = localStorage.getItem('selectedOperatingDay');
        
        if (!selectedCampId || !selectedDay) {
            displayNoCampState();
            return;
        }
        
        const campDoc = await db.collection('camps').doc(selectedCampId).get();
        if (!campDoc.exists) {
            localStorage.removeItem('selectedCampId');
            localStorage.removeItem('selectedOperatingDay');
            displayNoCampState();
            return;
        }
        
        currentCamp = { id: campDoc.id, ...campDoc.data() };
        selectedOperatingDay = new Date(selectedDay);
        
        // Load sponsor information
        if (currentCamp.sponsorId) {
            const sponsorDoc = await db.collection('sponsors').doc(currentCamp.sponsorId).get();
            if (sponsorDoc.exists) {
                currentSponsor = { id: sponsorDoc.id, ...sponsorDoc.data() };
            }
        }
        
        displayCampInfo();
        
    } catch (error) {
        console.error('Error loading camp:', error);
        showAlert('Failed to load camp information', 'error');
        displayNoCampState();
    }
}

function displayCampInfo() {
    if (!currentCamp || !selectedOperatingDay) {
        displayNoCampState();
        return;
    }
    
    const sponsorName = currentSponsor ? currentSponsor.name : 'Unknown';
    const selectedDateString = selectedOperatingDay.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const isToday = selectedOperatingDay.toDateString() === new Date().toDateString();
    const todayIndicator = isToday ? ' 🌟' : '';
    
    const operatingDays = getOperatingDaysArray(currentCamp);
    
    document.getElementById('campCard').innerHTML = `
        <div class="camp-header">
            <h3>🏥 ${currentCamp.name}</h3>
            <div class="camp-status active">Active</div>
        </div>
        <div class="camp-details">
            <div class="camp-detail">
                <span class="detail-label">📍 Location:</span>
                <span class="detail-value">${currentCamp.location}</span>
            </div>
            <div class="camp-detail">
                <span class="detail-label">📅 Selected Day:</span>
                <span class="detail-value" style="color: var(--vitals-purple); font-weight: 600;">${selectedDateString}${todayIndicator}</span>
            </div>
            <div class="camp-detail">
                <span class="detail-label">📊 Total Days:</span>
                <span class="detail-value">${operatingDays.length} operating days</span>
            </div>
            <div class="camp-detail">
                <span class="detail-label">🏢 Sponsor:</span>
                <span class="detail-value">${sponsorName}</span>
            </div>
        </div>
    `;
}

function displayNoCampState() {
    document.getElementById('campCard').innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">⚠️</div>
            <h3>No Camp Selected</h3>
            <p>Please select a camp and operating day to start recording vitals</p>
            <button onclick="showCampSelectionModal()" class="btn-primary" style="margin-top: 0.5rem;">
                Select Camp & Day
            </button>
        </div>
    `;
}

async function updateVitalsStatistics() {
    try {
        if (!currentCamp || !selectedOperatingDay) {
            document.getElementById('todayVitals').textContent = '0';
            document.getElementById('pendingVitals').textContent = '0';
            return;
        }
        
        // Get all visits for current camp - simplified query
        const allVisits = await db.collection('patient_visits')
            .where('campId', '==', currentCamp.id)
            .get();
        
        let completedVitals = 0;
        let pendingVitals = 0;
        
        // Filter by date in JavaScript
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        allVisits.forEach(doc => {
            const visit = doc.data();
            
            // Filter by date
            if (visit.visitDate) {
                const visitDate = visit.visitDate.toDate();
                if (visitDate < selectedDayStart || visitDate > selectedDayEnd) {
                    return; // Skip visits not on selected day
                }
            }
            
            if (visit.journeyStatus?.vitals?.status === 'completed') {
                completedVitals++;
            } else if (visit.journeyStatus?.registration?.status === 'completed' &&
                       visit.journeyStatus?.vitals?.status === 'pending') {
                pendingVitals++;
            }
        });
        
        vitalsStats.today = completedVitals;
        vitalsStats.pending = pendingVitals;
        
        // Update UI
        document.getElementById('todayVitals').textContent = vitalsStats.today;
        document.getElementById('pendingVitals').textContent = vitalsStats.pending;
        
    } catch (error) {
        console.error('Error updating statistics:', error);
        document.getElementById('todayVitals').textContent = 'Error';
        document.getElementById('pendingVitals').textContent = 'Error';
    }
}

// Load available patients for the selected camp and day - simplified query
async function loadAvailablePatients() {
    try {
        if (!currentCamp) {
            document.getElementById('recentPatientsList').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <h3>No Camp Selected</h3>
                    <p>Select a camp to view patients</p>
                </div>
            `;
            return;
        }
        
        const recentContainer = document.getElementById('recentPatientsList');
        recentContainer.innerHTML = '<div class="loading">Loading patients...</div>';
        
        // Simplified query - get all patients for current camp
        const patientsSnapshot = await db.collection('patients')
            .where('campId', '==', currentCamp.id)
            .get();
        
        if (patientsSnapshot.empty) {
            recentContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <h3>No Patients Found</h3>
                    <p>No patients registered for this camp</p>
                </div>
            `;
            return;
        }
        
        // Convert to array and sort by creation time
        const patients = [];
        patientsSnapshot.forEach(doc => {
            const data = doc.data();
            patients.push({
                id: doc.id,
                ...data,
                sortTime: data.createdAt ? data.createdAt.toMillis() : 0
            });
        });
        
        // Sort by creation time (newest first)
        patients.sort((a, b) => b.sortTime - a.sortTime);
        
        // Take only the 10 most recent
        const recentPatients = patients.slice(0, 10);
        
        recentContainer.innerHTML = recentPatients.map(patient => {
            let registrationDate = 'Unknown';
            let visitStatus = 'Available';
            
            try {
                if (patient.createdAt) {
                    const regDate = patient.createdAt.toDate();
                    registrationDate = regDate.toLocaleDateString();
                    
                    // Check if registered on selected day
                    if (selectedOperatingDay) {
                        const selectedDay = new Date(selectedOperatingDay);
                        if (regDate.toDateString() === selectedDay.toDateString()) {
                            visitStatus = 'Registered today';
                        } else {
                            visitStatus = 'Available for visits';
                        }
                    }
                }
            } catch (error) {
                console.error('Error formatting date:', error);
            }
            
            return `
                <div class="recent-patient-item" onclick="selectPatientFromList('${patient.id}', '${patient.registrationNo}')">
                    <h5>${patient.name || 'Unknown Name'}</h5>
                    <p class="patient-reg-no">${patient.registrationNo || 'No Reg Number'}</p>
                    <p><strong>Phone:</strong> ${patient.phone || 'N/A'}</p>
                    <p><strong>Age:</strong> ${patient.age || 'N/A'} | <strong>Gender:</strong> ${patient.sex || 'N/A'}</p>
                    <p><strong>Status:</strong> <span style="color: var(--success-green); font-weight: 500;">${visitStatus}</span></p>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading patients:', error);
        document.getElementById('recentPatientsList').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Loading Failed</h3>
                <p>Failed to load patients</p>
                <button onclick="loadAvailablePatients()" class="btn-secondary" style="margin-top: 1rem;">
                    Try Again
                </button>
            </div>
        `;
    }
}

// Select patient from recent list
async function selectPatientFromList(patientId, regNumber) {
    document.getElementById('regNumberInput').value = regNumber;
    await lookupPatient();
}

// Lookup patient by registration number, name, or phone - simplified query
async function lookupPatient() {
    const searchTerm = document.getElementById('regNumberInput').value.trim().toUpperCase();
    if (!searchTerm) {
        showAlert('Please enter a search term', 'warning');
        return;
    }
    
    if (!currentCamp) {
        showAlert('Please select a camp first', 'warning');
        return;
    }
    
    // Show search results section, hide recent patients
    document.getElementById('recentPatientsSection').style.display = 'none';
    document.getElementById('searchResultsSection').style.display = 'block';
    
    try {
        showAlert('Searching for patient...', 'info');
        
        // Simplified query - get all patients for current camp
        const patientsSnapshot = await db.collection('patients')
            .where('campId', '==', currentCamp.id)
            .get();
        
        let results = [];
        
        patientsSnapshot.forEach(doc => {
            const patient = { id: doc.id, ...doc.data() };
            
            // Search by phone number (exact match) - can return multiple patients
            if (/^\d{10}$/.test(searchTerm) && patient.phone === searchTerm) {
                results.push(patient);
                return;
            }
            
            // Search by registration number (exact match)
            if (searchTerm.includes('_') && patient.registrationNo === searchTerm.toUpperCase()) {
                results.push(patient);
                return;
            }
            
            // Search by name (case insensitive partial match)
            if (searchTerm.length >= 3 && 
                patient.name && patient.name.toLowerCase().includes(searchTerm.toLowerCase())) {
                results.push(patient);
                return;
            }
        });
        
        // Sort results by creation time (newest first)
        results.sort((a, b) => {
            const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
            const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
            return bTime - aTime;
        });
        
        if (results.length === 0) {
            document.getElementById('searchResultsList').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <h3>No Patients Found</h3>
                    <p>No patients found matching "${searchTerm}" in this camp</p>
                </div>
            `;
            showAlert('No patients found with this search term', 'error');
            return;
        }
        
        // Display search results
        document.getElementById('searchResultsList').innerHTML = results.map(patient => `
            <div class="search-result-item" onclick="selectPatientFromSearch('${patient.id}', '${patient.registrationNo}')">
                <h5>${patient.name}</h5>
                <p class="patient-reg-no">${patient.registrationNo}</p>
                <p><strong>Phone:</strong> ${patient.phone}</p>
                <p><strong>Age:</strong> ${patient.age} | <strong>Gender:</strong> ${patient.sex}</p>
            </div>
        `).join('');
        
        // If exactly one result, auto-select it
        if (results.length === 1) {
            await selectPatientFromSearch(results[0].id, results[0].registrationNo);
            showAlert('Patient found and selected automatically', 'success');
        } else {
            showAlert(`Found ${results.length} patients matching your search`, 'success');
        }
        
    } catch (error) {
        console.error('Error looking up patient:', error);
        showAlert('Failed to lookup patient', 'error');
        document.getElementById('searchResultsList').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Search Failed</h3>
                <p>Unable to search patients. Please try again.</p>
            </div>
        `;
    }
}

// Select patient from search results
async function selectPatientFromSearch(patientId, regNumber) {
    try {
        // Get patient data
        const patientDoc = await db.collection('patients').doc(patientId).get();
        if (!patientDoc.exists) {
            showAlert('Patient not found', 'error');
            return;
        }
        
        currentPatient = { id: patientDoc.id, ...patientDoc.data() };
        
        // Find or create patient's visit record for selected day
        await findOrCreatePatientVisit();
        
        // Update the search input to show selected patient
        document.getElementById('regNumberInput').value = regNumber;
        
        // Display patient information and show form
        displayPatientInfo();
        showVitalsForm();
        loadPreviousVitals();
        
        showAlert('Patient selected successfully', 'success');
        
    } catch (error) {
        console.error('Error selecting patient:', error);
        showAlert('Failed to select patient', 'error');
    }
}

// Find or create patient visit for selected day - simplified query
async function findOrCreatePatientVisit() {
    try {
        // Simplified query - get all visits for this patient and camp
        const visitQuery = await db.collection('patient_visits')
            .where('patientId', '==', currentPatient.id)
            .where('campId', '==', currentCamp.id)
            .get();
        
        // Filter by date in JavaScript
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        let foundVisit = null;
        
        visitQuery.forEach(doc => {
            const visit = doc.data();
            if (visit.visitDate) {
                const visitDate = visit.visitDate.toDate();
                if (visitDate >= selectedDayStart && visitDate <= selectedDayEnd) {
                    foundVisit = { id: doc.id, ...visit };
                }
            }
        });
        
        if (foundVisit) {
            // Visit exists for this day
            currentVisit = foundVisit;
        } else {
            // Create new visit for this day
            const newVisitData = {
                patientId: currentPatient.id,
                campId: currentCamp.id,
                visitDate: firebase.firestore.Timestamp.fromDate(selectedOperatingDay),
                visitType: 'continuing',
                journeyStatus: {
                    registration: {
                        status: 'completed',
                        timestamp: firebase.firestore.Timestamp.now(),
                        by: 'system'
                    },
                    vitals: {
                        status: 'pending'
                    },
                    doctor: {
                        status: 'pending'
                    },
                    pharmacy: {
                        status: 'pending'
                    }
                },
                createdAt: firebase.firestore.Timestamp.now(),
                isCompleted: false
            };
            
            const docRef = await db.collection('patient_visits').add(newVisitData);
            currentVisit = { id: docRef.id, ...newVisitData };
        }
        
    } catch (error) {
        console.error('Error finding/creating patient visit:', error);
        throw error;
    }
}

// Display patient information
function displayPatientInfo() {
    const patientInfo = document.getElementById('patientInfo');
    
    document.getElementById('patientName').textContent = currentPatient.name;
    document.getElementById('patientRegNo').textContent = currentPatient.registrationNo;
    document.getElementById('patientAge').textContent = `${currentPatient.age} years`;
    document.getElementById('patientGender').textContent = currentPatient.sex;
    document.getElementById('patientPhone').textContent = currentPatient.phone;
    
    // Update visit status
    let visitStatusText = 'Ready for vitals';
    if (currentVisit.journeyStatus?.vitals?.status === 'completed') {
        visitStatusText = 'Vitals completed';
    } else if (currentVisit.journeyStatus?.vitals?.status === 'pending') {
        visitStatusText = 'Pending vitals';
    }
    
    document.getElementById('visitStatus').textContent = visitStatusText;
    
    patientInfo.style.display = 'block';
}

// Show vitals form
function showVitalsForm() {
    document.getElementById('vitalsForm').style.display = 'block';
    document.getElementById('noPatientState').style.display = 'none';
    
    // Update completion status
    const completionStatus = document.getElementById('completionStatus');
    const vitalsFormTitle = document.getElementById('vitalsFormTitle');
    
    if (currentVisit.journeyStatus?.vitals?.status === 'completed') {
        completionStatus.innerHTML = `
            <span class="status-icon">✅</span>
            <span class="status-text">Vitals Completed</span>
        `;
        completionStatus.className = 'completion-status completed';
        vitalsFormTitle.textContent = '📋 Edit Vitals';
        
        // Load existing vitals data for editing
        if (currentVisit.vitals) {
            populateVitalsForm(currentVisit.vitals);
        }
    } else {
        completionStatus.innerHTML = `
            <span class="status-icon">📝</span>
            <span class="status-text">Recording Vitals</span>
        `;
        completionStatus.className = 'completion-status ready';
        vitalsFormTitle.textContent = '📋 Record Vitals';
    }
}

// Populate vitals form with existing data
function populateVitalsForm(vitalsData) {
    document.getElementById('bloodPressure').value = vitalsData.bp || '';
    document.getElementById('heartRate').value = vitalsData.heartRate || '';
    document.getElementById('temperature').value = vitalsData.temperature || '';
    document.getElementById('height').value = vitalsData.height || '';
    document.getElementById('weight').value = vitalsData.weight || '';
    document.getElementById('bmi').value = vitalsData.bmi || '';
    document.getElementById('respirationRate').value = vitalsData.respirationRate || '';
    document.getElementById('hemoglobin').value = vitalsData.hemoglobin || '';
    document.getElementById('bloodGlucose').value = vitalsData.bloodGlucose || '';
    document.getElementById('primarySymptoms').value = vitalsData.primarySymptoms || '';
    document.getElementById('additionalComplaints').value = vitalsData.additionalComplaints || '';
    
    // Update BMI category if BMI exists
    if (vitalsData.bmi) {
        updateBMICategory(vitalsData.bmi);
    }
}

// Calculate BMI automatically
function calculateBMI() {
    const height = parseFloat(document.getElementById('height').value);
    const weight = parseFloat(document.getElementById('weight').value);
    
    if (height && weight && height > 0) {
        const heightInMeters = height / 100;
        const bmi = weight / (heightInMeters * heightInMeters);
        const roundedBMI = Math.round(bmi * 10) / 10;
        
        document.getElementById('bmi').value = roundedBMI;
        updateBMICategory(roundedBMI);
    } else {
        document.getElementById('bmi').value = '';
        document.getElementById('bmiCategory').textContent = '';
    }
}

// Update BMI category display
function updateBMICategory(bmi) {
    const categoryElement = document.getElementById('bmiCategory');
    
    if (bmi < 18.5) {
        categoryElement.textContent = 'Underweight';
        categoryElement.className = 'field-hint bmi-category underweight';
    } else if (bmi >= 18.5 && bmi < 25) {
        categoryElement.textContent = 'Normal weight';
        categoryElement.className = 'field-hint bmi-category normal';
    } else if (bmi >= 25 && bmi < 30) {
        categoryElement.textContent = 'Overweight';
        categoryElement.className = 'field-hint bmi-category overweight';
    } else {
        categoryElement.textContent = 'Obese';
        categoryElement.className = 'field-hint bmi-category obese';
    }
}

// Validate blood pressure format
function validateBloodPressure() {
    const bpInput = document.getElementById('bloodPressure');
    const value = bpInput.value;
    
    // Allow partial typing
    if (value && !value.match(/^\d{0,3}\/?(\d{0,3})?$/)) {
        bpInput.value = value.slice(0, -1);
    }
}

// Setup vital signs validation
function setupVitalSignsValidation() {
    // Heart rate validation
    document.getElementById('heartRate').addEventListener('input', function(e) {
        const value = parseInt(e.target.value);
        if (value && (value < 40 || value > 200)) {
            showFieldError('heartRate', 'Heart rate should be between 40-200 BPM');
        } else {
            clearFieldError('heartRate');
        }
    });
    
    // Temperature validation
    document.getElementById('temperature').addEventListener('input', function(e) {
        const value = parseFloat(e.target.value);
        if (value && (value < 90 || value > 110)) {
            showFieldError('temperature', 'Temperature should be between 90-110°F');
        } else {
            clearFieldError('temperature');
        }
    });
    
    // Height validation
    document.getElementById('height').addEventListener('input', function(e) {
        const value = parseInt(e.target.value);
        if (value && (value < 50 || value > 250)) {
            showFieldError('height', 'Height should be between 50-250 cm');
        } else {
            clearFieldError('height');
        }
    });
    
    // Weight validation
    document.getElementById('weight').addEventListener('input', function(e) {
        const value = parseFloat(e.target.value);
        if (value && (value < 10 || value > 300)) {
            showFieldError('weight', 'Weight should be between 10-300 kg');
        } else {
            clearFieldError('weight');
        }
    });
}

// Handle vitals form submission
async function handleVitalsSubmit(e) {
    e.preventDefault();
    
    if (!currentPatient || !currentVisit) {
        showAlert('Please lookup a patient first', 'warning');
        return;
    }
    
    if (!validateVitalsForm()) {
        return;
    }
    
    const submitBtn = document.getElementById('saveVitalsBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    try {
        const formData = new FormData(e.target);
        
        // Prepare vitals data
        const vitalsData = {
            bp: formData.get('bp') || '',
            heartRate: formData.get('heartRate') ? parseInt(formData.get('heartRate')) : null,
            height: formData.get('height') ? parseInt(formData.get('height')) : null,
            weight: formData.get('weight') ? parseFloat(formData.get('weight')) : null,
            bmi: formData.get('bmi') ? parseFloat(formData.get('bmi')) : null,
            temperature: formData.get('temperature') ? parseFloat(formData.get('temperature')) : null,
            respirationRate: formData.get('respirationRate') ? parseInt(formData.get('respirationRate')) : null,
            hemoglobin: formData.get('hemoglobin') ? parseFloat(formData.get('hemoglobin')) : null,
            bloodGlucose: formData.get('bloodGlucose') ? parseInt(formData.get('bloodGlucose')) : null,
            primarySymptoms: formData.get('primarySymptoms') || '',
            additionalComplaints: formData.get('additionalComplaints') || '',
            recordedAt: firebase.firestore.Timestamp.now(),
            recordedBy: 'vitals-user' // Replace with actual user ID
        };
        
        // Update patient visit record
        const updateData = {
            vitals: vitalsData,
            'journeyStatus.vitals.status': 'completed',
            'journeyStatus.vitals.timestamp': firebase.firestore.Timestamp.now(),
            'journeyStatus.vitals.by': 'vitals-user',
            updatedAt: firebase.firestore.Timestamp.now()
        };
        
        await db.collection('patient_visits').doc(currentVisit.id).update(updateData);
        
        // Update current visit object
        currentVisit = { ...currentVisit, vitals: vitalsData, journeyStatus: { ...currentVisit.journeyStatus, vitals: { status: 'completed', timestamp: firebase.firestore.Timestamp.now(), by: 'vitals-user' } } };
        
        // Show success modal
        document.getElementById('successModal').style.display = 'block';
        
        // Update statistics
        await updateVitalsStatistics();
        
        // Refresh previous vitals
        await loadPreviousVitals();
        
        // Update form display
        showVitalsForm();
        
        showAlert('Vitals recorded successfully!', 'success');
        
    } catch (error) {
        console.error('Error saving vitals:', error);
        showAlert('Failed to save vitals: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
}

// Validate vitals form
function validateVitalsForm() {
    let isValid = true;
    
    // Clear previous errors
    document.querySelectorAll('.form-group.error').forEach(group => {
        group.classList.remove('error');
    });
    
    // Validate required fields
    const requiredFields = ['bloodPressure', 'heartRate', 'temperature', 'height', 'weight'];
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field.value.trim()) {
            showFieldError(fieldId, 'This field is required');
            isValid = false;
        }
    });
    
    // Validate blood pressure format
    const bp = document.getElementById('bloodPressure').value;
    if (bp && !bp.match(/^\d{2,3}\/\d{2,3}$/)) {
        showFieldError('bloodPressure', 'Please enter in format: 120/80');
        isValid = false;
    }
    
    // Validate numeric ranges
    const heartRate = parseInt(document.getElementById('heartRate').value);
    if (heartRate && (heartRate < 40 || heartRate > 200)) {
        showFieldError('heartRate', 'Heart rate must be between 40-200 BPM');
        isValid = false;
    }
    
    const temperature = parseFloat(document.getElementById('temperature').value);
    if (temperature && (temperature < 90 || temperature > 110)) {
        showFieldError('temperature', 'Temperature must be between 90-110°F');
        isValid = false;
    }
    
    return isValid;
}

// Show field error
function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const formGroup = field.closest('.form-group');
    formGroup.classList.add('error');
    
    let errorElement = formGroup.querySelector('.error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        formGroup.appendChild(errorElement);
    }
    errorElement.textContent = message;
}

// Clear field error
function clearFieldError(fieldId) {
    const field = document.getElementById(fieldId);
    const formGroup = field.closest('.form-group');
    formGroup.classList.remove('error');
}

// Load previous vitals history from all camp days - simplified query
async function loadPreviousVitals() {
    try {
        if (!currentPatient) return;
        
        const historyContainer = document.getElementById('vitalsHistory');
        historyContainer.innerHTML = '<div class="loading">Loading vitals history...</div>';
        
        // Simplified query - get all visits for this patient and camp
        const visitsQuery = await db.collection('patient_visits')
            .where('patientId', '==', currentPatient.id)
            .where('campId', '==', currentCamp.id)
            .get();
        
        if (visitsQuery.empty) {
            historyContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <h3>No Previous Records</h3>
                    <p>No previous vitals found for this patient</p>
                </div>
            `;
            return;
        }
        
        // Filter and sort completed vitals in JavaScript
        const completedVitals = visitsQuery.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(visit => visit.journeyStatus?.vitals?.status === 'completed')
            .sort((a, b) => {
                const aTime = a.journeyStatus?.vitals?.timestamp ? 
                    a.journeyStatus.vitals.timestamp.toDate().getTime() : 0;
                const bTime = b.journeyStatus?.vitals?.timestamp ? 
                    b.journeyStatus.vitals.timestamp.toDate().getTime() : 0;
                return bTime - aTime; // Newest first
            });
        
        if (completedVitals.length === 0) {
            historyContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <h3>No Previous Records</h3>
                    <p>No previous vitals found for this patient</p>
                </div>
            `;
            return;
        }
        
        const historyItems = completedVitals.map(visit => {
            const vitals = visit.vitals;
            const recordedDate = visit.journeyStatus.vitals.timestamp.toDate();
            const visitDate = visit.visitDate.toDate();
            
            // Check if this is from today's visit
            const isCurrentVisit = visit.id === currentVisit.id;
            const visitLabel = isCurrentVisit ? ' (Current Visit)' : '';
            
            return `
                <div class="history-item ${isCurrentVisit ? 'current-visit' : ''}">
                    <div class="history-header">
                        <span class="history-date">${visitDate.toLocaleDateString()} - ${recordedDate.toLocaleTimeString()}${visitLabel}</span>
                        <span class="history-by">by ${visit.journeyStatus.vitals.by}</span>
                    </div>
                    <div class="history-vitals">
                        <div class="history-vital">
                            <label>BP:</label>
                            <span>${vitals.bp || 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>Heart Rate:</label>
                            <span>${vitals.heartRate ? vitals.heartRate + ' BPM' : 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>Temperature:</label>
                            <span>${vitals.temperature ? vitals.temperature + '°F' : 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>Height:</label>
                            <span>${vitals.height ? vitals.height + ' cm' : 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>Weight:</label>
                            <span>${vitals.weight ? vitals.weight + ' kg' : 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>BMI:</label>
                            <span>${vitals.bmi || 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>Respiration Rate:</label>
                            <span>${vitals.respirationRate ? vitals.respirationRate + '/min' : 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>Hemoglobin:</label>
                            <span>${vitals.hemoglobin ? vitals.hemoglobin + ' g/dL' : 'N/A'}</span>
                        </div>
                        <div class="history-vital">
                            <label>Blood Glucose:</label>
                            <span>${vitals.bloodGlucose ? vitals.bloodGlucose + ' mg/dL' : 'N/A'}</span>
                        </div>
                    </div>
                    ${(vitals.primarySymptoms || vitals.additionalComplaints) ? `
                        <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--gray-200);">
                            ${vitals.primarySymptoms ? `<small><strong>Symptoms:</strong> ${vitals.primarySymptoms}</small><br>` : ''}
                            ${vitals.additionalComplaints ? `<small><strong>Additional:</strong> ${vitals.additionalComplaints}</small>` : ''}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        
        historyContainer.innerHTML = historyItems;
        
    } catch (error) {
        console.error('Error loading previous vitals:', error);
        document.getElementById('vitalsHistory').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Loading Failed</h3>
                <p>Failed to load vitals history</p>
            </div>
        `;
    }
}

// Clear lookup
function clearLookup() {
    // Show recent patients, hide search results
    document.getElementById('recentPatientsSection').style.display = 'block';
    document.getElementById('searchResultsSection').style.display = 'none';
    document.getElementById('regNumberInput').value = '';
    document.getElementById('patientInfo').style.display = 'none';
    document.getElementById('vitalsForm').style.display = 'none';
    document.getElementById('noPatientState').style.display = 'block';
    
    currentPatient = null;
    currentVisit = null;
    
    // Clear vitals history
    document.getElementById('vitalsHistory').innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <h3>No Previous Records</h3>
            <p>No previous vitals found for this patient</p>
        </div>
    `;
    
    clearVitalsForm();
}

// Clear vitals form
function clearVitalsForm() {
    document.getElementById('vitalsForm').reset();
    document.getElementById('bmiCategory').textContent = '';
    
    // Clear all errors
    document.querySelectorAll('.form-group.error').forEach(group => {
        group.classList.remove('error');
    });
    
    // Reset form title
    document.getElementById('vitalsFormTitle').textContent = '📋 Record Vitals';
}

// Refresh all data
async function refreshAllData() {
    try {
        const refreshBtn = document.getElementById('refreshDataBtn');
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = 'Loading...';
        refreshBtn.disabled = true;
        
        showAlert('Refreshing data...', 'info');
        await loadCurrentCamp();
        await updateVitalsStatistics();
        await loadAvailablePatients();
        
        if (currentPatient) {
            await loadPreviousVitals();
        }
        
        showAlert('Data refreshed successfully!', 'success');
        
        // Reset button
        refreshBtn.textContent = originalText;
        refreshBtn.disabled = false;
        
    } catch (error) {
        console.error('Error refreshing data:', error);
        showAlert('Failed to refresh data', 'error');
        
        // Reset button even on error
        const refreshBtn = document.getElementById('refreshDataBtn');
        refreshBtn.textContent = 'Refresh';
        refreshBtn.disabled = false;
    }
}

// Show alert notification
function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    alertDiv.innerHTML = `
        <span>${icons[type] || icons.info}</span>
        <span>${message}</span>
    `;
    
    alertContainer.appendChild(alertDiv);
    
    // Show alert
    setTimeout(() => alertDiv.classList.add('show'), 100);
    
    // Auto hide after 5 seconds
    setTimeout(() => {
        alertDiv.classList.remove('show');
        setTimeout(() => {
            if (alertContainer.contains(alertDiv)) {
                alertContainer.removeChild(alertDiv);
            }
        }, 300);
    }, 5000);
}