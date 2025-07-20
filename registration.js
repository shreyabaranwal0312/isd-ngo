const firebaseConfig = {
  apiKey: "AIzaSyDMNqYb2V90qdPUTCOkW6EiFuCHvI9JT2s",
  authDomain: "smart-attend-d476c.firebaseapp.com",
  projectId: "smart-attend-d476c",
  storageBucket: "smart-attend-d476c.appspot.com",
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
let editingPatient = null;
let todayStats = { registrations: 0, totalCampRegistrations: 0 };
let availableCamps = [];

// Initialize the application
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
            await generateNextRegistrationNumber();
            await loadRecentPatients();
            await updateStatistics();
        }
    } catch (error) {
        console.error('Initialization error:', error);
        showAlert('Failed to initialize application', 'error');
    }
}

function setupEventListeners() {
    // Search functionality
    document.getElementById('searchBtn').addEventListener('click', searchPatients);
    document.getElementById('clearSearchBtn').addEventListener('click', clearSearch);
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchPatients();
        }
    });
    
    // Form functionality
    document.getElementById('registrationForm').addEventListener('submit', handleFormSubmit);
    document.getElementById('clearFormBtn').addEventListener('click', clearForm);
    
    // Phone number validation
    document.getElementById('patientPhone').addEventListener('input', function(e) {
        e.target.value = e.target.value.replace(/\D/g, '').substring(0, 10);
        validatePhone(e.target.value);
    });
    
    // Age validation
    document.getElementById('patientAge').addEventListener('input', function(e) {
        validateAge(e.target.value);
    });
    
    // Quick actions
    document.getElementById('changeCampBtn').addEventListener('click', showCampSelectionModal);
    document.getElementById('refreshDataBtn').addEventListener('click', refreshAllData);
    
    // Camp selection modal
    document.getElementById('selectCampBtn').addEventListener('click', selectCamp);
    document.getElementById('refreshCampsBtn').addEventListener('click', loadAvailableCamps);
    document.getElementById('availableCamps').addEventListener('change', onCampSelectionChange);
    document.getElementById('operatingDaySelect').addEventListener('change', onOperatingDayChange);
    
    // Patient modal functionality
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('editPatientBtn').addEventListener('click', editPatient);
    
    // Close modals on outside click
    document.getElementById('patientModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeModal();
        }
    });
}

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
            
            // Format dates for display
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

// Format date range for display
function formatDateRange(dates) {
    if (dates.length === 0) return 'No dates';
    if (dates.length === 1) return dates[0].toLocaleDateString();
    
    const sortedDates = [...dates].sort((a, b) => a - b);
    const firstDate = sortedDates[0].toLocaleDateString();
    const lastDate = sortedDates[sortedDates.length - 1].toLocaleDateString();
    
    if (dates.length === 2) {
        return `${firstDate}, ${lastDate}`;
    }
    
    return `${firstDate} to ${lastDate}`;
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
            // Show operating day selection
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
    
    // Sort dates chronologically
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
        
        // Add "Today" indicator if it's today
        const today = new Date();
        const isToday = date.toDateString() === today.toDateString();
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
            <span style="color: var(--primary-blue); font-weight: 700;">${dateString}${todayIndicator}</span>
        </div>
        <div class="camp-info-detail">
            <label>Sponsor:</label>
            <span>${sponsorName}</span>
        </div>
        <div class="camp-info-detail">
            <label>Status:</label>
            <span style="color: var(--success-green); font-weight: 600;">${camp.status || 'Active'}</span>
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

function hideCampSelectionModal() {
    document.getElementById('campSelectionModal').style.display = 'none';
    
    // Reset modal state
    document.getElementById('availableCamps').value = '';
    document.getElementById('operatingDaySelect').innerHTML = '<option value="">Select a day</option>';
    document.getElementById('operatingDayGroup').style.display = 'none';
    document.getElementById('selectedCampInfo').style.display = 'none';
    document.getElementById('selectCampBtn').disabled = true;
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
        await generateNextRegistrationNumber();
        await loadRecentPatients();
        await updateStatistics();
        
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
            <span style="color: var(--primary-blue); font-weight: 600;">${selectedDateString}${todayIndicator}</span>
        </div>
        <div class="camp-detail">
            <label>Total Days</label>
            <span>${operatingDays.length} operating days</span>
        </div>
        <div class="camp-detail">
            <label>Status</label>
            <span class="camp-status">
                <span>🟢</span>
                ${currentCamp.status || 'Active'}
            </span>
        </div>
    `;
}

function displayNoCampState() {
    document.getElementById('campCard').innerHTML = `
        <div class="no-camp-state">
            <h3>⚠️ No Camp Selected</h3>
            <p>Please select a camp and operating day to start registering patients</p>
            <button onclick="showCampSelectionModal()" class="btn-primary" style="margin-top: 0.5rem;">
                Select Camp & Day
            </button>
        </div>
    `;
}

async function generateNextRegistrationNumber() {
    try {
        if (!currentCamp || !selectedOperatingDay) {
            document.getElementById('nextRegNumber').textContent = 'No camp/day selected';
            return;
        }
        
        const selectedDate = new Date(selectedOperatingDay);
        const dateStr = selectedDate.toISOString().slice(0, 10).replace(/-/g, '');
        const sponsorCode = currentSponsor ? currentSponsor.code : 'GEN';
        const prefix = `${dateStr}_${sponsorCode}_`;
        
        // Get all patients for this camp
        const patientsSnapshot = await db.collection('patients')
            .where('campId', '==', currentCamp.id)
            .get();
        
        let maxSequence = 0;
        patientsSnapshot.forEach(doc => {
            const patient = doc.data();
            const regNo = patient.registrationNo;
            
            if (regNo && regNo.startsWith(prefix)) {
                const sequence = parseInt(regNo.split('_')[2]);
                if (!isNaN(sequence) && sequence > maxSequence) {
                    maxSequence = sequence;
                }
            }
        });
        
        const nextSequence = maxSequence + 1;
        const nextRegNumber = `${prefix}${nextSequence.toString().padStart(3, '0')}`;
        document.getElementById('nextRegNumber').textContent = nextRegNumber;
        
    } catch (error) {
        console.error('Error generating registration number:', error);
        document.getElementById('nextRegNumber').textContent = 'Error';
    }
}

async function updateStatistics() {
    try {
        if (!currentCamp || !selectedOperatingDay) {
            document.getElementById('todayRegistrations').textContent = '0';
            document.getElementById('totalCampRegistrations').textContent = '0';
            return;
        }
        
        // Get all patients for current camp
        const allPatientsSnapshot = await db.collection('patients')
            .where('campId', '==', currentCamp.id)
            .get();
        
        // Get registrations for selected day (based on patient creation date, not visit date)
        const selectedDayStart = new Date(selectedOperatingDay);
        selectedDayStart.setHours(0, 0, 0, 0);
        const selectedDayEnd = new Date(selectedOperatingDay);
        selectedDayEnd.setHours(23, 59, 59, 999);
        
        let todayCount = 0;
        let totalCount = 0;
        
        allPatientsSnapshot.forEach(doc => {
            const patient = doc.data();
            totalCount++;
            
            // Check if patient was registered on the selected day
            if (patient.createdAt) {
                const createdAt = patient.createdAt.toDate();
                if (createdAt >= selectedDayStart && createdAt <= selectedDayEnd) {
                    todayCount++;
                }
            }
        });
        
        todayStats.registrations = todayCount;
        todayStats.totalCampRegistrations = totalCount;
        
        // Update UI
        document.getElementById('todayRegistrations').textContent = todayStats.registrations;
        document.getElementById('totalCampRegistrations').textContent = todayStats.totalCampRegistrations;
        
    } catch (error) {
        console.error('Error updating statistics:', error);
        document.getElementById('todayRegistrations').textContent = 'Error';
        document.getElementById('totalCampRegistrations').textContent = 'Error';
    }
}

async function searchPatients() {
    const searchTerm = document.getElementById('searchInput').value.trim();
    if (!searchTerm) {
        showAlert('Please enter a search term', 'warning');
        return;
    }
    
    if (!currentCamp) {
        showAlert('Please select a camp first', 'warning');
        return;
    }
    
    const resultsContainer = document.getElementById('searchResults');
    resultsContainer.innerHTML = '<div class="loading">Searching patients...</div>';
    
    try {
        // Get all patients for current camp
        const patientsSnapshot = await db.collection('patients')
            .where('campId', '==', currentCamp.id)
            .get();
        
        let results = [];
        
        patientsSnapshot.forEach(doc => {
            const patient = { id: doc.id, ...doc.data() };
            
            // Search by phone number (exact match)
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
                patient.name.toLowerCase().includes(searchTerm.toLowerCase())) {
                results.push(patient);
                return;
            }
        });
        
        // Remove duplicates
        results = results.filter((patient, index, self) => 
            index === self.findIndex(p => p.id === patient.id)
        );
        
        displaySearchResults(results);
        
    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Search Failed</h3>
                <p>Unable to search patients. Please try again.</p>
            </div>
        `;
    }
}

function displaySearchResults(patients, searchTerm) {
    const resultsContainer = document.getElementById('searchResults');
    
    if (patients.length === 0) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <h3>No Patients Found</h3>
                <p>Try searching with a different term</p>
            </div>
        `;
        return;
    }
    
    // Show count if multiple patients found with same phone
    let headerText = '';
    if (/^\d{10}$/.test(searchTerm) && patients.length > 1) {
        headerText = `<div style="background: var(--light-blue); color: var(--primary-blue); padding: 0.5rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem; font-weight: 600;">
            Found ${patients.length} patients with phone number: ${searchTerm}
        </div>`;
    }
    
    resultsContainer.innerHTML = headerText + patients.map(patient => `
        <div class="patient-card" onclick="showPatientDetails('${patient.id}')">
            <h4>${patient.name}</h4>
            <p><strong>Reg No:</strong> <span class="reg-number">${patient.registrationNo}</span></p>
            <p><strong>Phone:</strong> ${patient.phone}</p>
            <p><strong>Age:</strong> ${patient.age} | <strong>Gender:</strong> ${patient.sex}</p>
            <p><strong>Category:</strong> ${patient.category}</p>
        </div>
    `).join('');
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    if (!currentCamp) {
        showAlert('Please select a camp first', 'error');
        return;
    }
    
    if (!validateForm()) {
        return;
    }
    
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoading = submitBtn.querySelector('.btn-loading');
    
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    
    try {
        const formData = new FormData(e.target);
        const patientData = {
            registrationNo: document.getElementById('nextRegNumber').textContent,
            name: formData.get('name').trim(),
            age: parseInt(formData.get('age')),
            sex: formData.get('sex'),
            phone: formData.get('phone'),
            address: formData.get('address').trim(),
            category: formData.get('category'),
            education: formData.get('education').trim() || '',
            occupation: formData.get('occupation').trim() || '',
            campId: currentCamp.id,
            sponsorId: currentCamp.sponsorId,
            createdAt: firebase.firestore.Timestamp.now(),
            createdBy: 'registration-user',
            isActive: true
        };
        
        // No duplicate phone validation needed - multiple patients can share phone numbers
        
        let patientId;
        if (editingPatient) {
            // Update existing patient
            await db.collection('patients').doc(editingPatient.id).update({
                ...patientData,
                updatedAt: firebase.firestore.Timestamp.now()
            });
            patientId = editingPatient.id;
            showAlert('Patient updated successfully!', 'success');
        } else {
            // Create new patient
            const docRef = await db.collection('patients').add(patientData);
            patientId = docRef.id;
            showAlert('Patient registered successfully!', 'success');
            
            // Create initial patient visit record for new registrations
            const visitData = {
                patientId: patientId,
                campId: currentCamp.id,
                visitDate: firebase.firestore.Timestamp.fromDate(selectedOperatingDay),
                visitType: 'new',
                journeyStatus: {
                    registration: {
                        status: 'completed',
                        timestamp: firebase.firestore.Timestamp.now(),
                        by: 'registration-user'
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
                presentComplaint: formData.get('presentComplaint') || '',
                currentTreatment: formData.get('currentTreatment') || '',
                createdAt: firebase.firestore.Timestamp.now(),
                isCompleted: false
            };
            
            await db.collection('patient_visits').add(visitData);
        }
        
        // Reset form and refresh data
        clearForm();
        await generateNextRegistrationNumber();
        await loadRecentPatients();
        await updateStatistics();
        
    } catch (error) {
        console.error('Registration error:', error);
        showAlert(error.message || 'Registration failed', 'error');
    } finally {
        submitBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
        editingPatient = null;
    }
}

function validateForm() {
    let isValid = true;
    
    // Clear previous errors
    document.querySelectorAll('.form-group.error').forEach(group => {
        group.classList.remove('error');
    });
    
    // Validate required fields
    const requiredFields = ['patientName', 'patientAge', 'patientSex', 'patientPhone', 'patientCategory', 'patientAddress'];
    
    requiredFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (!field.value.trim()) {
            showFieldError(fieldId, 'This field is required');
            isValid = false;
        }
    });
    
    // Validate phone number
    const phone = document.getElementById('patientPhone').value;
    if (phone && !/^\d{10}$/.test(phone)) {
        showFieldError('patientPhone', 'Please enter a valid 10-digit phone number');
        isValid = false;
    }
    
    // Validate age
    const age = parseInt(document.getElementById('patientAge').value);
    if (age && (age < 1 || age > 120)) {
        showFieldError('patientAge', 'Please enter a valid age between 1 and 120');
        isValid = false;
    }
    
    return isValid;
}

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

function validatePhone(phone) {
    const phoneField = document.getElementById('patientPhone');
    const formGroup = phoneField.closest('.form-group');
    
    if (phone.length === 10) {
        formGroup.classList.remove('error');
        // No duplicate checking needed - multiple patients can share phone numbers
    } else if (phone.length > 0) {
        showFieldError('patientPhone', 'Phone number must be 10 digits');
    }
}

// Remove the checkDuplicatePhone function as it's no longer needed

function validateAge(age) {
    const ageValue = parseInt(age);
    if (age && (ageValue < 1 || ageValue > 120)) {
        showFieldError('patientAge', 'Age must be between 1 and 120');
    }
}

function clearForm() {
    document.getElementById('registrationForm').reset();
    document.querySelectorAll('.form-group.error').forEach(group => {
        group.classList.remove('error');
    });
    editingPatient = null;
    
    // Update form header
    document.getElementById('formTitle').innerHTML = '👤 New Patient Registration';
}

async function loadRecentPatients() {
    try {
        if (!currentCamp) {
            document.getElementById('recentPatients').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <h3>No Camp Selected</h3>
                    <p>Select a camp to view registrations</p>
                </div>
            `;
            return;
        }
        
        const recentContainer = document.getElementById('recentPatients');
        recentContainer.innerHTML = '<div class="loading">Loading recent registrations...</div>';
        
        try {
            // Get ALL patients for current camp (without ordering first)
            const campPatientsSnapshot = await db.collection('patients')
                .where('campId', '==', currentCamp.id)
                .get();
            
            if (campPatientsSnapshot.empty) {
                recentContainer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">📋</div>
                        <h3>No Registrations</h3>
                        <p>No patient registrations found for this camp</p>
                        <button onclick="loadRecentPatients()" class="btn-secondary" style="margin-top: 1rem;">
                            Refresh
                        </button>
                    </div>
                `;
                return;
            }
            
            // Convert to array and sort in JavaScript
            const patients = [];
            campPatientsSnapshot.forEach(doc => {
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
                let registrationTime = '';
                let dayIndicator = '';
                let availabilityText = '';
                
                try {
                    if (patient.createdAt) {
                        const regDate = patient.createdAt.toDate();
                        registrationDate = regDate.toLocaleDateString();
                        registrationTime = regDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        
                        // Check if patient was registered on the selected operating day
                        if (selectedOperatingDay) {
                            const selectedDay = new Date(selectedOperatingDay);
                            if (regDate.toDateString() === selectedDay.toDateString()) {
                                dayIndicator = ' 🌟';
                                availabilityText = 'Registered today';
                            } else {
                                availabilityText = 'Available for visits';
                            }
                        } else {
                            availabilityText = 'Available for visits';
                        }
                        
                        // Show if registered today (actual today)
                        const today = new Date();
                        if (regDate.toDateString() === today.toDateString()) {
                            dayIndicator += ' 🆕';
                        }
                    } else {
                        availabilityText = 'Available for visits';
                    }
                } catch (error) {
                    console.error('Error formatting date:', error);
                    availabilityText = 'Available for visits';
                }
                
                return `
                    <div class="recent-item" onclick="showPatientDetails('${patient.id}')">
                        <h4>${patient.name || 'Unknown Name'}${dayIndicator}</h4>
                        <p class="reg-no">${patient.registrationNo || 'No Reg Number'}</p>
                        <p><strong>Phone:</strong> ${patient.phone || 'N/A'}</p>
                        <p><strong>Age:</strong> ${patient.age || 'N/A'} | <strong>Gender:</strong> ${patient.sex || 'N/A'}</p>
                        <p><strong>Status:</strong> <span style="color: var(--success-green); font-weight: 500;">${availabilityText}</span></p>
                    </div>
                `;
            }).join('');
            
            console.log(`Loaded ${recentPatients.length} recent patients from camp: ${currentCamp.name}`);
            
        } catch (firestoreError) {
            console.error('Error querying patients for camp:', firestoreError);
            
            // Show error with camp info
            recentContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">❌</div>
                    <h3>Query Failed</h3>
                    <p>Failed to load patients for camp: ${currentCamp.name}</p>
                    <p style="font-size: 0.8rem; color: var(--gray-500);">Error: ${firestoreError.message}</p>
                    <button onclick="loadRecentPatients()" class="btn-secondary" style="margin-top: 1rem;">
                        Try Again
                    </button>
                </div>
            `;
        }
        
    } catch (error) {
        console.error('Error loading recent patients:', error);
        document.getElementById('recentPatients').innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <h3>Loading Failed</h3>
                <p>Failed to load recent registrations</p>
                <button onclick="loadRecentPatients()" class="btn-secondary" style="margin-top: 1rem;">
                    Try Again
                </button>
            </div>
        `;
    }
}

async function showPatientDetails(patientId) {
    try {
        const patientDoc = await db.collection('patients').doc(patientId).get();
        if (!patientDoc.exists) {
            showAlert('Patient not found', 'error');
            return;
        }
        
        const patient = patientDoc.data();
        const createdDate = patient.createdAt.toDate().toLocaleDateString();
        const createdTime = patient.createdAt.toDate().toLocaleTimeString();
        
        document.getElementById('modalBody').innerHTML = `
            <div class="patient-detail">
                <div class="detail-group">
                    <label>Registration Number</label>
                    <span style="font-family: 'Courier New', monospace; font-weight: 700; color: var(--success-green);">${patient.registrationNo}</span>
                </div>
                <div class="detail-group">
                    <label>Registration Date</label>
                    <span>${createdDate} ${createdTime}</span>
                </div>
                <div class="detail-group">
                    <label>Full Name</label>
                    <span>${patient.name}</span>
                </div>
                <div class="detail-group">
                    <label>Age</label>
                    <span>${patient.age} years</span>
                </div>
                <div class="detail-group">
                    <label>Gender</label>
                    <span>${patient.sex}</span>
                </div>
                <div class="detail-group">
                    <label>Phone Number</label>
                    <span>${patient.phone}</span>
                </div>
                <div class="detail-group">
                    <label>Category</label>
                    <span>${patient.category}</span>
                </div>
                <div class="detail-group">
                    <label>Education</label>
                    <span>${patient.education || 'Not specified'}</span>
                </div>
                <div class="detail-group">
                    <label>Occupation</label>
                    <span>${patient.occupation || 'Not specified'}</span>
                </div>
                <div class="detail-group full-width">
                    <label>Address</label>
                    <span>${patient.address}</span>
                </div>
            </div>
        `;
        
        // Store patient data for editing
        editingPatient = { id: patientId, ...patient };
        
        // Show modal
        document.getElementById('patientModal').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading patient details:', error);
        showAlert('Failed to load patient details', 'error');
    }
}

function editPatient() {
    if (!editingPatient) return;
    
    // Populate form with patient data
    document.getElementById('patientName').value = editingPatient.name;
    document.getElementById('patientAge').value = editingPatient.age;
    document.getElementById('patientSex').value = editingPatient.sex;
    document.getElementById('patientPhone').value = editingPatient.phone;
    document.getElementById('patientCategory').value = editingPatient.category;
    document.getElementById('patientAddress').value = editingPatient.address;
    document.getElementById('patientEducation').value = editingPatient.education || '';
    document.getElementById('patientOccupation').value = editingPatient.occupation || '';
    
    // Update form header
    document.getElementById('formTitle').innerHTML = '✏️ Edit Patient Registration';
    document.getElementById('nextRegNumber').textContent = editingPatient.registrationNo;
    
    // Close modal
    closeModal();
    
    // Scroll to form
    document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth' });
}

function closeModal() {
    document.getElementById('patientModal').style.display = 'none';
    editingPatient = null;
}

async function refreshAllData() {
    try {
        showAlert('Refreshing data...', 'info');
        await loadAvailableCamps();
        await loadCurrentCamp();
        await generateNextRegistrationNumber();
        await loadRecentPatients();
        await updateStatistics();
        showAlert('Data refreshed successfully!', 'success');
    } catch (error) {
        console.error('Error refreshing data:', error);
        showAlert('Failed to refresh data', 'error');
    }
}

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