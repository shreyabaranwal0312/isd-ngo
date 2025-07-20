// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDMNqYb2V90qdPUTCOkW6EiFuCHvI9JT2s",
    authDomain: "smart-attend-d476c.firebaseapp.com",
    projectId: "smart-attend-d476c",
    storageBucket: "smart-attend-d476c.appspot.com",
    messagingSenderId: "834025214336",
    appId: "1:834025214336:web:6e62ddf29f440f68c5f165",
    measurementId: "G-N46BB4YHQ3"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Global variables
let currentCamp = null;
let currentSponsor = null;
let selectedOperatingDay = null;
let currentPatient = null;
let currentVisit = null;
let availableCamps = [];
let pharmacyStats = { today: 0, pending: 0 };
let availableMedicines = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
});

// Initialize application
async function initializeApp() {
    try {
        await loadAvailableCamps();
        const campExists = await checkForSelectedCamp();
        if (!campExists) {
            showCampSelectionModal();
        } else {
            await loadCurrentCamp();
            await loadReadyPatients();
            await updatePharmacyStatistics();
            await loadMedicineDatabase();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showAlert('Failed to initialize application', 'error');
    }
}

// Setup event listeners
function setupEventListeners() {
    // Camp selection
    document.getElementById('availableCamps').addEventListener('change', onCampSelectionChange);
    document.getElementById('operatingDaySelect').addEventListener('change', onOperatingDayChange);
    document.getElementById('selectCampBtn').addEventListener('click', selectCamp);
    document.getElementById('refreshCampsBtn').addEventListener('click', loadAvailableCamps);
    document.getElementById('changeCampBtn').addEventListener('click', showCampSelectionModal);

    // Patient search
    document.getElementById('searchBtn').addEventListener('click', searchPatients);
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchPatients();
        }
    });
    document.getElementById('clearSearchBtn').addEventListener('click', clearSearch);

    // Medicine search
    document.getElementById('medicineSearchBtn').addEventListener('click', searchMedicines);
    document.getElementById('medicineSearchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchMedicines();
        }
    });

    // Dispensing form
    document.getElementById('dispensingForm').addEventListener('submit', handleDispensingSubmit);
    document.getElementById('clearDispensingBtn').addEventListener('click', clearDispensingForm);

    // Modal handling
    document.getElementById('continueBtn').addEventListener('click', function() {
        document.getElementById('successModal').style.display = 'none';
        clearDispensingForm();
        loadReadyPatients();
    });

    // Refresh data
    document.getElementById('refreshDataBtn').addEventListener('click', function() {
        loadReadyPatients();
        updatePharmacyStatistics();
    });

    // Close modals on outside click
    window.addEventListener('click', function(event) {
        const campModal = document.getElementById('campSelectionModal');
        const successModal = document.getElementById('successModal');
        
        if (event.target === campModal) {
            // Don't allow closing camp selection modal by clicking outside
        }
        if (event.target === successModal) {
            successModal.style.display = 'none';
        }
    });
}

// Load available camps
async function loadAvailableCamps() {
    try {
        const refreshBtn = document.getElementById('refreshCampsBtn');
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = 'Loading...';
        refreshBtn.disabled = true;
        
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
            
            if (campData.status === 'completed' || campData.status === 'cancelled') {
                continue;
            }
            
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
        
        availableCamps.sort((a, b) => {
            const aTime = a.createdAt ? a.createdAt.toMillis() : 0;
            const bTime = b.createdAt ? b.createdAt.toMillis() : 0;
            
            if (aTime && bTime) {
                return bTime - aTime;
            } else {
                return a.name.localeCompare(b.name);
            }
        });
        
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
            showAlert('No available camps found. All camps may be completed or cancelled.', 'warning');
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

// Handle camp selection change
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
        <div class="camp-info-detail">
            <label>Camp Name:</label>
            <span>${camp.name}</span>
        </div>
        <div class="camp-info-detail">
            <label>Location:</label>
            <span>${camp.location}</span>
        </div>
        <div class="camp-info-detail">
            <label>Selected Day:</label>
            <span style="color: var(--pharmacy-green); font-weight: 700;">${dateString}${todayIndicator}</span>
        </div>
        <div class="camp-info-detail">
            <label>Sponsor:</label>
            <span>${sponsorName}</span>
        </div>
        <div class="camp-info-detail">
            <label>Status:</label>
            <span style="color: var(--success-green); font-weight: 600;">${camp.status}</span>
        </div>
    `;
}

// Check if a camp is already selected
function checkForSelectedCamp() {
    const selectedCampId = localStorage.getItem('selectedCampId');
    const selectedDay = localStorage.getItem('selectedOperatingDay');
    if (selectedCampId && selectedDay) {
        return db.collection('camps').doc(selectedCampId).get()
            .then(doc => {
                if (doc.exists && ['active', 'planned'].includes(doc.data().status)) {
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

// Show camp selection modal
function showCampSelectionModal() {
    document.getElementById('campSelectionModal').style.display = 'block';
    
    // Reset the modal state
    document.getElementById('availableCamps').value = '';
    document.getElementById('operatingDayGroup').style.display = 'none';
    document.getElementById('selectedCampInfo').style.display = 'none';
    document.getElementById('selectCampBtn').disabled = true;
    
    loadAvailableCamps();
}

// Select a camp
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
        await loadReadyPatients();
        await updatePharmacyStatistics();
        await loadMedicineDatabase();
        
        document.getElementById('campSelectionModal').style.display = 'none';
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

// Load current selected camp
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

// Display camp information
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
        <h3>🏥 Current Camp</h3>
        <div class="camp-detail">
            <label>Camp Name</label>
            <span>${currentCamp.name}</span>
        </div>
        <div class="camp-detail">
            <label>Sponsor</label>
            <span>${sponsorName}</span>
        </div>
        <div class="camp-detail">
            <label>Location</label>
            <span>${currentCamp.location}</span>
        </div>
        <div class="camp-detail">
            <label>Selected Day</label>
            <span style="color: var(--pharmacy-green); font-weight: 600;">${selectedDateString}${todayIndicator}</span>
        </div>
        <div class="camp-detail">
            <label>Total Days</label>
            <span>${operatingDays.length} operating days</span>
        </div>
        <div class="camp-detail">
            <label>Status</label>
            <span class="camp-status">
                <span>🟢</span>
                ${currentCamp.status}
            </span>
        </div>
    `;
}

// Display no camp state
function displayNoCampState() {
    document.getElementById('campCard').innerHTML = `
        <div class="no-camp-state">
            <h3>⚠️ No Camp Selected</h3>
            <p>Please select a camp and operating day to start dispensing medicines</p>
            <button onclick="showCampSelectionModal()" class="btn-primary" style="margin-top: 0.5rem;">
                Select Camp & Day
            </button>
        </div>
    `;
}

// Load patients ready for medicine dispensing
async function loadReadyPatients() {
    if (!currentCamp || !selectedOperatingDay) return;
    
    try {
        const readyPatientsList = document.getElementById('readyPatientsList');
        readyPatientsList.innerHTML = '<div class="loading">Loading patients...</div>';
        
        // Get all visits for current camp
        const snapshot = await db.collection('patient_visits')
            .where('campId', '==', currentCamp.id)
            .get();
        
        const patients = [];
        
        // Filter by selected day and ready for pharmacy
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        for (const doc of snapshot.docs) {
            const visitData = doc.data();
            
            // Check if visit is for selected day
            if (visitData.visitDate) {
                const visitDate = visitData.visitDate.toDate();
                if (visitDate < selectedDayStart || visitDate > selectedDayEnd) {
                    continue; // Skip visits not on selected day
                }
            }
            
            // Check if ready for pharmacy (doctor completed, pharmacy pending)
            if (visitData.journeyStatus?.doctor?.status === 'completed' &&
                visitData.journeyStatus?.pharmacy?.status === 'pending') {
                
                try {
                    const patientDoc = await db.collection('patients').doc(visitData.patientId).get();
                    if (patientDoc.exists) {
                        patients.push({
                            visitId: doc.id,
                            ...visitData,
                            patientData: patientDoc.data()
                        });
                    }
                } catch (patientError) {
                    console.error('Error loading patient details:', patientError);
                }
            }
        }
        
        patients.sort((a, b) => {
            const aTime = a.journeyStatus?.doctor?.timestamp || firebase.firestore.Timestamp.now();
            const bTime = b.journeyStatus?.doctor?.timestamp || firebase.firestore.Timestamp.now();
            return bTime.toMillis() - aTime.toMillis();
        });
        
        displayReadyPatients(patients);
    } catch (error) {
        console.error('Error loading ready patients:', error);
        showAlert('Failed to load patients', 'error');
    }
}

// Display ready patients
function displayReadyPatients(patients) {
    const readyPatientsList = document.getElementById('readyPatientsList');
    
    if (patients.length === 0) {
        readyPatientsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">👥</div>
                <h3>No Patients Ready</h3>
                <p>No patients are currently ready for medicine dispensing on the selected day</p>
            </div>
        `;
        return;
    }
    
    readyPatientsList.innerHTML = '';
    
    patients.forEach(patient => {
        const patientItem = document.createElement('div');
        patientItem.className = 'patient-item';
        patientItem.innerHTML = `
            <div class="patient-item-header">
                <div class="patient-name">${patient.patientData.name}</div>
                <div class="patient-reg-no">${patient.patientData.registrationNo}</div>
            </div>
            <div class="patient-details">
                <span>${patient.patientData.age} years, ${patient.patientData.sex}</span>
                <span>Phone: ${patient.patientData.phone}</span>
            </div>
        `;
        
        patientItem.addEventListener('click', () => selectPatient(patient));
        readyPatientsList.appendChild(patientItem);
    });
}

// Search patients
async function searchPatients() {
    const searchQuery = document.getElementById('searchInput').value.trim();
    if (!searchQuery || !currentCamp || !selectedOperatingDay) return;
    
    try {
        const searchResultsList = document.getElementById('searchResultsList');
        searchResultsList.innerHTML = '<div class="loading">Searching...</div>';
        
        document.getElementById('searchResultsSection').style.display = 'block';
        document.getElementById('readyPatientsSection').style.display = 'none';
        
        // Get all patients for current camp
        const patientsSnapshot = await db.collection('patients')
            .where('campId', '==', currentCamp.id)
            .get();
        
        const matchingPatients = [];
        const searchLower = searchQuery.toLowerCase();
        
        for (const patientDoc of patientsSnapshot.docs) {
            const patient = patientDoc.data();
            
            const patientName = patient.name || '';
            const patientPhone = patient.phone || '';
            const patientRegNo = patient.registrationNo || '';
            
            if (patientName.toLowerCase().includes(searchLower) ||
                patientPhone.includes(searchQuery) ||
                patientRegNo.toLowerCase().includes(searchLower)) {
                
                // Find patient's visit for selected day
                const visitQuery = await db.collection('patient_visits')
                    .where('patientId', '==', patientDoc.id)
                    .where('campId', '==', currentCamp.id)
                    .get();
                
                const selectedDayStart = new Date(selectedOperatingDay);
                selectedDayStart.setHours(0, 0, 0, 0);
                const selectedDayEnd = new Date(selectedOperatingDay);
                selectedDayEnd.setHours(23, 59, 59, 999);
                
                let visitForDay = null;
                visitQuery.forEach(visitDoc => {
                    const visit = visitDoc.data();
                    if (visit.visitDate) {
                        const visitDate = visit.visitDate.toDate();
                        if (visitDate >= selectedDayStart && visitDate <= selectedDayEnd) {
                            visitForDay = { id: visitDoc.id, ...visit };
                        }
                    }
                });
                
                if (visitForDay) {
                    matchingPatients.push({
                        id: patientDoc.id,
                        visitId: visitForDay.id,
                        ...patient,
                        visitData: visitForDay
                    });
                }
            }
        }
        
        displaySearchResults(matchingPatients);
        
    } catch (error) {
        console.error('Error searching patients:', error);
        showAlert('Failed to search patients', 'error');
    }
}

// Display search results
function displaySearchResults(patients) {
    const searchResultsList = document.getElementById('searchResultsList');
    
    if (patients.length === 0) {
        searchResultsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <h3>No Results Found</h3>
                <p>No patients match your search criteria for the selected day</p>
            </div>
        `;
        return;
    }
    
    searchResultsList.innerHTML = '';
    
    patients.forEach(patient => {
        const patientItem = document.createElement('div');
        patientItem.className = 'patient-item';
        patientItem.innerHTML = `
            <div class="patient-item-header">
                <div class="patient-name">${patient.name}</div>
                <div class="patient-reg-no">${patient.registrationNo}</div>
            </div>
            <div class="patient-details">
                <span>${patient.age} years, ${patient.sex}</span>
                <span>Phone: ${patient.phone}</span>
            </div>
        `;
        
        patientItem.addEventListener('click', () => {
            const patientForSelection = {
                visitId: patient.visitId,
                patientId: patient.id,
                ...patient.visitData,
                patientData: {
                    name: patient.name,
                    registrationNo: patient.registrationNo,
                    age: patient.age,
                    sex: patient.sex,
                    phone: patient.phone,
                    category: patient.category,
                    address: patient.address
                }
            };
            selectPatient(patientForSelection);
        });
        
        searchResultsList.appendChild(patientItem);
    });
}

// Select patient
async function selectPatient(patient) {
    currentPatient = patient;
    currentVisit = patient;
    
    document.querySelectorAll('.patient-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    event.target.closest('.patient-item').classList.add('selected');
    
    displayPatientInfo(patient);
    await loadPatientPrescription(patient);
    await loadDispensingHistory(patient.patientId);
    
    showDispensingForm();
    updatePatientStatus('Selected for dispensing');
}

// Display patient information
function displayPatientInfo(patient) {
    const patientInfo = document.getElementById('patientInfo');
    const patientData = patient.patientData;
    
    patientInfo.innerHTML = `
        <div class="patient-basic-info">
            <h3>${patientData.name}</h3>
            <div class="patient-info-grid">
                <div class="info-item">
                    <div class="info-label">Registration Number</div>
                    <div class="info-value">${patientData.registrationNo}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Age</div>
                    <div class="info-value">${patientData.age} years</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Gender</div>
                    <div class="info-value">${patientData.sex}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Phone</div>
                    <div class="info-value">${patientData.phone}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Category</div>
                    <div class="info-value">${patientData.category}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Address</div>
                    <div class="info-value">${patientData.address}</div>
                </div>
            </div>
        </div>
    `;
    
    patientInfo.style.display = 'block';
    document.getElementById('noPatientState').style.display = 'none';
}

// Load patient prescription for selected day
async function loadPatientPrescription(patient) {
    try {
        const visitDoc = await db.collection('patient_visits').doc(patient.visitId).get();
        if (!visitDoc.exists) {
            console.log('Visit document does not exist');
            return;
        }
        
        const visitData = visitDoc.data();
        console.log('Visit data:', visitData);
        
        // Check multiple possible locations for prescription data
        let prescriptionMedicines = null;
        
        // Check if prescription is in doctor field
        if (visitData.doctor && visitData.doctor.medicines && visitData.doctor.medicines.length > 0) {
            prescriptionMedicines = visitData.doctor.medicines;
            console.log('Found prescription in doctor field:', prescriptionMedicines);
        }
        // Check if prescription is in consultation field
        else if (visitData.consultation && visitData.consultation.medicines && visitData.consultation.medicines.length > 0) {
            prescriptionMedicines = visitData.consultation.medicines;
            console.log('Found prescription in consultation field:', prescriptionMedicines);
        }
        // Check if prescription is in journeyStatus.doctor.data
        else if (visitData.journeyStatus?.doctor?.data?.medicines && visitData.journeyStatus.doctor.data.medicines.length > 0) {
            prescriptionMedicines = visitData.journeyStatus.doctor.data.medicines;
            console.log('Found prescription in journeyStatus.doctor.data:', prescriptionMedicines);
        }
        // Check if prescription is directly in journeyStatus.doctor
        else if (visitData.journeyStatus?.doctor?.medicines && visitData.journeyStatus.doctor.medicines.length > 0) {
            prescriptionMedicines = visitData.journeyStatus.doctor.medicines;
            console.log('Found prescription in journeyStatus.doctor:', prescriptionMedicines);
        }
        
        if (!prescriptionMedicines || prescriptionMedicines.length === 0) {
            console.log('No prescription found in any expected location');
            document.getElementById('prescriptionList').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <h3>No Prescription Found</h3>
                    <p>No medicines were prescribed for this patient today</p>
                    <button onclick="console.log('Visit data:', ${JSON.stringify(visitData)})" class="btn-secondary" style="margin-top: 1rem;">
                        Debug: Log Visit Data
                    </button>
                </div>
            `;
            return;
        }
        
        displayPrescription(prescriptionMedicines);
        generateDispensingForm(prescriptionMedicines, visitData.pharmacy);
        
    } catch (error) {
        console.error('Error loading prescription:', error);
        showAlert('Failed to load prescription', 'error');
    }
}

// Display prescription
function displayPrescription(medicines) {
    const prescriptionList = document.getElementById('prescriptionList');
    
    if (medicines.length === 0) {
        prescriptionList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <h3>No Medicines Prescribed</h3>
                <p>No medicines were prescribed for this patient today</p>
            </div>
        `;
        return;
    }
    
    prescriptionList.innerHTML = '';
    
    medicines.forEach((medicine, index) => {
        const prescriptionItem = document.createElement('div');
        prescriptionItem.className = 'prescription-item';
        prescriptionItem.innerHTML = `
            <div class="prescription-header">
                <div class="medicine-name">${medicine.name}</div>
                <div class="medicine-status pending">Pending</div>
            </div>
            <div class="prescription-details">
                <div class="prescription-detail">
                    <div class="detail-label">Dosage</div>
                    <div class="detail-value">${medicine.dosage || 'Not specified'}</div>
                </div>
                <div class="prescription-detail">
                    <div class="detail-label">Frequency</div>
                    <div class="detail-value">${medicine.frequency || 'Not specified'}</div>
                </div>
                <div class="prescription-detail">
                    <div class="detail-label">Duration</div>
                    <div class="detail-value">${medicine.duration || 'Not specified'}</div>
                </div>
            </div>
        `;
        prescriptionList.appendChild(prescriptionItem);
    });
}

// Generate dispensing form
function generateDispensingForm(medicines, existingPharmacyData = null) {
    const dispensingList = document.getElementById('dispensingList');
    
    dispensingList.innerHTML = '';
    
    medicines.forEach((medicine, index) => {
        const dispensingItem = document.createElement('div');
        dispensingItem.className = 'dispensing-item';
        
        // Check if medicine was already dispensed
        let existingDispense = null;
        if (existingPharmacyData && existingPharmacyData.medicines) {
            existingDispense = existingPharmacyData.medicines.find(m => m.name === medicine.name);
        }
        
        const isChecked = existingDispense ? 'checked' : 'checked';
        const quantity = existingDispense ? existingDispense.quantity : '';
        const unit = existingDispense ? existingDispense.unit : 'tablets';
        const batch = existingDispense ? existingDispense.batchNumber : '';
        const expiry = existingDispense ? existingDispense.expiryDate : '';
        
        dispensingItem.innerHTML = `
            <div class="dispensing-header">
                <div class="dispensing-medicine-name">${medicine.name}</div>
                <div class="dispensing-toggle">
                    <input type="checkbox" id="dispense-${index}" class="dispensing-checkbox" ${isChecked} onchange="toggleDispensingFields(${index})">
                    <label for="dispense-${index}" class="dispensing-label">Dispense</label>
                </div>
            </div>
            <div class="dispensing-details" id="dispensing-details-${index}">
                <div class="dispensing-field">
                    <label>Quantity Dispensed *</label>
                    <input type="number" name="quantity-${index}" min="1" value="${quantity}" required>
                </div>
                <div class="dispensing-field">
                    <label>Unit</label>
                    <select name="unit-${index}">
                        <option value="tablets" ${unit === 'tablets' ? 'selected' : ''}>Tablets</option>
                        <option value="capsules" ${unit === 'capsules' ? 'selected' : ''}>Capsules</option>
                        <option value="ml" ${unit === 'ml' ? 'selected' : ''}>ML</option>
                        <option value="mg" ${unit === 'mg' ? 'selected' : ''}>MG</option>
                        <option value="bottles" ${unit === 'bottles' ? 'selected' : ''}>Bottles</option>
                        <option value="sachets" ${unit === 'sachets' ? 'selected' : ''}>Sachets</option>
                    </select>
                </div>
                <div class="dispensing-field">
                    <label>Batch Number</label>
                    <input type="text" name="batch-${index}" value="${batch}" placeholder="e.g., BT001">
                </div>
                <div class="dispensing-field">
                    <label>Expiry Date</label>
                    <input type="date" name="expiry-${index}" value="${expiry}">
                </div>
            </div>
        `;
        dispensingList.appendChild(dispensingItem);
    });
    
    // Populate existing notes if available
    if (existingPharmacyData && existingPharmacyData.dispensingNotes) {
        document.getElementById('dispensingNotes').value = existingPharmacyData.dispensingNotes;
    }
}

// Toggle dispensing fields
function toggleDispensingFields(index) {
    const checkbox = document.getElementById(`dispense-${index}`);
    const details = document.getElementById(`dispensing-details-${index}`);
    const inputs = details.querySelectorAll('input, select');
    
    if (checkbox.checked) {
        details.style.opacity = '1';
        inputs.forEach(input => {
            input.disabled = false;
        });
    } else {
        details.style.opacity = '0.5';
        inputs.forEach(input => {
            input.disabled = true;
        });
    }
}

// Show dispensing form
function showDispensingForm() {
    document.getElementById('dispensingForm').style.display = 'block';
    document.getElementById('noDispensingState').style.display = 'none';
}

// Update patient status
function updatePatientStatus(statusText) {
    const statusElement = document.getElementById('patientStatus');
    statusElement.innerHTML = `
        <span class="status-icon">💊</span>
        <span class="status-text">${statusText}</span>
    `;
}

// Handle dispensing form submission
async function handleDispensingSubmit(e) {
    e.preventDefault();
    
    if (!currentPatient || !currentVisit) {
        showAlert('Please select a patient first', 'error');
        return;
    }
    
    const saveBtn = document.getElementById('saveDispensingBtn');
    const btnText = saveBtn.querySelector('.btn-text');
    const btnLoading = saveBtn.querySelector('.btn-loading');
    
    saveBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    try {
        const formData = new FormData(e.target);
        const dispensedMedicines = collectDispensedMedicines(formData);
        
        if (dispensedMedicines.length === 0) {
            throw new Error('Please select at least one medicine to dispense');
        }
        
        const dispensingData = {
            medicines: dispensedMedicines,
            totalMedicines: dispensedMedicines.length,
            dispensingNotes: formData.get('dispensingNotes') || '',
            recordedAt: firebase.firestore.Timestamp.now(),
            recordedBy: 'pharmacy-user'
        };
        
        await db.collection('patient_visits').doc(currentVisit.visitId).update({
            pharmacy: dispensingData,
            'journeyStatus.pharmacy.status': 'completed',
            'journeyStatus.pharmacy.timestamp': firebase.firestore.Timestamp.now(),
            'journeyStatus.pharmacy.by': 'pharmacy-user',
            isCompleted: true,
            updatedAt: firebase.firestore.Timestamp.now()
        });
        
        showAlert('Medicines dispensed successfully!', 'success');
        document.getElementById('successModal').style.display = 'block';
        
        await updatePharmacyStatistics();
        
    } catch (error) {
        console.error('Error dispensing medicines:', error);
        showAlert(error.message || 'Failed to dispense medicines', 'error');
    } finally {
        saveBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
}

// Collect dispensed medicines from form
function collectDispensedMedicines(formData) {
    const medicines = [];
    const checkboxes = document.querySelectorAll('.dispensing-checkbox');
    
    checkboxes.forEach((checkbox, index) => {
        if (checkbox.checked) {
            const medicineName = checkbox.closest('.dispensing-item').querySelector('.dispensing-medicine-name').textContent;
            const quantity = formData.get(`quantity-${index}`);
            const unit = formData.get(`unit-${index}`);
            const batch = formData.get(`batch-${index}`);
            const expiry = formData.get(`expiry-${index}`);
            
            if (quantity && parseInt(quantity) > 0) {
                medicines.push({
                    name: medicineName,
                    quantity: parseInt(quantity),
                    unit: unit || 'tablets',
                    batchNumber: batch || '',
                    expiryDate: expiry || '',
                    dispensedAt: firebase.firestore.Timestamp.now().toDate().toISOString()
                });
            }
        }
    });
    
    return medicines;
}

// Load medicine database
async function loadMedicineDatabase() {
    try {
        const medicinesSnapshot = await db.collection('medicines').get();
        availableMedicines = [];
        
        medicinesSnapshot.forEach(doc => {
            availableMedicines.push({ id: doc.id, ...doc.data() });
        });
        
        console.log(`Loaded ${availableMedicines.length} medicines from database`);
    } catch (error) {
        console.error('Error loading medicine database:', error);
    }
}

// Search medicines
async function searchMedicines() {
    const searchQuery = document.getElementById('medicineSearchInput').value.trim();
    const resultsContainer = document.getElementById('medicineResults');
    
    if (!searchQuery) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">💊</div>
                <h3>Medicine Database</h3>
                <p>Search for medicines above</p>
            </div>
        `;
        return;
    }
    
    try {
        resultsContainer.innerHTML = '<div class="loading">Searching medicines...</div>';
        
        const searchLower = searchQuery.toLowerCase();
        const matchingMedicines = availableMedicines.filter(medicine => 
            (medicine.name && medicine.name.toLowerCase().includes(searchLower)) ||
            (medicine.genericName && medicine.genericName.toLowerCase().includes(searchLower))
        );
        
        displayMedicineResults(matchingMedicines);
        
    } catch (error) {
        console.error('Error searching medicines:', error);
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Search Failed</h3>
                <p>Failed to search medicines</p>
            </div>
        `;
    }
}

// Display medicine search results
function displayMedicineResults(medicines) {
    const resultsContainer = document.getElementById('medicineResults');
    
    if (medicines.length === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <h3>No Medicines Found</h3>
                <p>No medicines match your search criteria</p>
            </div>
        `;
        return;
    }
    
    resultsContainer.innerHTML = '';
    
    medicines.forEach(medicine => {
        const medicineItem = document.createElement('div');
        medicineItem.className = 'medicine-result-item';
        medicineItem.innerHTML = `
            <div class="medicine-result-header">
                <div class="medicine-result-name">${medicine.name}</div>
                <div class="medicine-availability ${medicine.isActive ? 'available' : 'unavailable'}">
                    ${medicine.isActive ? 'Available' : 'Unavailable'}
                </div>
            </div>
            <div class="medicine-result-details">
                <span><strong>Generic:</strong> ${medicine.genericName || 'N/A'}</span>
                <span><strong>Strength:</strong> ${medicine.strength || 'N/A'}</span>
                <span><strong>Form:</strong> ${medicine.form || 'N/A'}</span>
            </div>
        `;
        resultsContainer.appendChild(medicineItem);
    });
}

// Load dispensing history - shows all dispensing across all camp days
async function loadDispensingHistory(patientId) {
    try {
        const historyContainer = document.getElementById('dispensingHistory');
        historyContainer.innerHTML = '<div class="loading">Loading dispensing history...</div>';
        
        // Get all visits for this patient in current camp
        const visitsSnapshot = await db.collection('patient_visits')
            .where('patientId', '==', patientId)
            .where('campId', '==', currentCamp.id)
            .get();
        
        const history = [];
        
        visitsSnapshot.forEach(doc => {
            const visitData = doc.data();
            
            if (visitData.journeyStatus?.pharmacy?.status === 'completed' &&
                visitData.pharmacy) {
                
                history.push({
                    visitId: doc.id,
                    visitDate: visitData.visitDate.toDate(),
                    dispensingData: visitData.pharmacy,
                    isCurrentVisit: doc.id === currentVisit.visitId
                });
            }
        });
        
        // Sort by visit date (newest first)
        history.sort((a, b) => b.visitDate.getTime() - a.visitDate.getTime());
        
        displayDispensingHistory(history);
        
    } catch (error) {
        console.error('Error loading dispensing history:', error);
        document.getElementById('dispensingHistory').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Loading Failed</h3>
                <p>Failed to load dispensing history</p>
            </div>
        `;
    }
}

// Display dispensing history
function displayDispensingHistory(history) {
    const historyContainer = document.getElementById('dispensingHistory');
    
    if (history.length === 0) {
        historyContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <h3>No Dispensing History</h3>
                <p>No previous medicine dispensing found for this patient in this camp</p>
            </div>
        `;
        return;
    }
    
    historyContainer.innerHTML = '';
    
    history.forEach(item => {
        const historyItem = document.createElement('div');
        historyItem.className = `history-item ${item.isCurrentVisit ? 'current-visit' : ''}`;
        
        const dispensingDate = item.visitDate.toLocaleDateString();
        const dispensingTime = item.dispensingData.recordedAt.toDate().toLocaleTimeString();
        const visitLabel = item.isCurrentVisit ? ' (Today\'s Visit)' : '';
        
        historyItem.innerHTML = `
            <div class="history-header">
                <div class="history-date">${dispensingDate} ${dispensingTime}${visitLabel}</div>
                <div class="history-by">by ${item.dispensingData.recordedBy}</div>
            </div>
            <div class="history-medicines">
                ${item.dispensingData.medicines.map(medicine => `
                    <div class="history-medicine">
                        <div class="history-medicine-name">${medicine.name}</div>
                        <div class="history-medicine-details">
                            ${medicine.quantity} ${medicine.unit} 
                            ${medicine.batchNumber ? `(Batch: ${medicine.batchNumber})` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            ${item.dispensingData.dispensingNotes ? `
                <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--gray-200);">
                    <small><strong>Notes:</strong> ${item.dispensingData.dispensingNotes}</small>
                </div>
            ` : ''}
        `;
        historyContainer.appendChild(historyItem);
    });
}

// Clear search
function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResultsSection').style.display = 'none';
    document.getElementById('readyPatientsSection').style.display = 'block';
}

// Clear dispensing form
function clearDispensingForm() {
    document.getElementById('dispensingForm').reset();
    
    // Reset all checkboxes and enable fields
    const checkboxes = document.querySelectorAll('.dispensing-checkbox');
    checkboxes.forEach((checkbox, index) => {
        checkbox.checked = true;
        toggleDispensingFields(index);
    });
    
    currentPatient = null;
    currentVisit = null;
    
    // Hide form and show empty state
    document.getElementById('dispensingForm').style.display = 'none';
    document.getElementById('noDispensingState').style.display = 'block';
    
    // Clear patient info
    document.getElementById('patientInfo').style.display = 'none';
    document.getElementById('noPatientState').style.display = 'block';
    
    // Clear history
    document.getElementById('dispensingHistory').innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <h3>No Patient Selected</h3>
            <p>Select a patient to view their dispensing history</p>
        </div>
    `;
}

// Update pharmacy statistics for selected day
async function updatePharmacyStatistics() {
    try {
        if (!currentCamp || !selectedOperatingDay) {
            document.getElementById('todayDispensed').textContent = '0';
            document.getElementById('pendingDispense').textContent = '0';
            return;
        }
        
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        const allVisits = await db.collection('patient_visits')
            .where('campId', '==', currentCamp.id)
            .get();
        
        let todayDispensedCount = 0;
        let pendingDispenseCount = 0;
        
        allVisits.forEach(doc => {
            const visit = doc.data();
            
            // Filter by selected day
            if (visit.visitDate) {
                const visitDate = visit.visitDate.toDate();
                if (visitDate < selectedDayStart || visitDate > selectedDayEnd) {
                    return; // Skip visits not on selected day
                }
            }
            
            // Count completed dispensing for selected day
            if (visit.journeyStatus?.pharmacy?.status === 'completed') {
                todayDispensedCount++;
            }
            
            // Count pending dispensing for selected day
            if (visit.journeyStatus?.doctor?.status === 'completed' &&
                visit.journeyStatus?.pharmacy?.status === 'pending') {
                pendingDispenseCount++;
            }
        });
        
        pharmacyStats.today = todayDispensedCount;
        pharmacyStats.pending = pendingDispenseCount;
        
        document.getElementById('todayDispensed').textContent = pharmacyStats.today;
        document.getElementById('pendingDispense').textContent = pharmacyStats.pending;
        
    } catch (error) {
        console.error('Error updating statistics:', error);
        document.getElementById('todayDispensed').textContent = '0';
        document.getElementById('pendingDispense').textContent = '0';
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

// Utility function to format date
function formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

// Utility function to format time
function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Export functions for global access
window.toggleDispensingFields = toggleDispensingFields;
window.showCampSelectionModal = showCampSelectionModal;