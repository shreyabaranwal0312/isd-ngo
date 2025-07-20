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
let consultationStats = { today: 0, pending: 0 };
let medicineCounter = 1;

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
            await updateConsultationStatistics();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showAlert('Failed to initialize application', 'error');
    }
}

// Setup event listeners
function setupEventListeners() {
    // Camp selection - UPDATED FOR MULTI-DAY
    const availableCampsSelect = document.getElementById('availableCamps');
    const operatingDaySelect = document.getElementById('operatingDaySelect');
    const selectCampBtn = document.getElementById('selectCampBtn');
    const refreshCampsBtn = document.getElementById('refreshCampsBtn');
    const changeCampBtn = document.getElementById('changeCampBtn');
    
    if (availableCampsSelect) availableCampsSelect.addEventListener('change', onCampSelectionChange);
    if (operatingDaySelect) operatingDaySelect.addEventListener('change', onOperatingDayChange);
    if (selectCampBtn) selectCampBtn.addEventListener('click', selectCamp);
    if (refreshCampsBtn) refreshCampsBtn.addEventListener('click', loadAvailableCamps);
    if (changeCampBtn) changeCampBtn.addEventListener('click', showCampSelectionModal);

    // Patient search
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    
    if (searchBtn) searchBtn.addEventListener('click', searchPatients);
    if (searchInput) {
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchPatients();
            }
        });
    }
    if (clearSearchBtn) clearSearchBtn.addEventListener('click', clearSearch);

    // Vitals tab controls - NEW
    document.addEventListener('click', function(e) {
        if (e.target && e.target.classList.contains('vitals-tab-btn')) {
            switchVitalsTab(e.target.dataset.tab);
        }
    });

    // Consultation form
    const consultationForm = document.getElementById('consultationForm');
    const clearConsultationBtn = document.getElementById('clearConsultationBtn');
    const addMedicineBtn = document.getElementById('addMedicineBtn');
    
    if (consultationForm) consultationForm.addEventListener('submit', handleConsultationSubmit);
    if (clearConsultationBtn) clearConsultationBtn.addEventListener('click', clearConsultationForm);
    if (addMedicineBtn) addMedicineBtn.addEventListener('click', addMedicineField);

    // Follow-up handling
    const followUpRequired = document.getElementById('followUpRequired');
    const referralRequired = document.getElementById('referralRequired');
    
    if (followUpRequired) followUpRequired.addEventListener('change', handleFollowUpChange);
    if (referralRequired) referralRequired.addEventListener('change', handleReferralChange);

    // Modal handling
    const continueBtn = document.getElementById('continueBtn');
    if (continueBtn) {
        continueBtn.addEventListener('click', function() {
            const successModal = document.getElementById('successModal');
            if (successModal) successModal.style.display = 'none';
            clearConsultationForm();
            loadReadyPatients();
        });
    }

    // Refresh data
    const refreshDataBtn = document.getElementById('refreshDataBtn');
    if (refreshDataBtn) {
        refreshDataBtn.addEventListener('click', function() {
            loadReadyPatients();
            updateConsultationStatistics();
        });
    }

    // Close modal on outside click
    window.addEventListener('click', function(event) {
        const campModal = document.getElementById('campSelectionModal');
        const successModal = document.getElementById('successModal');
        
        if (event.target === campModal) {
            campModal.style.display = 'none';
        }
        if (event.target === successModal) {
            successModal.style.display = 'none';
        }
    });
}

// Load available camps - UPDATED FOR MULTI-DAY
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

// Handle camp selection change - NEW
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

// Populate operating days - NEW
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

// Handle operating day change - NEW
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

// Display selected camp and day info - NEW
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
                <div class="camp-info-value" style="color: var(--doctor-purple); font-weight: 700;">${dateString}${todayIndicator}</div>
            </div>
            <div class="camp-info-item">
                <div class="camp-info-label">Sponsor</div>
                <div class="camp-info-value">${sponsorName}</div>
            </div>
        </div>
    `;
}

// Check for selected camp - UPDATED
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

// Select camp - UPDATED FOR MULTI-DAY
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
        await updateConsultationStatistics();
        
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

// Hide camp selection modal
function hideCampSelectionModal() {
    document.getElementById('campSelectionModal').style.display = 'none';
    
    // Reset modal state
    document.getElementById('availableCamps').value = '';
    document.getElementById('operatingDaySelect').innerHTML = '<option value="">Select a day</option>';
    document.getElementById('operatingDayGroup').style.display = 'none';
    document.getElementById('selectedCampInfo').style.display = 'none';
    document.getElementById('selectCampBtn').disabled = true;
}

// Load current camp - UPDATED
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

// Display camp info - UPDATED
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
                <span class="detail-value" style="color: var(--doctor-purple); font-weight: 600;">${selectedDateString}${todayIndicator}</span>
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

// Display no camp state
function displayNoCampState() {
    document.getElementById('campCard').innerHTML = `
        <div class="no-camp-state">
            <h3>⚠️ No Camp Selected</h3>
            <p>Please select a camp and operating day to start consultations</p>
            <button onclick="showCampSelectionModal()" class="btn-primary" style="margin-top: 0.5rem;">
                Select Camp & Day
            </button>
        </div>
    `;
}

// Load patients ready for consultation - UPDATED FOR SELECTED DAY
async function loadReadyPatients() {
    if (!currentCamp || !selectedOperatingDay) return;
    
    try {
        const readyPatientsList = document.getElementById('readyPatientsList');
        readyPatientsList.innerHTML = '<div class="loading">Loading patients...</div>';
        
        // Get visits for selected day only
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        // Get all patient visits for this camp
        const snapshot = await db.collection('patient_visits')
            .where('campId', '==', currentCamp.id)
            .get();
        
        const patients = [];
        
        // Filter on client-side for selected day and ready status
        for (const doc of snapshot.docs) {
            const visitData = doc.data();
            
            // Check if visit is for selected day
            if (visitData.visitDate) {
                const visitDate = visitData.visitDate.toDate();
                if (visitDate < selectedDayStart || visitDate > selectedDayEnd) {
                    continue; // Skip visits not on selected day
                }
            }
            
            // Check if vitals completed and doctor pending
            if (visitData.journeyStatus?.vitals?.status === 'completed' &&
                visitData.journeyStatus?.doctor?.status === 'pending') {
                
                try {
                    // Get patient details
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
        
        // Sort by vitals completion time
        patients.sort((a, b) => {
            const aTime = a.journeyStatus?.vitals?.timestamp || firebase.firestore.Timestamp.fromDate(new Date(0));
            const bTime = b.journeyStatus?.vitals?.timestamp || firebase.firestore.Timestamp.fromDate(new Date(0));
            return bTime.toMillis() - aTime.toMillis(); // Newest first
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
                <p>No patients are currently ready for consultation on the selected day</p>
            </div>
        `;
        return;
    }
    
    readyPatientsList.innerHTML = '';
    
    patients.forEach(patient => {
        const patientItem = document.createElement('div');
        patientItem.className = 'patient-item';
        
        // Check if this is today's visit
        const visitDate = patient.visitDate ? patient.visitDate.toDate() : new Date();
        const isToday = visitDate.toDateString() === new Date().toDateString();
        
        patientItem.innerHTML = `
            <div class="patient-item-header">
                <div class="patient-name">${patient.patientData.name}</div>
                <div class="patient-reg-no">${patient.patientData.registrationNo}</div>
            </div>
            <div class="patient-details">
                <span>${patient.patientData.age} years, ${patient.patientData.sex}</span>
                <span>Phone: ${patient.patientData.phone}</span>
            </div>
            ${isToday ? '<div class="patient-item-day-indicator today">Today</div>' : 
                       '<div class="patient-item-day-indicator">Selected Day</div>'}
        `;
        
        patientItem.addEventListener('click', () => selectPatient(patient));
        readyPatientsList.appendChild(patientItem);
    });
}

// Search patients - UPDATED FOR SELECTED DAY
async function searchPatients() {
    const searchQuery = document.getElementById('searchInput').value.trim();
    if (!searchQuery || !currentCamp) return;
    
    try {
        const searchResultsList = document.getElementById('searchResultsList');
        searchResultsList.innerHTML = '<div class="loading">Searching...</div>';
        
        // Show search results section
        document.getElementById('searchResultsSection').style.display = 'block';
        
        // Get all patient visits for this camp
        const visitsSnapshot = await db.collection('patient_visits')
            .where('campId', '==', currentCamp.id)
            .get();
        
        const matchingPatients = [];
        const searchLower = searchQuery.toLowerCase();
        
        // Filter by selected day and search terms
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        for (const visitDoc of visitsSnapshot.docs) {
            const visitData = visitDoc.data();
            
            // Check if visit is for selected day
            if (visitData.visitDate) {
                const visitDate = visitData.visitDate.toDate();
                if (visitDate < selectedDayStart || visitDate > selectedDayEnd) {
                    continue; // Skip visits not on selected day
                }
            }
            
            try {
                // Get patient details for each visit
                const patientDoc = await db.collection('patients').doc(visitData.patientId).get();
                
                if (patientDoc.exists) {
                    const patient = patientDoc.data();
                    
                    // Add null checks for all fields before searching
                    const patientName = patient.name || '';
                    const patientPhone = patient.phone || '';
                    const patientRegNo = patient.registrationNo || '';
                    
                    // Check if any field matches the search query
                    if (patientName.toLowerCase().includes(searchLower) ||
                        patientPhone.includes(searchQuery) ||
                        patientRegNo.toLowerCase().includes(searchLower)) {
                        
                        // Add patient with visit data
                        matchingPatients.push({
                            visitId: visitDoc.id,
                            patientId: patientDoc.id,
                            ...visitData,
                            patientData: patient
                        });
                    }
                }
            } catch (patientError) {
                console.error('Error loading patient details for search:', patientError);
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
                <div class="patient-name">${patient.patientData.name}</div>
                <div class="patient-reg-no">${patient.patientData.registrationNo}</div>
            </div>
            <div class="patient-details">
                <span>${patient.patientData.age} years, ${patient.patientData.sex}</span>
                <span>Phone: ${patient.patientData.phone}</span>
            </div>
        `;
        
        patientItem.addEventListener('click', () => selectPatient(patient));
        searchResultsList.appendChild(patientItem);
    });
}

// Select patient - UPDATED FOR MULTI-DAY
async function selectPatient(patient) {
    try {
        currentPatient = patient;
        currentVisit = patient;
        
        // Update UI to show selected patient
        document.querySelectorAll('.patient-item').forEach(item => {
            item.classList.remove('selected');
        });
        
        // Find and mark the clicked item as selected
        if (event && event.target) {
            const clickedItem = event.target.closest('.patient-item');
            if (clickedItem) {
                clickedItem.classList.add('selected');
            }
        }
        
        // Display patient information with vitals tabs
        await displayPatientInfo(patient);
        
        // Load patient history for all days of current camp
        await loadPatientHistory(patient.patientId);
        
        // Show consultation form and check if editing existing consultation
        await showConsultationForm();
        
        // Update status
        updatePatientStatus('Selected for consultation');
        
    } catch (error) {
        console.error('Error selecting patient:', error);
        showAlert('Failed to select patient: ' + error.message, 'error');
    }
}

// Display patient information - ENHANCED FOR MULTI-DAY
async function displayPatientInfo(patient) {
    const patientInfo = document.getElementById('patientInfo');
    const patientData = patient.patientData;
    
    // Show vitals tab controls
    document.getElementById('vitalsTabControls').style.display = 'flex';
    
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
        
        <!-- Current Visit Vitals -->
        <div id="currentVitalsTab" class="vitals-tab-content">
            <div class="patient-vitals">
                <div class="vitals-header">
                    <h4>📊 Current Visit Vitals</h4>
                </div>
                <div class="vitals-loading">Loading current vitals...</div>
            </div>
        </div>
        
        <!-- Previous Vitals Tab -->
        <div id="previousVitalsTab" class="vitals-tab-content" style="display: none;">
            <div class="previous-vitals-timeline">
                <div class="vitals-loading">Loading previous vitals...</div>
            </div>
        </div>
    `;
    
    // Add present complaint if available
    if (patientData.presentComplaint) {
        const complaintDiv = document.createElement('div');
        complaintDiv.className = 'patient-complaint';
        complaintDiv.innerHTML = `
            <h4>🩺 Present Complaint</h4>
            <div class="complaint-text">${patientData.presentComplaint}</div>
        `;
        patientInfo.appendChild(complaintDiv);
    }
    
    patientInfo.style.display = 'block';
    document.getElementById('noPatientState').style.display = 'none';
    
    // Load current visit vitals
    await loadCurrentVisitVitals(patient);
    
    // Load previous vitals from other days
    await loadPreviousVitals(patient.patientId);
}

// Switch vitals tab - NEW
function switchVitalsTab(tabType) {
    try {
        // Update tab buttons
        document.querySelectorAll('.vitals-tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Add active class to clicked button
        if (event && event.target) {
            event.target.classList.add('active');
        }
        
        // Show/hide tab content
        const currentTab = document.getElementById('currentVitalsTab');
        const previousTab = document.getElementById('previousVitalsTab');
        
        if (currentTab) {
            currentTab.style.display = tabType === 'current' ? 'block' : 'none';
        }
        if (previousTab) {
            previousTab.style.display = tabType === 'previous' ? 'block' : 'none';
        }
        
    } catch (error) {
        console.error('Error switching vitals tab:', error);
    }
}

// Load current visit vitals - NEW
async function loadCurrentVisitVitals(patient) {
    try {
        const currentVitalsTab = document.getElementById('currentVitalsTab');
        const vitalsSection = currentVitalsTab.querySelector('.patient-vitals');
        
        let vitalsData = null;
        let vitalsCompletedAt = null;
        
        // Get vitals from current visit
        if (patient.vitals) {
            vitalsData = patient.vitals;
            vitalsCompletedAt = patient.vitals.recordedAt;
        } else if (patient.visitId) {
            // Fetch fresh visit data
            const visitDoc = await db.collection('patient_visits').doc(patient.visitId).get();
            if (visitDoc.exists) {
                const visitData = visitDoc.data();
                if (visitData.vitals) {
                    vitalsData = visitData.vitals;
                    vitalsCompletedAt = visitData.vitals.recordedAt;
                }
            }
        }
        
        if (vitalsData) {
            vitalsSection.innerHTML = `
                <div class="vitals-header">
                    <h4>📊 Current Visit Vitals</h4>
                    ${vitalsCompletedAt ? `<span class="vitals-time">Recorded: ${formatDateTime(vitalsCompletedAt)}</span>` : ''}
                    ${vitalsData.recordedBy ? `<span class="vitals-recorded-by">By: ${vitalsData.recordedBy}</span>` : ''}
                </div>
                <div class="vitals-grid">
                    <div class="vital-item ${getVitalStatus(vitalsData.bp, 'bp')}">
                        <div class="vital-label">Blood Pressure</div>
                        <div class="vital-value">${vitalsData.bp || 'Not recorded'}</div>
                    </div>
                    <div class="vital-item ${getVitalStatus(vitalsData.heartRate, 'hr')}">
                        <div class="vital-label">Heart Rate</div>
                        <div class="vital-value">${vitalsData.heartRate ? vitalsData.heartRate + ' BPM' : 'Not recorded'}</div>
                    </div>
                    <div class="vital-item ${getVitalStatus(vitalsData.temperature, 'temp')}">
                        <div class="vital-label">Temperature</div>
                        <div class="vital-value">${vitalsData.temperature ? vitalsData.temperature + '°F' : 'Not recorded'}</div>
                    </div>
                    <div class="vital-item">
                        <div class="vital-label">Height</div>
                        <div class="vital-value">${vitalsData.height ? vitalsData.height + ' cm' : 'Not recorded'}</div>
                    </div>
                    <div class="vital-item">
                        <div class="vital-label">Weight</div>
                        <div class="vital-value">${vitalsData.weight ? vitalsData.weight + ' kg' : 'Not recorded'}</div>
                    </div>
                    <div class="vital-item ${getVitalStatus(vitalsData.bmi, 'bmi')}">
                        <div class="vital-label">BMI</div>
                        <div class="vital-value">${vitalsData.bmi || 'Not calculated'}</div>
                    </div>
                    <div class="vital-item ${getVitalStatus(vitalsData.respirationRate, 'rr')}">
                        <div class="vital-label">Respiration Rate</div>
                        <div class="vital-value">${vitalsData.respirationRate ? vitalsData.respirationRate + ' /min' : 'Not recorded'}</div>
                    </div>
                    <div class="vital-item ${getVitalStatus(vitalsData.hemoglobin, 'hb')}">
                        <div class="vital-label">Hemoglobin</div>
                        <div class="vital-value">${vitalsData.hemoglobin ? vitalsData.hemoglobin + ' g/dL' : 'Not recorded'}</div>
                    </div>
                    <div class="vital-item ${getVitalStatus(vitalsData.bloodGlucose, 'glucose')}">
                        <div class="vital-label">Blood Glucose</div>
                        <div class="vital-value">${vitalsData.bloodGlucose ? vitalsData.bloodGlucose + ' mg/dL' : 'Not recorded'}</div>
                    </div>
                    ${vitalsData.primarySymptoms ? `
                        <div class="vital-item symptoms-item">
                            <div class="vital-label">Primary Symptoms</div>
                            <div class="vital-value">${vitalsData.primarySymptoms}</div>
                        </div>
                    ` : ''}
                    ${vitalsData.additionalComplaints ? `
                        <div class="vital-item symptoms-item">
                            <div class="vital-label">Additional Complaints</div>
                            <div class="vital-value">${vitalsData.additionalComplaints}</div>
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            vitalsSection.innerHTML = `
                <div class="vitals-header">
                    <h4>📊 Current Visit Vitals</h4>
                </div>
                <div class="vitals-empty">
                    <div class="vitals-empty-icon">⚠️</div>
                    <p>No vital signs recorded for this visit yet</p>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error loading current vitals:', error);
        const vitalsSection = document.querySelector('#currentVitalsTab .patient-vitals');
        vitalsSection.innerHTML = `
            <div class="vitals-header">
                <h4>📊 Current Visit Vitals</h4>
            </div>
            <div class="vitals-empty">
                <div class="vitals-empty-icon">❌</div>
                <p>Error loading vital signs</p>
            </div>
        `;
    }
}

// Load previous vitals from other days - NEW
async function loadPreviousVitals(patientId) {
    try {
        const previousVitalsTab = document.getElementById('previousVitalsTab');
        const timelineContainer = previousVitalsTab.querySelector('.previous-vitals-timeline');
        
        // Get all visits for this patient and camp
        const visitsSnapshot = await db.collection('patient_visits')
            .where('patientId', '==', patientId)
            .where('campId', '==', currentCamp.id)
            .get();
        
        const vitalsHistory = [];
        
        visitsSnapshot.forEach(doc => {
            const visitData = doc.data();
            if (visitData.vitals && visitData.visitDate) {
                vitalsHistory.push({
                    visitDate: visitData.visitDate.toDate(),
                    vitals: visitData.vitals,
                    isCurrentDay: visitData.visitDate.toDate().toDateString() === selectedOperatingDay.toDateString()
                });
            }
        });
        
        // Sort by visit date (newest first)
        vitalsHistory.sort((a, b) => b.visitDate - a.visitDate);
        
        if (vitalsHistory.length === 0) {
            timelineContainer.innerHTML = `
                <div class="vitals-empty">
                    <div class="vitals-empty-icon">📊</div>
                    <p>No previous vitals found for this patient in current camp</p>
                </div>
            `;
            return;
        }
        
        timelineContainer.innerHTML = vitalsHistory.map(item => {
            const dateString = item.visitDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            return `
                <div class="vitals-timeline-item ${item.isCurrentDay ? 'current-day' : ''}">
                    <div class="vitals-timeline-header">
                        <div class="vitals-timeline-date">${dateString}</div>
                        <div class="vitals-timeline-indicator ${item.isCurrentDay ? 'current' : 'previous'}">
                            ${item.isCurrentDay ? 'Current Day' : 'Previous Day'}
                        </div>
                    </div>
                    <div class="vitals-grid">
                        <div class="vital-item">
                            <div class="vital-label">Blood Pressure</div>
                            <div class="vital-value">${item.vitals.bp || 'N/A'}</div>
                        </div>
                        <div class="vital-item">
                            <div class="vital-label">Heart Rate</div>
                            <div class="vital-value">${item.vitals.heartRate ? item.vitals.heartRate + ' BPM' : 'N/A'}</div>
                        </div>
                        <div class="vital-item">
                            <div class="vital-label">Temperature</div>
                            <div class="vital-value">${item.vitals.temperature ? item.vitals.temperature + '°F' : 'N/A'}</div>
                        </div>
                        <div class="vital-item">
                            <div class="vital-label">BMI</div>
                            <div class="vital-value">${item.vitals.bmi || 'N/A'}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading previous vitals:', error);
        const timelineContainer = document.querySelector('#previousVitalsTab .previous-vitals-timeline');
        timelineContainer.innerHTML = `
            <div class="vitals-empty">
                <div class="vitals-empty-icon">❌</div>
                <p>Error loading previous vitals</p>
            </div>
        `;
    }
}

// Helper function to get vital status class for color coding
function getVitalStatus(value, type) {
    if (!value) return '';
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return '';
    
    switch (type) {
        case 'bp':
            const [systolic, diastolic] = value.split('/').map(v => parseInt(v));
            if (systolic > 140 || diastolic > 90) return 'vital-high';
            if (systolic < 90 || diastolic < 60) return 'vital-low';
            return 'vital-normal';
        
        case 'hr':
            if (numValue > 100) return 'vital-high';
            if (numValue < 60) return 'vital-low';
            return 'vital-normal';
        
        case 'temp':
            if (numValue > 99.5) return 'vital-high';
            if (numValue < 97.0) return 'vital-low';
            return 'vital-normal';
        
        case 'rr':
            if (numValue > 20) return 'vital-high';
            if (numValue < 12) return 'vital-low';
            return 'vital-normal';
        
        case 'bmi':
            if (numValue > 30) return 'vital-high';
            if (numValue < 18.5) return 'vital-low';
            return 'vital-normal';
        
        case 'glucose':
            if (numValue > 140) return 'vital-high';
            if (numValue < 70) return 'vital-low';
            return 'vital-normal';
        
        case 'hb':
            if (numValue > 17) return 'vital-high';
            if (numValue < 12) return 'vital-low';
            return 'vital-normal';
        
        default:
            return '';
    }
}

// Helper function to format date and time
function formatDateTime(timestamp) {
    let date;
    if (timestamp && timestamp.toDate) {
        date = timestamp.toDate();
    } else if (timestamp) {
        date = new Date(timestamp);
    } else {
        return 'Unknown';
    }
    
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Show consultation form and check for existing consultation - UPDATED
async function showConsultationForm() {
    document.getElementById('consultationForm').style.display = 'block';
    document.getElementById('noConsultationState').style.display = 'none';
    
    // Check if there's already a consultation for this visit
    try {
        if (currentVisit.journeyStatus?.doctor?.status === 'completed' && 
            currentVisit.journeyStatus?.doctor?.data) {
            
            // Load existing consultation for editing
            const consultationData = currentVisit.journeyStatus.doctor.data;
            populateConsultationForm(consultationData);
            
            // Update form status to editing mode
            document.getElementById('isEditing').value = 'true';
            document.getElementById('consultationFormTitle').textContent = '🩺 Edit Medical Consultation';
            document.getElementById('consultationStatus').innerHTML = `
                <span class="progress-step editing">Editing</span>
            `;
            document.querySelector('.consultation-card').classList.add('editing');
            
            updatePatientStatus('Editing consultation');
        } else {
            // New consultation
            document.getElementById('isEditing').value = 'false';
            document.getElementById('consultationFormTitle').textContent = '🩺 Medical Consultation';
            document.getElementById('consultationStatus').innerHTML = `
                <span class="progress-step ready">Ready</span>
            `;
            document.querySelector('.consultation-card').classList.remove('editing');
            
            updatePatientStatus('Ready for consultation');
        }
    } catch (error) {
        console.error('Error checking consultation status:', error);
        updatePatientStatus('Ready for consultation');
    }
}

// Populate consultation form with existing data - NEW
function populateConsultationForm(consultationData) {
    document.getElementById('primaryDiagnosis').value = consultationData.primaryDiagnosis || '';
    document.getElementById('secondaryDiagnosis').value = consultationData.secondaryDiagnosis || '';
    document.getElementById('clinicalFindings').value = consultationData.clinicalFindings || '';
    document.getElementById('treatmentPlan').value = consultationData.treatmentPlan || '';
    document.getElementById('additionalNotes').value = consultationData.additionalNotes || '';
    
    // Populate follow-up fields
    document.getElementById('followUpRequired').value = consultationData.followUp?.required ? 'yes' : 'no';
    document.getElementById('followUpDate').value = consultationData.followUp?.date || '';
    document.getElementById('followUpType').value = consultationData.followUp?.type || '';
    
    // Populate referral fields
    document.getElementById('referralRequired').value = consultationData.referral?.required ? 'yes' : 'no';
    document.getElementById('referralSpecialty').value = consultationData.referral?.specialty || '';
    document.getElementById('referralUrgency').value = consultationData.referral?.urgency || '';
    document.getElementById('referralReason').value = consultationData.referral?.reason || '';
    
    // Populate medicines
    if (consultationData.medicines && consultationData.medicines.length > 0) {
        // Clear existing medicine fields except first one
        const medicinesContainer = document.querySelector('.medicines-container');
        const medicineItems = medicinesContainer.querySelectorAll('.medicine-item');
        for (let i = 1; i < medicineItems.length; i++) {
            medicineItems[i].remove();
        }
        
        medicineCounter = 1;
        
        consultationData.medicines.forEach((medicine, index) => {
            if (index > 0) {
                addMedicineField();
            }
            
            const medIndex = index + 1;
            document.getElementById(`medicine${medIndex}`).value = medicine.name || '';
            document.getElementById(`dosage${medIndex}`).value = medicine.dosage || '';
            document.getElementById(`frequency${medIndex}`).value = medicine.frequency || '';
            document.getElementById(`duration${medIndex}`).value = medicine.duration || '';
        });
    }
    
    // Trigger follow-up and referral change handlers
    handleFollowUpChange();
    handleReferralChange();
}

// Load patient history for all days of current camp - UPDATED
async function loadPatientHistory(patientId) {
    try {
        const historyContainer = document.getElementById('patientHistory');
        historyContainer.innerHTML = '<div class="loading">Loading patient history...</div>';
        
        // Get all visits for this patient and camp
        const snapshot = await db.collection('patient_visits')
            .where('patientId', '==', patientId)
            .where('campId', '==', currentCamp.id)
            .get();
        
        const history = [];
        
        // Filter completed consultations and collect data
        snapshot.forEach(doc => {
            const visitData = doc.data();
            
            if (visitData.journeyStatus?.doctor?.status === 'completed' &&
                visitData.journeyStatus?.doctor?.data) {
                
                history.push({
                    visitId: doc.id,
                    visitDate: visitData.visitDate.toDate(),
                    consultationData: visitData.journeyStatus.doctor.data,
                    isCurrentDay: visitData.visitDate.toDate().toDateString() === selectedOperatingDay.toDateString()
                });
            }
        });
        
        // Sort by visit date (newest first)
        history.sort((a, b) => b.visitDate - a.visitDate);
        
        if (history.length === 0) {
            historyContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <h3>No Previous Consultations</h3>
                    <p>This patient has no previous consultation history in current camp</p>
                </div>
            `;
            return;
        }
        
        historyContainer.innerHTML = '';
        
        history.forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = `history-item ${item.isCurrentDay ? 'current-day' : ''}`;
            
            const consultation = item.consultationData;
            const dateString = item.visitDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            
            historyItem.innerHTML = `
                <div class="history-header">
                    <div class="history-date">${dateString}</div>
                    <div class="history-actions">
                        ${item.isCurrentDay ? `
                            <button class="history-edit-btn" onclick="editConsultation('${item.visitId}')">
                                Edit
                            </button>
                        ` : ''}
                        <div class="history-type">${item.isCurrentDay ? 'Current Day' : 'Previous'}</div>
                    </div>
                </div>
                <div class="history-content">
                    <div class="history-diagnosis">
                        <strong>Primary Diagnosis:</strong> ${consultation.primaryDiagnosis}
                    </div>
                    ${consultation.secondaryDiagnosis ? `
                        <div class="history-diagnosis">
                            <strong>Secondary Diagnosis:</strong> ${consultation.secondaryDiagnosis}
                        </div>
                    ` : ''}
                    <div class="history-treatment">
                        <strong>Treatment Plan:</strong> ${consultation.treatmentPlan}
                    </div>
                    ${consultation.clinicalFindings ? `
                        <div class="history-treatment">
                            <strong>Clinical Findings:</strong> ${consultation.clinicalFindings}
                        </div>
                    ` : ''}
                    ${consultation.medicines && consultation.medicines.length > 0 ? `
                        <div class="history-medicines">
                            <h6>Prescribed Medicines:</h6>
                            <div class="medicine-list">
                                ${consultation.medicines.map(med => `
                                    <span class="medicine-tag">${med.name} - ${med.dosage} - ${med.frequency}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
            historyContainer.appendChild(historyItem);
        });
        
    } catch (error) {
        console.error('Error loading patient history:', error);
        document.getElementById('patientHistory').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Loading Failed</h3>
                <p>Failed to load patient consultation history</p>
            </div>
        `;
    }
}

// Edit consultation - NEW
async function editConsultation(visitId) {
    try {
        // Load the visit data
        const visitDoc = await db.collection('patient_visits').doc(visitId).get();
        if (!visitDoc.exists) {
            showAlert('Consultation not found', 'error');
            return;
        }
        
        const visitData = visitDoc.data();
        if (visitData.journeyStatus?.doctor?.data) {
            populateConsultationForm(visitData.journeyStatus.doctor.data);
            
            // Set editing mode
            document.getElementById('isEditing').value = 'true';
            document.getElementById('consultationFormTitle').textContent = '🩺 Edit Medical Consultation';
            document.getElementById('consultationStatus').innerHTML = `
                <span class="progress-step editing">Editing</span>
            `;
            document.querySelector('.consultation-card').classList.add('editing');
            
            // Scroll to form
            document.querySelector('.consultation-card').scrollIntoView({ behavior: 'smooth' });
            
            showAlert('Consultation loaded for editing', 'info');
        }
    } catch (error) {
        console.error('Error loading consultation for editing:', error);
        showAlert('Failed to load consultation', 'error');
    }
}

// Update patient status
function updatePatientStatus(statusText) {
    const statusElement = document.getElementById('patientStatus');
    statusElement.innerHTML = `
        <span class="status-icon">👨‍⚕️</span>
        <span class="status-text">${statusText}</span>
    `;
}

// Handle follow-up change
function handleFollowUpChange() {
    const followUpRequired = document.getElementById('followUpRequired').value;
    const followUpDate = document.getElementById('followUpDate');
    const followUpType = document.getElementById('followUpType');
    
    if (followUpRequired === 'yes') {
        followUpDate.required = true;
        followUpType.required = true;
        followUpDate.parentElement.style.opacity = '1';
        followUpType.parentElement.style.opacity = '1';
    } else {
        followUpDate.required = false;
        followUpType.required = false;
        followUpDate.parentElement.style.opacity = '0.5';
        followUpType.parentElement.style.opacity = '0.5';
        followUpDate.value = '';
        followUpType.value = '';
    }
}

// Handle referral change
function handleReferralChange() {
    const referralRequired = document.getElementById('referralRequired').value;
    const referralSpecialty = document.getElementById('referralSpecialty');
    const referralUrgency = document.getElementById('referralUrgency');
    const referralReason = document.getElementById('referralReason');
    
    if (referralRequired === 'yes') {
        referralSpecialty.required = true;
        referralUrgency.required = true;
        referralReason.required = true;
        referralSpecialty.parentElement.style.opacity = '1';
        referralUrgency.parentElement.style.opacity = '1';
        referralReason.parentElement.style.opacity = '1';
    } else {
        referralSpecialty.required = false;
        referralUrgency.required = false;
        referralReason.required = false;
        referralSpecialty.parentElement.style.opacity = '0.5';
        referralUrgency.parentElement.style.opacity = '0.5';
        referralReason.parentElement.style.opacity = '0.5';
        referralSpecialty.value = '';
        referralUrgency.value = '';
        referralReason.value = '';
    }
}

// Add medicine field
function addMedicineField() {
    medicineCounter++;
    const medicinesContainer = document.querySelector('.medicines-container');
    
    const medicineItem = document.createElement('div');
    medicineItem.className = 'medicine-item';
    medicineItem.innerHTML = `
        <button type="button" class="remove-medicine" onclick="removeMedicine(this)">×</button>
        <div class="form-row">
            <div class="form-group">
                <label for="medicine${medicineCounter}">Medicine Name</label>
                <input type="text" id="medicine${medicineCounter}" name="medicine${medicineCounter}" placeholder="e.g., Paracetamol 500mg">
            </div>
            <div class="form-group">
                <label for="dosage${medicineCounter}">Dosage</label>
                <input type="text" id="dosage${medicineCounter}" name="dosage${medicineCounter}" placeholder="e.g., 1 tablet">
            </div>
            <div class="form-group">
                <label for="frequency${medicineCounter}">Frequency</label>
                <select id="frequency${medicineCounter}" name="frequency${medicineCounter}">
                    <option value="">Select frequency</option>
                    <option value="Once daily">Once daily</option>
                    <option value="Twice daily">Twice daily</option>
                    <option value="Three times daily">Three times daily</option>
                    <option value="Four times daily">Four times daily</option>
                    <option value="As needed">As needed</option>
                </select>
            </div>
            <div class="form-group">
                <label for="duration${medicineCounter}">Duration</label>
                <input type="text" id="duration${medicineCounter}" name="duration${medicineCounter}" placeholder="e.g., 5 days">
            </div>
        </div>
    `;
    
    medicinesContainer.appendChild(medicineItem);
}

// Remove medicine field
function removeMedicine(button) {
    button.parentElement.remove();
}

// Handle consultation form submission - UPDATED FOR MULTI-DAY
async function handleConsultationSubmit(e) {
    e.preventDefault();
    
    if (!currentPatient || !currentVisit) {
        showAlert('Please select a patient first', 'error');
        return;
    }
    
    try {
        // Show loading
        const saveBtn = document.getElementById('saveConsultationBtn');
        saveBtn.querySelector('.btn-text').style.display = 'none';
        saveBtn.querySelector('.btn-loading').style.display = 'inline';
        saveBtn.disabled = true;
        
        // Collect form data
        const formData = new FormData(e.target);
        const consultationData = {
            patientId: currentPatient.patientId,
            visitId: currentVisit.visitId,
            campId: currentCamp.id,
            visitDate: selectedOperatingDay.toISOString().split('T')[0], // Store selected day
            consultationDate: new Date().toISOString(),
            primaryDiagnosis: formData.get('primaryDiagnosis'),
            secondaryDiagnosis: formData.get('secondaryDiagnosis'),
            clinicalFindings: formData.get('clinicalFindings'),
            treatmentPlan: formData.get('treatmentPlan'),
            additionalNotes: formData.get('additionalNotes'),
            medicines: collectMedicines(formData),
            followUp: {
                required: formData.get('followUpRequired') === 'yes',
                date: formData.get('followUpDate'),
                type: formData.get('followUpType')
            },
            referral: {
                required: formData.get('referralRequired') === 'yes',
                specialty: formData.get('referralSpecialty'),
                urgency: formData.get('referralUrgency'),
                reason: formData.get('referralReason')
            },
            doctorId: 'doctor-user', // Replace with actual doctor ID
            completedAt: new Date().toISOString()
        };
        
        // Update patient visit with consultation data
        await db.collection('patient_visits').doc(currentVisit.visitId).update({
            'journeyStatus.doctor.status': 'completed',
            'journeyStatus.doctor.data': consultationData,
            'journeyStatus.doctor.timestamp': firebase.firestore.Timestamp.now(),
            'journeyStatus.doctor.by': 'doctor-user',
            'journeyStatus.pharmacy.status': consultationData.medicines.length > 0 ? 'pending' : 'not_required',
            updatedAt: firebase.firestore.Timestamp.now()
        });
        
        // Create follow-up if required
        if (consultationData.followUp.required) {
            await createFollowUp(consultationData);
        }
        
        // Show success message
        const isEditing = document.getElementById('isEditing').value === 'true';
        showAlert(isEditing ? 'Consultation updated successfully' : 'Consultation saved successfully', 'success');
        document.getElementById('successModal').style.display = 'block';
        
        // Update current visit data
        currentVisit.journeyStatus = {
            ...currentVisit.journeyStatus,
            doctor: {
                status: 'completed',
                data: consultationData,
                timestamp: firebase.firestore.Timestamp.now(),
                by: 'doctor-user'
            }
        };
        
        // Update statistics and refresh patient history
        await updateConsultationStatistics();
        await loadPatientHistory(currentPatient.patientId);
        
        // Update form status
        document.getElementById('consultationStatus').innerHTML = `
            <span class="progress-step completed">Completed</span>
        `;
        document.querySelector('.consultation-card').classList.remove('editing');
        
    } catch (error) {
        console.error('Error saving consultation:', error);
        showAlert('Failed to save consultation', 'error');
    } finally {
        // Reset button
        const saveBtn = document.getElementById('saveConsultationBtn');
        saveBtn.querySelector('.btn-text').style.display = 'inline';
        saveBtn.querySelector('.btn-loading').style.display = 'none';
        saveBtn.disabled = false;
    }
}

// Collect medicines from form
function collectMedicines(formData) {
    const medicines = [];
    let counter = 1;
    
    while (formData.get(`medicine${counter}`)) {
        const medicineName = formData.get(`medicine${counter}`);
        if (medicineName.trim()) {
            medicines.push({
                name: medicineName,
                dosage: formData.get(`dosage${counter}`) || '',
                frequency: formData.get(`frequency${counter}`) || '',
                duration: formData.get(`duration${counter}`) || ''
            });
        }
        counter++;
    }
    
    return medicines;
}

// Create follow-up appointment
async function createFollowUp(consultationData) {
    const followUpData = {
        patientId: consultationData.patientId,
        originalVisitId: consultationData.visitId,
        campId: consultationData.campId,
        scheduledDate: consultationData.followUp.date,
        scheduledBy: 'doctor-user',
        type: consultationData.followUp.type,
        status: 'scheduled',
        createdAt: firebase.firestore.Timestamp.now(),
        notes: `Follow-up for: ${consultationData.primaryDiagnosis}`
    };
    
    await db.collection('followups').add(followUpData);
}

// Clear consultation form
function clearConsultationForm() {
    document.getElementById('consultationForm').reset();
    
    // Reset medicine counter and remove extra medicine fields
    medicineCounter = 1;
    const medicinesContainer = document.querySelector('.medicines-container');
    const medicineItems = medicinesContainer.querySelectorAll('.medicine-item');
    
    // Keep only the first medicine item
    for (let i = 1; i < medicineItems.length; i++) {
        medicineItems[i].remove();
    }
    
    // Reset editing state
    document.getElementById('isEditing').value = 'false';
    document.getElementById('consultationFormTitle').textContent = '🩺 Medical Consultation';
    document.getElementById('consultationStatus').innerHTML = `
        <span class="progress-step ready">Ready</span>
    `;
    document.querySelector('.consultation-card').classList.remove('editing');
    
    // Reset follow-up and referral fields
    handleFollowUpChange();
    handleReferralChange();
}

// Clear search
function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResultsSection').style.display = 'none';
}

// Update consultation statistics - UPDATED FOR SELECTED DAY
async function updateConsultationStatistics() {
    if (!currentCamp || !selectedOperatingDay) return;
    
    try {
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        // Get all visits for current camp
        const allVisitsSnapshot = await db.collection('patient_visits')
            .where('campId', '==', currentCamp.id)
            .get();
        
        let completedConsultations = 0;
        let pendingConsultations = 0;
        
        // Filter by selected day on client-side
        allVisitsSnapshot.forEach(doc => {
            const visit = doc.data();
            
            // Check if visit is for selected day
            if (visit.visitDate) {
                const visitDate = visit.visitDate.toDate();
                if (visitDate < selectedDayStart || visitDate > selectedDayEnd) {
                    return; // Skip visits not on selected day
                }
            }
            
            if (visit.journeyStatus?.doctor?.status === 'completed') {
                completedConsultations++;
            } else if (visit.journeyStatus?.vitals?.status === 'completed' &&
                       visit.journeyStatus?.doctor?.status === 'pending') {
                pendingConsultations++;
            }
        });
        
        // Update UI
        document.getElementById('todayConsultations').textContent = completedConsultations;
        document.getElementById('pendingConsultations').textContent = pendingConsultations;
        
        consultationStats = {
            today: completedConsultations,
            pending: pendingConsultations
        };
        
    } catch (error) {
        console.error('Error updating statistics:', error);
        document.getElementById('todayConsultations').textContent = 'Error';
        document.getElementById('pendingConsultations').textContent = 'Error';
    }
}

// Utility functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    
    alert.innerHTML = `
        <div class="alert-content">
            <div class="alert-icon">${icon}</div>
            <div class="alert-message">${message}</div>
            <button class="alert-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    alertContainer.appendChild(alert);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (alert.parentElement) {
            alert.remove();
        }
    }, 5000);
}

// Export functions for global access
window.removeMedicine = removeMedicine;
window.editConsultation = editConsultation;
window.showCampSelectionModal = showCampSelectionModal;