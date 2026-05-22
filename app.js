// --- Application State ---
let selectedAttractions = [];
let geocodeCache = {};
let map = null;
let mapMarkers = [];
let routePolyline = null;
let routingControl = null;
let pendingAddAttraction = null;
let pendingReplaceAttraction = null;

// Default map center (Praça da Sé, São Paulo)
const SAO_PAULO_CENTER = [-23.5505, -46.6333];

// Cache key for localStorage
const LOCAL_STORAGE_KEY_ATTRACTIONS = 'virada_sp_selected_attractions';
const LOCAL_STORAGE_KEY_GEOCODE = 'virada_sp_geocode_cache_v1';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadCachedData();
    initAppNav();
    initSearchAndFilters();
    initConflictModal();
    renderAttractionsList();
    updateSelectedBadge();
    
    // Initialize map in the background (or when Map tab is active)
    initMap();
    
    // Initialize Match elements
    initMatchDragEvents();
    initMatchControls();
    
    // Initial run of itinerary updates
    updateItineraryView();

    // Initialize Sharing and Match modal events
    initSharingEvents();
    
    // Check if we have a shared itinerary in the URL
    checkSharedItinerary();
});

// --- Local Storage Caching ---
function loadCachedData() {
    // Load selected attractions
    const cachedSelected = localStorage.getItem(LOCAL_STORAGE_KEY_ATTRACTIONS);
    if (cachedSelected) {
        try {
            selectedAttractions = JSON.parse(cachedSelected);
        } catch (e) {
            selectedAttractions = [];
        }
    }
    
    // Load geocode cache
    const cachedGeocode = localStorage.getItem(LOCAL_STORAGE_KEY_GEOCODE);
    if (cachedGeocode) {
        try {
            geocodeCache = JSON.parse(cachedGeocode);
        } catch (e) {
            geocodeCache = {};
        }
    }
}

function saveSelectedToCache() {
    localStorage.setItem(LOCAL_STORAGE_KEY_ATTRACTIONS, JSON.stringify(selectedAttractions));
}

function saveGeocodeToCache() {
    localStorage.setItem(LOCAL_STORAGE_KEY_GEOCODE, JSON.stringify(geocodeCache));
}

// --- Navigation Tabs ---
function initAppNav() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });
}

function switchTab(tabId) {
    // Update active nav button
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update active section
    document.querySelectorAll('.app-section').forEach(section => {
        section.classList.remove('active');
    });
    
    const activeSection = document.getElementById(`section-${tabId}`);
    activeSection.classList.add('active');
    
    // Special action on map tab activation
    if (tabId === 'map') {
        setTimeout(() => {
            if (map) {
                map.invalidateSize();
                fitMapToMarkers();
            }
        }, 100);
    }
    
    // Special action on match tab activation
    if (tabId === 'match') {
        initMatchDeck();
    }
}

// --- Region Classifier Helper ---
function getRegion(stage) {
    if (!stage) return 'centro';
    const s = stage.toLowerCase();
    
    if (s.includes('zl') || s.includes('belém') || s.includes('itaquera') || 
        s.includes('miguel') || s.includes('guaianases') || s.includes('sapopemba') || 
        s.includes('mateus') || s.includes('carmo') || s.includes('artur alvim') || 
        s.includes('cidade tiradentes') || s.includes('carrão') || s.includes('aricanduva') || 
        s.includes('jambeiro') || s.includes('penha') || s.includes('tatuapé') || s.includes('itaim')) {
        return 'zl';
    }
    if (s.includes('zn') || s.includes('santana') || s.includes('freguesia') || 
        s.includes('brasilândia') || s.includes('parada inglesa') || s.includes('tucuruvi') || 
        s.includes('casa verde') || s.includes('tremembé') || s.includes('jaçanã') || 
        s.includes('vila maria') || s.includes('perus') || s.includes('pirituba') || 
        s.includes('anhanguera') || s.includes('jaraguá')) {
        return 'zn';
    }
    if (s.includes('zs') || s.includes('sul') || s.includes('santo amaro') || 
        s.includes('interlagos') || s.includes('campo limpo') || s.includes('vergueiro') || 
        s.includes('ccsp') || s.includes('vila mariana') || s.includes('jabaquara') || 
        s.includes('capela') || s.includes('paraisópolis') || s.includes('grajaú') || 
        s.includes('ipiranga') || s.includes('mboi mirim') || s.includes('parelheiros') || 
        s.includes('heliópolis')) {
        return 'zs';
    }
    if (s.includes('zo') || s.includes('oeste') || s.includes('butantã') || 
        s.includes('pompeia') || s.includes('pinheiros') || s.includes('lapa') || 
        s.includes('oswald de andrade') || s.includes('barra funda')) {
        return 'zo';
    }
    
    // Default to Centro
    return 'centro';
}

// --- Time Conversion Helpers ---
function timeToMinutes(timeStr) {
    if (!timeStr || timeStr.toLowerCase().includes('confirmar') || timeStr.toLowerCase().includes('definir')) {
        return -1;
    }
    // Expected formats: "17h00", "07h30", "14h00"
    const cleaned = timeStr.replace(/[^0-9h]/g, '');
    const parts = cleaned.split('h');
    if (parts.length < 2) return -1;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) || 0;
    return h * 60 + m;
}

function getAbsoluteTime(day, timeStr) {
    const min = timeToMinutes(timeStr);
    if (min === -1) return 99999; // Put unconfirmed times at the end of the day
    
    let dayWeight = 0;
    if (day && day.toLowerCase().includes('24 de maio')) {
        dayWeight = 1440; // 24 hours later
    }
    
    return dayWeight + min;
}

// --- Search and Filters Logic ---
let activeFilters = {
    search: '',
    day: 'all',
    region: 'all'
};

function initSearchAndFilters() {
    const searchInput = document.getElementById('search-input');
    const clearSearch = document.getElementById('clear-search');
    
    searchInput.addEventListener('input', (e) => {
        activeFilters.search = e.target.value.toLowerCase().trim();
        if (activeFilters.search) {
            clearSearch.classList.remove('hidden');
        } else {
            clearSearch.classList.add('hidden');
        }
        renderAttractionsList();
    });
    
    clearSearch.addEventListener('click', () => {
        searchInput.value = '';
        activeFilters.search = '';
        clearSearch.classList.add('hidden');
        renderAttractionsList();
    });
    
    // Day filter pills
    const dayPills = document.querySelectorAll('#day-filters .pill');
    dayPills.forEach(pill => {
        pill.addEventListener('click', () => {
            dayPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            activeFilters.day = pill.getAttribute('data-day');
            renderAttractionsList();
        });
    });
    
    // Region filter pills
    const regionPills = document.querySelectorAll('#region-filters .pill');
    regionPills.forEach(pill => {
        pill.addEventListener('click', () => {
            regionPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            activeFilters.region = pill.getAttribute('data-region');
            renderAttractionsList();
        });
    });
}

// --- Render Attractions List ---
function renderAttractionsList() {
    const listContainer = document.getElementById('attractions-list');
    const countDisplay = document.getElementById('results-count');
    
    // Filter data
    const filtered = ATTRACTIONS_DATA.filter(item => {
        // Search filter
        const matchSearch = !activeFilters.search || 
            item.nome.toLowerCase().includes(activeFilters.search) || 
            item.palco.toLowerCase().includes(activeFilters.search) || 
            item.endereco.toLowerCase().includes(activeFilters.search);
            
        // Day filter
        const matchDay = activeFilters.day === 'all' || item.dia === activeFilters.day;
        
        // Region filter
        const matchRegion = activeFilters.region === 'all' || getRegion(item.palco) === activeFilters.region;
        
        return matchSearch && matchDay && matchRegion;
    });
    
    // Sort filtered attractions: chronologically by default
    filtered.sort((a, b) => getAbsoluteTime(a.dia, a.horario) - getAbsoluteTime(b.dia, b.horario));
    
    countDisplay.textContent = `${filtered.length} atração(ões) encontrada(s)`;
    
    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>Nenhuma atração corresponde aos filtros aplicados. Tente ajustar sua busca!</p>
            </div>
        `;
        return;
    }
    
    // Generate HTML for cards
    listContainer.innerHTML = filtered.map(item => {
        const isSelected = selectedAttractions.some(sel => sel.nome === item.nome && sel.dia === item.dia && sel.horario === item.horario);
        
        const regionClass = getRegion(item.palco);
        let regionLabel = "Centro";
        if (regionClass === 'zl') regionLabel = "Z. Leste";
        if (regionClass === 'zn') regionLabel = "Z. Norte";
        if (regionClass === 'zs') regionLabel = "Z. Sul";
        if (regionClass === 'zo') regionLabel = "Z. Oeste";
        
        return `
            <div class="card" data-id="${item.nome}-${item.dia}-${item.horario}">
                <div class="card-info">
                    <h3 class="card-title">${item.nome}</h3>
                    <div class="card-meta">
                        <span class="card-badge date">${item.dia}</span>
                        <span class="card-badge time">${item.horario}</span>
                        <span class="card-badge region">${regionLabel}</span>
                    </div>
                    <div class="card-details">
                        <span class="card-stage">${item.palco}</span>
                        <span class="card-address">${item.endereco}</span>
                    </div>
                </div>
                <div class="card-action">
                    ${isSelected ? `
                        <button class="btn-remove" onclick="event.stopPropagation(); removeAttraction('${item.nome}', '${item.dia}', '${item.horario}')">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </button>
                    ` : `
                        <button class="btn-add" onclick="event.stopPropagation(); tryAddAttraction('${item.nome}', '${item.dia}', '${item.horario}')">
                            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="3" fill="none"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

// --- Itinerary Add/Remove Logic & Conflict Resolution ---
function tryAddAttraction(nome, dia, horario) {
    const attraction = ATTRACTIONS_DATA.find(item => item.nome === nome && item.dia === dia && item.horario === horario);
    if (!attraction) return;
    
    // Check for conflict
    const absoluteTime = getAbsoluteTime(dia, horario);
    
    // Don't flag conflict for unconfirmed times
    if (absoluteTime < 99999) {
        const conflicting = selectedAttractions.find(item => {
            const itemAbsTime = getAbsoluteTime(item.dia, item.horario);
            if (itemAbsTime === 99999) return false;
            
            // Conflict if they overlap (assume 60 minutes duration per show)
            return item.dia === dia && Math.abs(itemAbsTime - absoluteTime) < 60;
        });
        
        if (conflicting) {
            // Show Conflict Modal
            pendingAddAttraction = attraction;
            pendingReplaceAttraction = conflicting;
            showConflictModal(conflicting, attraction);
            return;
        }
    }
    
    // No conflict, just add
    addAttraction(attraction);
}

function addAttraction(attraction) {
    selectedAttractions.push(attraction);
    saveSelectedToCache();
    updateSelectedBadge();
    renderAttractionsList();
    updateItineraryView();
    triggerGeocodeForItinerary();
    updateMatchModalButtons();
}

function removeAttraction(nome, dia, horario) {
    selectedAttractions = selectedAttractions.filter(item => !(item.nome === nome && item.dia === dia && item.horario === horario));
    saveSelectedToCache();
    updateSelectedBadge();
    renderAttractionsList();
    updateItineraryView();
    triggerGeocodeForItinerary();
    updateMatchModalButtons();
}

function updateSelectedBadge() {
    const badge = document.getElementById('selected-badge');
    const countSpan = document.getElementById('selected-count');
    
    countSpan.textContent = selectedAttractions.length;
    
    if (selectedAttractions.length > 0) {
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// --- Conflict Modal Handlers ---
function initConflictModal() {
    const keepBtn = document.getElementById('conflict-option-keep');
    const replaceBtn = document.getElementById('conflict-option-replace');
    const cancelBtn = document.getElementById('conflict-cancel-btn');
    
    keepBtn.addEventListener('click', () => {
        hideConflictModal();
        handleConflictCancelled();
        pendingAddAttraction = null;
        pendingReplaceAttraction = null;
    });
    
    replaceBtn.addEventListener('click', () => {
        if (pendingReplaceAttraction && pendingAddAttraction) {
            // Remove the old one, add the new one
            selectedAttractions = selectedAttractions.filter(item => 
                !(item.nome === pendingReplaceAttraction.nome && 
                  item.dia === pendingReplaceAttraction.dia && 
                  item.horario === pendingReplaceAttraction.horario)
            );
            addAttraction(pendingAddAttraction);
        }
        hideConflictModal();
        pendingAddAttraction = null;
        pendingReplaceAttraction = null;
    });
    
    cancelBtn.addEventListener('click', () => {
        hideConflictModal();
        handleConflictCancelled();
        pendingAddAttraction = null;
        pendingReplaceAttraction = null;
    });
}

function showConflictModal(existing, incoming) {
    document.getElementById('conflict-keep-name').textContent = existing.nome;
    document.getElementById('conflict-keep-time').textContent = `${existing.dia} às ${existing.horario}`;
    document.getElementById('conflict-keep-stage').textContent = existing.palco;
    
    document.getElementById('conflict-replace-name').textContent = incoming.nome;
    document.getElementById('conflict-replace-time').textContent = `${incoming.dia} às ${incoming.horario}`;
    document.getElementById('conflict-replace-stage').textContent = incoming.palco;
    
    document.getElementById('conflict-modal').classList.remove('hidden');
}

function hideConflictModal() {
    document.getElementById('conflict-modal').classList.add('hidden');
}

// --- Update Itinerary Timeline ---
function updateItineraryView() {
    const emptyState = document.getElementById('itinerary-empty');
    const timeline = document.getElementById('itinerary-timeline');
    const shareBar = document.getElementById('itinerary-share-bar');
    
    if (shareBar) {
        if (selectedAttractions.length > 0) {
            shareBar.classList.remove('hidden');
        } else {
            shareBar.classList.add('hidden');
        }
    }
    
    if (selectedAttractions.length === 0) {
        emptyState.classList.remove('hidden');
        timeline.classList.add('hidden');
        return;
    }
    
    emptyState.classList.add('hidden');
    timeline.classList.remove('hidden');
    
    // Sort itinerary absolute chronologically
    const sorted = [...selectedAttractions].sort((a, b) => getAbsoluteTime(a.dia, a.horario) - getAbsoluteTime(b.dia, b.horario));
    
    let html = '';
    
    for (let idx = 0; idx < sorted.length; idx++) {
        const item = sorted[idx];
        const prevItem = idx > 0 ? sorted[idx - 1] : null;
        
        // Calculate transition times
        const absTime = getAbsoluteTime(item.dia, item.horario);
        const startTime = timeToMinutes(item.horario);
        
        // Suggestion calculations:
        // Arrive: 20 minutes before.
        // Leave: 60 minutes after (or when attraction ends).
        let arrivalTime = '';
        let departureTime = '';
        if (startTime !== -1) {
            let arrMin = startTime - 20;
            if (arrMin < 0) arrMin += 1440;
            const arrH = Math.floor(arrMin / 60).toString().padStart(2, '0');
            const arrM = (arrMin % 60).toString().padStart(2, '0');
            arrivalTime = `${arrH}h${arrM}`;
            
            const depMin = (startTime + 60) % 1440;
            const depH = Math.floor(depMin / 60).toString().padStart(2, '0');
            const depM = (depMin % 60).toString().padStart(2, '0');
            departureTime = `${depH}h${depM}`;
        } else {
            arrivalTime = '20 min antes';
            departureTime = 'Após término';
        }
        
        // Show Transition Alert if consecutive shows overlap or have very short gaps and are at different stages
        let transitionHtml = '';
        if (prevItem && prevItem.palco !== item.palco) {
            const prevAbsTime = getAbsoluteTime(prevItem.dia, prevItem.horario);
            const prevStart = timeToMinutes(prevItem.horario);
            
            if (prevAbsTime < 99999 && absTime < 99999) {
                // Gap in minutes from end of previous show (assume 60 min duration) to start of current show
                const gap = absTime - (prevAbsTime + 60);
                
                if (gap < 45) { // Warning if gap is less than 45 minutes to move stages
                    const gapText = gap < 0 ? `Sobreposição de ${Math.abs(gap)} min` : `${gap} min de intervalo`;
                    transitionHtml = `
                        <div class="transition-alert">
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                            <div>
                                <strong>Transição rápida!</strong> você tem apenas <strong>${gapText}</strong> para deslocar-se de <em>${prevItem.palco}</em> para <em>${item.palco}</em>.
                            </div>
                        </div>
                    `;
                }
            }
        }
        
        const mapsLink = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.palco + ', ' + item.endereco)}`;
        
        html += `
            ${transitionHtml}
            <div class="timeline-item">
                <div class="timeline-node"></div>
                <div class="timeline-card">
                    <div class="timeline-card-header">
                        <div class="timeline-time-group">
                            <span class="timeline-time">${item.horario}</span>
                            <span class="timeline-day">${item.dia}</span>
                        </div>
                        <button class="timeline-remove-btn" onclick="removeAttraction('${item.nome}', '${item.dia}', '${item.horario}')">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            Remover
                        </button>
                    </div>
                    <h3 class="timeline-title">${item.nome}</h3>
                    <div class="timeline-details">
                        <div class="timeline-stage">${item.palco}</div>
                        <div class="timeline-address">${item.endereco}</div>
                    </div>
                    <div class="timeline-suggestions">
                        <div class="suggestion-item suggestion-arrival">
                            <span class="suggestion-icon"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg></span>
                            <span>Chegar por volta de: <strong>${arrivalTime}</strong></span>
                        </div>
                        <div class="suggestion-item suggestion-departure">
                            <span class="suggestion-icon"><svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg></span>
                            <span>Saída sugerida: <strong>${departureTime}</strong></span>
                        </div>
                        <a href="${mapsLink}" target="_blank" rel="noopener" class="btn-directions">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
                            Direções (Google Maps)
                        </a>
                    </div>
                </div>
            </div>
        `;
    }
    
    timeline.innerHTML = html;
}

// --- Map View Logic (Leaflet Map) ---
function initMap() {
    // Check if element exists
    if (!document.getElementById('map')) return;
    
    // Create Leaflet Map
    map = L.map('map', {
        zoomControl: false, // will add custom position
        attributionControl: false
    }).setView(SAO_PAULO_CENTER, 13);
    
    // Add beautiful Dark Mode Tile Layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20
    }).addTo(map);
    
    // Add custom zoom control in a better location
    L.control.zoom({
        position: 'topright'
    }).addTo(map);
}

// Trigger Geocoding and updating Map
async function triggerGeocodeForItinerary() {
    if (selectedAttractions.length === 0) {
        clearMapMarkersAndRoutes();
        updateMapOverlayInfo();
        return;
    }
    
    // Sort itinerary chronologically to plot route correctly
    const sorted = [...selectedAttractions].sort((a, b) => getAbsoluteTime(a.dia, a.horario) - getAbsoluteTime(b.dia, b.horario));
    
    clearMapMarkersAndRoutes();
    
    const coordinates = [];
    
    for (let idx = 0; idx < sorted.length; idx++) {
        const item = sorted[idx];
        const cacheKey = `${item.palco}::${item.endereco}`;
        
        let latLng = geocodeCache[cacheKey];
        
        if (!latLng) {
            // Geocode dynamically
            latLng = await geocodeAddress(item.palco, item.endereco);
            if (latLng) {
                geocodeCache[cacheKey] = latLng;
                saveGeocodeToCache();
            }
        }
        
        if (latLng) {
            coordinates.push({
                coords: latLng,
                label: item.nome,
                stage: item.palco,
                time: item.horario,
                order: idx + 1
            });
        }
    }
    
    // Plot markers and draw routes
    plotCoordinates(coordinates);
    updateMapOverlayInfo(coordinates.length);
}

function clearMapMarkersAndRoutes() {
    // Remove markers
    mapMarkers.forEach(marker => map.removeLayer(marker));
    mapMarkers = [];
    
    // Remove polyline
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
    
    // Remove routing control
    if (routingControl) {
        try {
            map.removeControl(routingControl);
        } catch (e) {
            console.error('Error removing routing control:', e);
        }
        routingControl = null;
    }
}

// Call OpenStreetMap Nominatim Geocoding API
async function geocodeAddress(stageName, address) {
    try {
        // Clean address for better search results
        let cleanAddr = address
            .replace(/s\/nº?/gi, '') // remove s/n or s/nº
            .replace(/altura\s+\d+/gi, '') // remove "altura 950" style
            .replace(/Av\./g, 'Avenida')
            .replace(/R\./g, 'Rua')
            .replace(/Lg\./g, 'Largo')
            .replace(/Pq\./g, 'Parque')
            .replace(/Pq/g, 'Parque')
            .split('-')[0].trim(); // split at hyphen and take first part (usually street and number)
            
        // 1. Try Geocoding cleaned address
        let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanAddr + ', São Paulo, Brasil')}&format=json&limit=1`;
        let response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'ViradaCulturalItineraryApp/1.0' // OS guidelines: play nice
            }
        });
        let data = await response.json();
        
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
        
        // 2. Fallback: Geocode the stage name instead of address
        let cleanStage = stageName.replace(/Palcos?\s+(ZL|ZN|ZS|ZO)\s+–\s+/gi, '')
                                  .replace(/Centro\s+–\s+/gi, '')
                                  .replace(/Palco\s+/gi, '');
        url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanStage + ', São Paulo, Brasil')}&format=json&limit=1`;
        response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'ViradaCulturalItineraryApp/1.0'
            }
        });
        data = await response.json();
        
        if (data && data.length > 0) {
            return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
        
        // 3. Last fallback: return coordinates in downtown São Paulo + minor offset so markers don't overlap exactly
        const randomOffsetLat = (Math.random() - 0.5) * 0.01;
        const randomOffsetLng = (Math.random() - 0.5) * 0.01;
        return [SAO_PAULO_CENTER[0] + randomOffsetLat, SAO_PAULO_CENTER[1] + randomOffsetLng];
        
    } catch (error) {
        console.error('Geocoding error:', error);
        // Fallback in case of net error
        return [SAO_PAULO_CENTER[0] + (Math.random() - 0.5) * 0.01, SAO_PAULO_CENTER[1] + (Math.random() - 0.5) * 0.01];
    }
}

function plotCoordinates(points) {
    if (!map) return;
    
    const latLngs = [];
    
    points.forEach(point => {
        // Create custom divIcon for numbered numbered map node
        const icon = L.divIcon({
            className: 'custom-map-icon',
            html: `<div class="custom-map-marker" id="marker-order-${point.order}">${point.order}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        
        const marker = L.marker(point.coords, { icon: icon }).addTo(map);
        
        // Popup styling
        marker.bindPopup(`
            <div style="font-family: var(--font-body); color: #0d091a; padding: 4px;">
                <strong style="font-size: 1rem; color: var(--primary-dark); font-family: var(--font-header); display: block; margin-bottom: 2px;">#${point.order} - ${point.label}</strong>
                <span style="font-size: 0.8rem; display: block; margin-bottom: 4px;">Horário: <strong>${point.time}</strong></span>
                <span style="font-size: 0.75rem; color: #555; display: block;">Local: ${point.stage}</span>
            </div>
        `);
        
        mapMarkers.push(marker);
        latLngs.push(point.coords);
    });
    
    // Draw real-world street route using Leaflet Routing Machine
    if (latLngs.length > 1) {
        if (typeof L.Routing !== 'undefined') {
            const waypoints = latLngs.map(coord => L.latLng(coord[0], coord[1]));
            
            try {
                routingControl = L.Routing.control({
                    waypoints: waypoints,
                    router: L.Routing.osrmv1({
                        serviceUrl: 'https://router.project-osrm.org/route/v1',
                        profile: 'driving'
                    }),
                    lineOptions: {
                        styles: [
                            { color: '#000000', opacity: 0.45, weight: 7 }, // shadow glow
                            { color: '#ec4899', opacity: 0.85, weight: 4.5 } // main route line (pink)
                        ],
                        extendToWaypoints: true,
                        missingRouteTolerance: 100
                    },
                    createMarker: function() { return null; }, // Hide default markers
                    show: false,
                    addWaypoints: false,
                    draggableWaypoints: false,
                    fitSelectedRoutes: false
                }).addTo(map);
                
                routingControl.on('routesfound', function(e) {
                    const routes = e.routes;
                    if (routes && routes.length > 0) {
                        const summary = routes[0].summary;
                        updateMapOverlayInfoWithRouteDetails(points.length, summary.totalDistance, summary.totalTime);
                    }
                });
                
                routingControl.on('routingerror', function(e) {
                    console.warn('Routing error, falling back to straight lines:', e);
                    drawFallbackPolyline(latLngs);
                });
            } catch (err) {
                console.error('Error initializing Leaflet Routing Machine:', err);
                drawFallbackPolyline(latLngs);
            }
        } else {
            // Fallback if routing library not loaded
            drawFallbackPolyline(latLngs);
        }
    }
    
    fitMapToMarkers();
}

function drawFallbackPolyline(latLngs) {
    if (routePolyline) {
        map.removeLayer(routePolyline);
    }
    routePolyline = L.polyline(latLngs, {
        color: '#ec4899',
        dashArray: '8, 8',
        weight: 3.5,
        opacity: 0.8,
        lineJoin: 'round'
    }).addTo(map);
}

function updateMapOverlayInfoWithRouteDetails(activePointsCount, distanceMeters, durationSeconds) {
    const overlay = document.getElementById('map-overlay-info');
    const summary = document.getElementById('map-route-summary');
    
    if (activePointsCount === 0) {
        overlay.classList.add('hidden');
        return;
    }
    
    const distanceKm = (distanceMeters / 1000).toFixed(1);
    const durationMinutes = Math.round(durationSeconds / 60);
    let durationText = '';
    if (durationMinutes > 60) {
        const hours = Math.floor(durationMinutes / 60);
        const mins = durationMinutes % 60;
        durationText = `${hours}h${mins > 0 ? mins.toString().padStart(2, '0') : '00'}`;
    } else {
        durationText = `${durationMinutes} min`;
    }
    
    overlay.classList.remove('hidden');
    summary.innerHTML = `
        <h4>Seu Percurso da Virada</h4>
        <p>Conectando <strong>${activePointsCount} locais</strong> pelas ruas de SP.</p>
        <div style="margin-top: 6.5px; font-size: 0.82rem; opacity: 0.95; display: flex; gap: 14px; color: var(--accent-cyan); font-weight: 600;">
            <span style="display: flex; align-items: center; gap: 4px;">
                <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none" style="flex-shrink:0;"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon></svg>
                ${distanceKm} km no total
            </span>
            <span style="display: flex; align-items: center; gap: 4px;">
                <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.5" fill="none" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                ~${durationText} de viagem
            </span>
        </div>
    `;
}

function fitMapToMarkers() {
    if (!map || mapMarkers.length === 0) return;
    
    const group = L.featureGroup(mapMarkers);
    map.fitBounds(group.getBounds().pad(0.15));
}

function updateMapOverlayInfo(activePointsCount = 0) {
    const overlay = document.getElementById('map-overlay-info');
    const summary = document.getElementById('map-route-summary');
    
    if (activePointsCount === 0) {
        overlay.classList.add('hidden');
        return;
    }
    
    overlay.classList.remove('hidden');
    summary.innerHTML = `
        <h4>Seu Percurso da Virada</h4>
        <p>A rota conecta <strong>${activePointsCount} locais</strong> cronologicamente. Toque nos marcadores numerados para detalhes.</p>
    `;
}

// --- Tinder-Style Match Deck Logic ---

let matchQueue = [];

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function initMatchDeck() {
    const deck = document.getElementById('match-deck');
    const controls = document.getElementById('match-controls');
    const emptyState = document.getElementById('match-empty-state');
    if (!deck) return;
    
    // Clear existing cards
    const cards = deck.querySelectorAll('.match-card');
    cards.forEach(card => card.remove());
    
    // Filter queue for attractions that are already selected
    matchQueue = matchQueue.filter(item => 
        !selectedAttractions.some(sel => 
            sel.nome === item.nome && sel.dia === item.dia && sel.horario === item.horario
        )
    );
    
    // Populate queue if empty
    if (matchQueue.length === 0) {
        const unselected = ATTRACTIONS_DATA.filter(attr => 
            !selectedAttractions.some(sel => 
                sel.nome === attr.nome && sel.dia === attr.dia && sel.horario === attr.horario
            )
        );
        matchQueue = shuffle(unselected);
    }
    
    if (matchQueue.length === 0) {
        emptyState.classList.remove('hidden');
        if (controls) {
            controls.style.opacity = '0.3';
            controls.style.pointerEvents = 'none';
        }
        return;
    }
    
    emptyState.classList.add('hidden');
    if (controls) {
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'all';
    }
    
    // Render top 3 cards
    const countToRender = Math.min(matchQueue.length, 3);
    for (let i = countToRender - 1; i >= 0; i--) {
        const attraction = matchQueue[i];
        const card = createCardElement(attraction, i);
        deck.appendChild(card);
    }
}

function createCardElement(attraction, indexInDeck) {
    const card = document.createElement('div');
    card.className = 'match-card';
    card.dataset.nome = attraction.nome;
    card.dataset.dia = attraction.dia;
    card.dataset.horario = attraction.horario;
    
    if (indexInDeck === 0) {
        card.classList.add('top');
    } else if (indexInDeck === 1) {
        card.classList.add('second');
    } else if (indexInDeck === 2) {
        card.classList.add('third');
    } else {
        card.classList.add('hidden-card');
    }
    
    const regionClass = getRegion(attraction.palco);
    let regionLabel = "Centro";
    if (regionClass === 'zl') regionLabel = "Z. Leste";
    if (regionClass === 'zn') regionLabel = "Z. Norte";
    if (regionClass === 'zs') regionLabel = "Z. Sul";
    if (regionClass === 'zo') regionLabel = "Z. Oeste";
    
    card.innerHTML = `
        <div class="match-badge like">QUERO</div>
        <div class="match-badge nope">SKIP</div>
        <div class="match-card-content">
            <div class="match-card-header">
                <span class="card-badge date">${attraction.dia}</span>
                <span class="card-badge time">${attraction.horario}</span>
                <span class="card-badge region">${regionLabel}</span>
            </div>
            <div class="match-card-body">
                <h3 class="match-card-title">${attraction.nome}</h3>
                <div class="match-card-stage">${attraction.palco}</div>
            </div>
            <div class="match-card-footer">
                <div class="match-card-address">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                    <span>${attraction.endereco}</span>
                </div>
            </div>
        </div>
    `;
    return card;
}

let isDragging = false;
let startX = 0;
let startY = 0;
let currentX = 0;
let currentY = 0;
let dragCard = null;

function initMatchDragEvents() {
    const deck = document.getElementById('match-deck');
    if (!deck) return;
    
    // Mouse events
    deck.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', drag);
    window.addEventListener('mouseup', endDrag);
    
    // Touch events
    deck.addEventListener('touchstart', startDrag, { passive: true });
    window.addEventListener('touchmove', drag, { passive: false });
    window.addEventListener('touchend', endDrag);
}

function startDrag(e) {
    const card = e.target.closest('.match-card.top');
    if (!card) return;
    
    isDragging = true;
    dragCard = card;
    dragCard.classList.add('dragging');
    
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
    
    startX = clientX;
    startY = clientY;
    currentX = clientX;
    currentY = clientY;
}

function drag(e) {
    if (!isDragging || !dragCard) return;
    
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
    
    currentX = clientX;
    currentY = clientY;
    
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    
    if (e.cancelable) {
        e.preventDefault();
    }
    
    const rotate = deltaX * 0.08;
    dragCard.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) rotate(${rotate}deg)`;
    
    const likeBadge = dragCard.querySelector('.match-badge.like');
    const nopeBadge = dragCard.querySelector('.match-badge.nope');
    
    if (deltaX > 0) {
        const opacity = Math.min(deltaX / 100, 1);
        if (likeBadge) likeBadge.style.opacity = opacity;
        if (nopeBadge) nopeBadge.style.opacity = 0;
    } else {
        const opacity = Math.min(Math.abs(deltaX) / 100, 1);
        if (nopeBadge) nopeBadge.style.opacity = opacity;
        if (likeBadge) likeBadge.style.opacity = 0;
    }
}

function endDrag(e) {
    if (!isDragging || !dragCard) return;
    
    isDragging = false;
    dragCard.classList.remove('dragging');
    
    const deltaX = currentX - startX;
    const threshold = 100;
    
    if (deltaX > threshold) {
        swipeCardOut(dragCard, 'right');
    } else if (deltaX < -threshold) {
        swipeCardOut(dragCard, 'left');
    } else {
        dragCard.style.transform = '';
        const likeBadge = dragCard.querySelector('.match-badge.like');
        const nopeBadge = dragCard.querySelector('.match-badge.nope');
        if (likeBadge) likeBadge.style.opacity = 0;
        if (nopeBadge) nopeBadge.style.opacity = 0;
    }
    
    dragCard = null;
}

function swipeCardOut(card, direction) {
    const likeBadge = card.querySelector('.match-badge.like');
    const nopeBadge = card.querySelector('.match-badge.nope');
    const dragY = currentY - startY;
    
    if (direction === 'right') {
        card.style.transform = `translate3d(500px, ${dragY}px, 0) rotate(35deg)`;
        card.style.opacity = '0';
        if (likeBadge) likeBadge.style.opacity = '1';
        if (nopeBadge) nopeBadge.style.opacity = '0';
        
        const name = card.dataset.nome;
        const day = card.dataset.dia;
        const time = card.dataset.horario;
        
        setTimeout(() => {
            card.remove();
            handleMatchSwipeResult(name, day, time, 'like');
        }, 300);
    } else {
        card.style.transform = `translate3d(-500px, ${dragY}px, 0) rotate(-35deg)`;
        card.style.opacity = '0';
        if (nopeBadge) nopeBadge.style.opacity = '1';
        if (likeBadge) likeBadge.style.opacity = '0';
        
        const name = card.dataset.nome;
        const day = card.dataset.dia;
        const time = card.dataset.horario;
        
        setTimeout(() => {
            card.remove();
            handleMatchSwipeResult(name, day, time, 'nope');
        }, 300);
    }
}

function swipeCardProgrammatically(direction) {
    const topCard = document.querySelector('.match-card.top');
    if (!topCard) return;
    
    topCard.style.transition = 'transform 0.4s cubic-bezier(0.165, 0.84, 0.44, 1), opacity 0.4s ease';
    
    if (direction === 'right') {
        topCard.style.transform = 'translate3d(500px, 0, 0) rotate(35deg)';
        topCard.style.opacity = '0';
        const likeBadge = topCard.querySelector('.match-badge.like');
        if (likeBadge) likeBadge.style.opacity = '1';
    } else {
        topCard.style.transform = 'translate3d(-500px, 0, 0) rotate(-35deg)';
        topCard.style.opacity = '0';
        const nopeBadge = topCard.querySelector('.match-badge.nope');
        if (nopeBadge) nopeBadge.style.opacity = '1';
    }
    
    const name = topCard.dataset.nome;
    const day = topCard.dataset.dia;
    const time = topCard.dataset.horario;
    
    setTimeout(() => {
        topCard.remove();
        handleMatchSwipeResult(name, day, time, direction === 'right' ? 'like' : 'nope');
    }, 350);
}

function initMatchControls() {
    const rejectBtn = document.getElementById('btn-match-reject');
    const acceptBtn = document.getElementById('btn-match-accept');
    
    if (rejectBtn) {
        rejectBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            swipeCardProgrammatically('left');
        });
    }
    
    if (acceptBtn) {
        acceptBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            swipeCardProgrammatically('right');
        });
    }
}

function handleMatchSwipeResult(name, day, time, action) {
    const idx = matchQueue.findIndex(item => item.nome === name && item.dia === day && item.horario === time);
    let swipedItem = null;
    if (idx !== -1) {
        swipedItem = matchQueue.splice(idx, 1)[0];
    }
    
    if (action === 'like' && swipedItem) {
        tryAddAttraction(swipedItem.nome, swipedItem.dia, swipedItem.horario);
    }
    
    initMatchDeck();
}

function handleConflictCancelled() {
    if (pendingAddAttraction) {
        const activeTabBtn = document.querySelector('.nav-item.active');
        const activeTab = activeTabBtn ? activeTabBtn.getAttribute('data-tab') : null;
        if (activeTab === 'match') {
            const exists = matchQueue.some(item => 
                item.nome === pendingAddAttraction.nome && 
                item.dia === pendingAddAttraction.dia && 
                item.horario === pendingAddAttraction.horario
            );
            if (!exists) {
                matchQueue.unshift(pendingAddAttraction);
                initMatchDeck();
            }
        }
    }
}

window.resetMatchDeck = function() {
    const unselected = ATTRACTIONS_DATA.filter(attr => 
        !selectedAttractions.some(sel => 
            sel.nome === attr.nome && sel.dia === attr.dia && sel.horario === attr.horario
        )
    );
    matchQueue = shuffle(unselected);
    initMatchDeck();
};

// --- Toast Notifications ---
let toastTimeoutId = null;
function showToast(message) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    
    // Force a reflow
    toast.offsetWidth;
    toast.classList.add('show');
    
    if (toastTimeoutId) {
        clearTimeout(toastTimeoutId);
    }
    
    toastTimeoutId = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (!toast.classList.contains('show')) {
                toast.classList.add('hidden');
            }
        }, 400);
    }, 3000);
}

// --- Itinerary Sharing & Compatibility Match Logic ---
function initSharingEvents() {
    const shareBtn = document.getElementById('btn-share-itinerary');
    if (shareBtn) {
        shareBtn.addEventListener('click', generateShareLink);
    }
    
    const whatsappBtn = document.getElementById('btn-share-whatsapp');
    if (whatsappBtn) {
        whatsappBtn.addEventListener('click', shareItineraryWhatsApp);
    }
    
    const storiesBtn = document.getElementById('btn-share-stories');
    if (storiesBtn) {
        storiesBtn.addEventListener('click', shareItineraryStories);
    }
    
    const closeBtn = document.getElementById('share-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('share-modal').classList.add('hidden');
            window.history.replaceState({}, document.title, window.location.pathname);
        });
    }
    
    const shareModal = document.getElementById('share-modal');
    if (shareModal) {
        shareModal.addEventListener('click', (e) => {
            if (e.target === shareModal) {
                shareModal.classList.add('hidden');
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        });
    }
    
    const closeStoriesBtn = document.getElementById('btn-close-stories');
    if (closeStoriesBtn) {
        closeStoriesBtn.addEventListener('click', () => {
            document.getElementById('stories-modal').classList.add('hidden');
        });
    }
    
    const storiesModal = document.getElementById('stories-modal');
    if (storiesModal) {
        storiesModal.addEventListener('click', (e) => {
            if (e.target === storiesModal) {
                storiesModal.classList.add('hidden');
            }
        });
    }
    
    const downloadStoriesBtn = document.getElementById('btn-download-stories');
    if (downloadStoriesBtn) {
        downloadStoriesBtn.addEventListener('click', downloadStoriesImage);
    }
    
    // Theme selector listeners
    document.querySelectorAll('.stories-theme-selector .btn-theme-opt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.stories-theme-selector .btn-theme-opt').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentStoriesTheme = e.currentTarget.getAttribute('data-theme');
            renderStoriesCanvas(currentStoriesTheme);
        });
    });
}

function generateShareLink() {
    if (selectedAttractions.length === 0) {
        showToast("Adicione atrações ao seu roteiro para compartilhar!");
        return;
    }
    
    const indices = selectedAttractions.map(attr => {
        return ATTRACTIONS_DATA.findIndex(item => 
            item.nome === attr.nome && item.dia === attr.dia && item.horario === attr.horario
        );
    }).filter(idx => idx !== -1);
    
    if (indices.length === 0) return;
    
    const shareStr = indices.join(',');
    const url = `${window.location.origin}${window.location.pathname}?share=${shareStr}`;
    
    navigator.clipboard.writeText(url).then(() => {
        showToast("Link do roteiro copiado com sucesso!");
    }).catch(err => {
        console.warn("Clipboard API failed, using fallback:", err);
        const textArea = document.createElement("textarea");
        textArea.value = url;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            showToast("Link do roteiro copiado com sucesso!");
        } catch (copyErr) {
            console.error("Fallback copy failed:", copyErr);
            alert(`Copie o link abaixo:\n\n${url}`);
        }
        document.body.removeChild(textArea);
    });
}

function shareItineraryWhatsApp() {
    if (selectedAttractions.length === 0) {
        showToast("Adicione atrações ao seu roteiro para compartilhar!");
        return;
    }
    
    const indices = selectedAttractions.map(attr => {
        return ATTRACTIONS_DATA.findIndex(item => 
            item.nome === attr.nome && item.dia === attr.dia && item.horario === attr.horario
        );
    }).filter(idx => idx !== -1);
    
    if (indices.length === 0) return;
    
    const shareStr = indices.join(',');
    const url = `${window.location.origin}${window.location.pathname}?share=${shareStr}`;
    
    const text = `Confira meu roteiro personalizado para a Virada SP! Crie o seu e compare comigo no link: ${url}`;
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    
    window.open(waUrl, '_blank');
}

let currentStoriesTheme = 'deep-space';

function shareItineraryStories() {
    if (selectedAttractions.length === 0) {
        showToast("Adicione atrações ao seu roteiro para compartilhar!");
        return;
    }
    
    const storiesModal = document.getElementById('stories-modal');
    if (storiesModal) {
        storiesModal.classList.remove('hidden');
    }
    
    currentStoriesTheme = 'deep-space';
    
    // Reset active buttons in theme selector
    document.querySelectorAll('.stories-theme-selector .btn-theme-opt').forEach(btn => {
        if (btn.getAttribute('data-theme') === currentStoriesTheme) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Render
    renderStoriesCanvas(currentStoriesTheme);
}

function renderStoriesCanvas(theme) {
    const canvas = document.getElementById('stories-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Draw Background
    if (theme === 'deep-space') {
        const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        bgGrad.addColorStop(0, '#080612');
        bgGrad.addColorStop(0.5, '#181236');
        bgGrad.addColorStop(1, '#0b0914');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw space nebulas
        const neb1 = ctx.createRadialGradient(900, 200, 50, 900, 200, 450);
        neb1.addColorStop(0, 'rgba(236, 72, 153, 0.25)');
        neb1.addColorStop(1, 'rgba(236, 72, 153, 0)');
        ctx.fillStyle = neb1;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const neb2 = ctx.createRadialGradient(150, 1200, 50, 150, 1200, 550);
        neb2.addColorStop(0, 'rgba(139, 92, 246, 0.22)');
        neb2.addColorStop(1, 'rgba(139, 92, 246, 0)');
        ctx.fillStyle = neb2;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (theme === 'spotify-dark') {
        const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        bgGrad.addColorStop(0, '#121212');
        bgGrad.addColorStop(1, '#1A1A1A');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const neb = ctx.createRadialGradient(540, 1920, 100, 540, 1920, 800);
        neb.addColorStop(0, 'rgba(29, 185, 84, 0.15)');
        neb.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = neb;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (theme === 'neon-cyber') {
        const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        bgGrad.addColorStop(0, '#060112');
        bgGrad.addColorStop(1, '#1b0330');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw grid
        ctx.strokeStyle = 'rgba(42, 8, 69, 0.5)';
        ctx.lineWidth = 2;
        for (let y = 0; y < canvas.height; y += 80) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
        for (let x = 0; x < canvas.width; x += 80) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
    }
    
    ctx.shadowBlur = 0;
    
    // 2. Draw Left Vertical Text "2026"
    ctx.save();
    ctx.translate(100, 750);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '900 180px "Inter", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (theme === 'deep-space') {
        ctx.strokeStyle = '#D8B4FE';
        ctx.lineWidth = 4;
        ctx.strokeText('2026', 0, 0);
    } else if (theme === 'spotify-dark') {
        ctx.fillStyle = '#1DB954';
        ctx.fillText('2026', 0, 0);
    } else if (theme === 'neon-cyber') {
        ctx.strokeStyle = '#FFFF00';
        ctx.lineWidth = 4;
        ctx.strokeText('2026', 0, 0);
    }
    ctx.restore();
    
    // 3. Draw Square Box for Route
    const boxX = 160;
    const boxY = 220;
    const boxSize = 760;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(boxX, boxY, boxSize, boxSize);
    
    if (theme === 'deep-space') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.lineWidth = 2;
        for (let r = 100; r < 600; r += 100) {
            ctx.beginPath();
            ctx.arc(boxX + boxSize/2, boxY + boxSize/2, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    } else if (theme === 'spotify-dark') {
        ctx.strokeStyle = '#181818';
        ctx.lineWidth = 3;
        for (let i = -boxSize; i < boxSize; i += 40) {
            ctx.beginPath();
            ctx.moveTo(boxX + i, boxY);
            ctx.lineTo(boxX + i + boxSize, boxY + boxSize);
            ctx.stroke();
        }
    } else if (theme === 'neon-cyber') {
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.08)';
        ctx.lineWidth = 1.5;
        for (let i = 40; i < boxSize; i += 40) {
            ctx.beginPath();
            ctx.moveTo(boxX + i, boxY);
            ctx.lineTo(boxX + i, boxY + boxSize);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(boxX, boxY + i);
            ctx.lineTo(boxX + boxSize, boxY + i);
            ctx.stroke();
        }
    }
    
    // Checkerboard border
    const checkerSize = 20;
    ctx.fillStyle = theme === 'neon-cyber' ? '#FFFF00' : '#FFFFFF';
    for (let x = boxX; x < boxX + boxSize; x += checkerSize * 2) {
        ctx.fillRect(x, boxY, checkerSize, checkerSize);
        ctx.fillRect(x + checkerSize, boxY + boxSize - checkerSize, checkerSize, checkerSize);
    }
    for (let y = boxY; y < boxY + boxSize; y += checkerSize * 2) {
        ctx.fillRect(boxX, y + checkerSize, checkerSize, checkerSize);
        ctx.fillRect(boxX + boxSize - checkerSize, y, checkerSize, checkerSize);
    }
    
    // 4. Draw Strava-style Route Line
    const sorted = [...selectedAttractions].sort((a, b) => getAbsoluteTime(a.dia, a.horario) - getAbsoluteTime(b.dia, b.horario));
    const points = [];
    sorted.forEach(item => {
        const cacheKey = `${item.palco}::${item.endereco}`;
        const latLng = geocodeCache[cacheKey];
        if (latLng) {
            points.push({
                lat: latLng[0],
                lng: latLng[1],
                nome: item.nome,
                palco: item.palco
            });
        }
    });
    
    if (points.length > 0) {
        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        points.forEach(pt => {
            if (pt.lat < minLat) minLat = pt.lat;
            if (pt.lat > maxLat) maxLat = pt.lat;
            if (pt.lng < minLng) minLng = pt.lng;
            if (pt.lng > maxLng) maxLng = pt.lng;
        });
        
        const pad = 120;
        const drawMinX = boxX + pad;
        const drawMaxX = boxX + boxSize - pad;
        const drawMinY = boxY + pad;
        const drawMaxY = boxY + boxSize - pad;
        
        const mapPoint = (pt) => {
            let x, y;
            if (maxLng === minLng) {
                x = boxX + boxSize / 2;
            } else {
                x = drawMinX + ((pt.lng - minLng) / (maxLng - minLng)) * (drawMaxX - drawMinX);
            }
            if (maxLat === minLat) {
                y = boxY + boxSize / 2;
            } else {
                y = drawMaxY - ((pt.lat - minLat) / (maxLat - minLat)) * (drawMaxY - drawMinY);
            }
            return { x, y };
        };
        
        let pathColor = '#FF5722';
        let glowColor = '#FF5722';
        
        if (theme === 'deep-space') {
            pathColor = '#FF2E93';
            glowColor = '#FF2E93';
        } else if (theme === 'spotify-dark') {
            pathColor = '#1DB954';
            glowColor = '#1DB954';
        } else if (theme === 'neon-cyber') {
            pathColor = '#00FFFF';
            glowColor = '#00FFFF';
        }
        
        ctx.save();
        ctx.strokeStyle = pathColor;
        ctx.lineWidth = 14;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 18;
        
        if (points.length >= 2) {
            ctx.beginPath();
            const firstPt = mapPoint(points[0]);
            ctx.moveTo(firstPt.x, firstPt.y);
            for (let i = 1; i < points.length; i++) {
                const pt = mapPoint(points[i]);
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.stroke();
        }
        ctx.restore();
        
        points.forEach((pt, i) => {
            const canvasPt = mapPoint(pt);
            
            ctx.save();
            ctx.beginPath();
            ctx.arc(canvasPt.x, canvasPt.y, 14, 0, Math.PI * 2);
            ctx.fillStyle = i === 0 ? '#1DB954' : (i === points.length - 1 ? '#E1306C' : '#FFFFFF');
            ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
            ctx.shadowBlur = 10;
            ctx.fill();
            
            ctx.beginPath();
            ctx.arc(canvasPt.x, canvasPt.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
            ctx.restore();
            
            if (i === 0 || i === points.length - 1) {
                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 22px "Inter", "Segoe UI", sans-serif';
                ctx.textAlign = 'center';
                const textLabel = i === 0 ? 'PARTIDA' : 'CHEGADA';
                ctx.fillText(textLabel, canvasPt.x, canvasPt.y - 24);
            }
        });
    } else {
        ctx.save();
        ctx.strokeStyle = theme === 'spotify-dark' ? '#1DB954' : (theme === 'neon-cyber' ? '#00FFFF' : '#FF2E93');
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 12;
        
        ctx.beginPath();
        const centerY = boxY + boxSize / 2;
        ctx.moveTo(boxX + 150, centerY + 100);
        ctx.bezierCurveTo(boxX + 300, centerY - 150, boxX + 450, centerY + 150, boxX + boxSize - 150, centerY - 100);
        ctx.stroke();
        ctx.restore();
        
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(boxX + 150, centerY + 100, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(boxX + boxSize - 150, centerY - 100, 10, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = 'bold 26px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Nenhuma atração no mapa', boxX + boxSize/2, centerY + 200);
    }
    
    // 5. Draw Top Attractions List
    const listStartY = 1180;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.font = '900 36px "Inter", "Segoe UI", sans-serif';
    ctx.fillText('SUAS PRINCIPAIS ATRAÇÕES', boxX, listStartY);
    
    const maxItems = 4;
    const itemsToShow = sorted.slice(0, maxItems);
    
    itemsToShow.forEach((item, i) => {
        const itemY = listStartY + 70 + (i * 105);
        
        ctx.font = '900 52px "Inter", "Segoe UI", sans-serif';
        if (theme === 'deep-space') {
            ctx.fillStyle = '#EC4899';
        } else if (theme === 'spotify-dark') {
            ctx.fillStyle = '#1DB954';
        } else if (theme === 'neon-cyber') {
            ctx.fillStyle = '#FFFF00';
        }
        ctx.fillText(`${i + 1}`, boxX, itemY + 10);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 34px "Inter", "Segoe UI", sans-serif';
        let showName = item.nome;
        if (ctx.measureText(showName).width > 680) {
            while (ctx.measureText(showName + '...').width > 680 && showName.length > 0) {
                showName = showName.slice(0, -1);
            }
            showName += '...';
        }
        ctx.fillText(showName, boxX + 60, itemY - 5);
        
        ctx.fillStyle = theme === 'deep-space' ? '#C084FC' : (theme === 'spotify-dark' ? '#A3A3A3' : '#00FFFF');
        ctx.font = '600 24px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(`${item.palco} • ${item.dia} às ${item.horario}`, boxX + 60, itemY + 28);
    });
    
    if (sorted.length > maxItems) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.font = 'italic bold 24px "Inter", "Segoe UI", sans-serif';
        ctx.fillText(`+ ${sorted.length - maxItems} atrações no seu roteiro completo`, boxX + 60, listStartY + 75 + (maxItems * 105));
    }
    
    // 6. Draw Stats Block
    const statsY = 1680;
    const totalShows = sorted.length;
    
    let totalKm = '0.0';
    const overlayInfo = document.getElementById('map-overlay-info');
    if (overlayInfo) {
        const text = overlayInfo.textContent;
        const match = text.match(/distância:\s*([\d,.]+)\s*km/i);
        if (match) {
            totalKm = match[1];
        }
    }
    
    const palcoCounts = {};
    sorted.forEach(attr => {
        palcoCounts[attr.palco] = (palcoCounts[attr.palco] || 0) + 1;
    });
    let favoritePalco = '-';
    let maxCount = 0;
    for (const [palco, count] of Object.entries(palcoCounts)) {
        if (count > maxCount) {
            maxCount = count;
            favoritePalco = palco;
        }
    }
    if (favoritePalco.length > 15) {
        favoritePalco = favoritePalco.substring(0, 13) + '...';
    }
    
    const colWidth = 260;
    
    ctx.textAlign = 'center';
    ctx.fillStyle = theme === 'deep-space' ? '#C084FC' : (theme === 'spotify-dark' ? '#A3A3A3' : '#00FFFF');
    ctx.font = 'bold 20px "Inter", "Segoe UI", sans-serif';
    ctx.fillText('SHOWS', boxX + 110, statsY);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 50px "Inter", "Segoe UI", sans-serif';
    ctx.fillText(`${totalShows}`, boxX + 110, statsY + 60);
    
    ctx.fillStyle = theme === 'deep-space' ? '#C084FC' : (theme === 'spotify-dark' ? '#A3A3A3' : '#00FFFF');
    ctx.font = 'bold 20px "Inter", "Segoe UI", sans-serif';
    ctx.fillText('DISTÂNCIA', boxX + colWidth + 110, statsY);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 50px "Inter", "Segoe UI", sans-serif';
    ctx.fillText(`${totalKm} km`, boxX + colWidth + 110, statsY + 60);
    
    ctx.fillStyle = theme === 'deep-space' ? '#C084FC' : (theme === 'spotify-dark' ? '#A3A3A3' : '#00FFFF');
    ctx.font = 'bold 20px "Inter", "Segoe UI", sans-serif';
    ctx.fillText('PALCO FAVORITO', boxX + (colWidth * 2) + 110, statsY);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 38px "Inter", "Segoe UI", sans-serif';
    ctx.fillText(favoritePalco, boxX + (colWidth * 2) + 110, statsY + 54);
    
    // 7. Draw Bottom Brand Bar
    const footerY = 1860;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(boxX, footerY - 40);
    ctx.lineTo(boxX + boxSize, footerY - 40);
    ctx.stroke();
    
    ctx.textAlign = 'center';
    
    ctx.save();
    ctx.fillStyle = theme === 'deep-space' ? '#EC4899' : (theme === 'spotify-dark' ? '#1DB954' : '#FFFF00');
    ctx.translate(330, footerY);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
        ctx.lineTo(Math.cos((18 + i * 72) * Math.PI / 180) * 15, -Math.sin((18 + i * 72) * Math.PI / 180) * 15);
        ctx.lineTo(Math.cos((54 + i * 72) * Math.PI / 180) * 7, -Math.sin((54 + i * 72) * Math.PI / 180) * 7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '900 24px "Inter", "Segoe UI", sans-serif';
    ctx.fillText('VIRADA-SP / WRAPPED', 570, footerY + 8);
}

function downloadStoriesImage() {
    const canvas = document.getElementById('stories-canvas');
    if (!canvas) return;
    
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'roteiro-virada-stories.png';
    link.href = dataURL;
    link.click();
}


function checkSharedItinerary() {
    const params = new URLSearchParams(window.location.search);
    const shareParam = params.get('share');
    if (!shareParam) return;
    
    const indices = shareParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (indices.length === 0) return;
    
    const sharedAttractions = indices
        .map(idx => ATTRACTIONS_DATA[idx])
        .filter(attr => attr !== undefined);
        
    if (sharedAttractions.length === 0) return;
    
    // Delay slightly to let the page fully render/load cache
    setTimeout(() => {
        if (selectedAttractions.length === 0) {
            showImportModal(sharedAttractions);
        } else {
            showMatchModal(sharedAttractions);
        }
    }, 400);
}

function showImportModal(sharedAttractions) {
    const modal = document.getElementById('share-modal');
    const title = document.getElementById('share-modal-title');
    const matchView = document.getElementById('share-match-view');
    const importView = document.getElementById('share-import-view');
    const actionBtn = document.getElementById('share-action-btn');
    
    if (!modal || !title || !matchView || !importView || !actionBtn) return;
    
    title.textContent = "Importar Roteiro";
    matchView.classList.add('hidden');
    importView.classList.remove('hidden');
    actionBtn.textContent = "Copiar Roteiro do Amigo";
    
    const importList = document.getElementById('share-import-list');
    importList.innerHTML = sharedAttractions.map(item => {
        return `
            <div class="share-match-item">
                <div class="share-match-item-info">
                    <span class="share-match-item-title">${item.nome}</span>
                    <div class="share-match-item-meta">
                        <span>${item.dia} às ${item.horario}</span>
                        <span class="share-match-item-stage">${item.palco}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    actionBtn.onclick = () => {
        selectedAttractions = [...sharedAttractions];
        saveSelectedToCache();
        updateSelectedBadge();
        renderAttractionsList();
        updateItineraryView();
        triggerGeocodeForItinerary();
        modal.classList.add('hidden');
        showToast("Roteiro importado com sucesso!");
        window.history.replaceState({}, document.title, window.location.pathname);
    };
    
    modal.classList.remove('hidden');
}

function showMatchModal(sharedAttractions) {
    const modal = document.getElementById('share-modal');
    const title = document.getElementById('share-modal-title');
    const matchView = document.getElementById('share-match-view');
    const importView = document.getElementById('share-import-view');
    const actionBtn = document.getElementById('share-action-btn');
    
    if (!modal || !title || !matchView || !importView || !actionBtn) return;
    
    title.textContent = "Comparar Roteiros";
    importView.classList.add('hidden');
    matchView.classList.remove('hidden');
    actionBtn.textContent = "Mesclar Roteiros";
    
    const common = [];
    const suggested = [];
    
    sharedAttractions.forEach(item => {
        const isCommon = selectedAttractions.some(sel => 
            sel.nome === item.nome && sel.dia === item.dia && sel.horario === item.horario
        );
        if (isCommon) {
            common.push(item);
        } else {
            suggested.push(item);
        }
    });
    
    const maxVal = Math.max(selectedAttractions.length, sharedAttractions.length);
    const matchPercent = maxVal > 0 ? Math.round((common.length / maxVal) * 100) : 0;
    
    document.getElementById('share-match-percent').textContent = `${matchPercent}%`;
    
    let summaryText = "";
    if (matchPercent === 100) {
        summaryText = "Vocês têm 100% de compatibilidade! Vão curtir todos os shows juntos.";
    } else if (matchPercent >= 70) {
        summaryText = `Grande sintonia! Vocês têm ${matchPercent}% de match e vão se ver em vários shows.`;
    } else if (matchPercent >= 40) {
        summaryText = `Bons matches! Vocês têm ${matchPercent}% de interesse em comum.`;
    } else if (matchPercent > 0) {
        summaryText = `Alguns matches! Vocês têm ${matchPercent}% de compatibilidade. Que tal mesclar os roteiros?`;
    } else {
        summaryText = "Nenhum show em comum ainda. Adicione as atrações do seu amigo para irem juntos!";
    }
    document.getElementById('share-match-summary').textContent = summaryText;
    
    const commonList = document.getElementById('share-common-list');
    if (common.length === 0) {
        commonList.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 10px 0;">Nenhum show em comum ainda.</p>`;
    } else {
        commonList.innerHTML = common.map(item => {
            return `
                <div class="share-match-item">
                    <div class="share-match-item-info">
                        <span class="share-match-item-title">${item.nome}</span>
                        <div class="share-match-item-meta">
                            <span>${item.dia} às ${item.horario}</span>
                            <span class="share-match-item-stage">${item.palco}</span>
                        </div>
                    </div>
                    <div class="share-match-item-action">
                        <span class="share-badge-common">Em comum</span>
                    </div>
                </div>
            `;
        }).join('');
    }
    
    const renderSuggestedList = () => {
        const suggestedList = document.getElementById('share-suggested-list');
        if (suggested.length === 0) {
            suggestedList.innerHTML = `<p style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 10px 0;">Todos os shows já estão no seu roteiro!</p>`;
        } else {
            suggestedList.innerHTML = suggested.map(item => {
                const isSelected = selectedAttractions.some(sel => 
                    sel.nome === item.nome && sel.dia === item.dia && sel.horario === item.horario
                );
                
                return `
                    <div class="share-match-item" data-nome="${item.nome}" data-dia="${item.dia}" data-horario="${item.horario}">
                        <div class="share-match-item-info">
                            <span class="share-match-item-title">${item.nome}</span>
                            <div class="share-match-item-meta">
                                <span>${item.dia} às ${item.horario}</span>
                                <span class="share-match-item-stage">${item.palco}</span>
                            </div>
                        </div>
                        <div class="share-match-item-action">
                            <button class="btn-share-add ${isSelected ? 'added' : ''}" 
                                onclick="handleSuggestedAddClick(this, '${item.nome.replace(/'/g, "\\'")}', '${item.dia}', '${item.horario}')">
                                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    };
    
    renderSuggestedList();
    
    actionBtn.onclick = () => {
        const result = mergeNonConflicting(sharedAttractions);
        modal.classList.add('hidden');
        if (result.addedCount > 0 && result.conflictCount > 0) {
            showToast(`Mesclado! Adicionados ${result.addedCount} shows. Omitidos ${result.conflictCount} conflitos.`);
        } else if (result.addedCount > 0) {
            showToast(`Mesclado! Adicionados ${result.addedCount} shows.`);
        } else if (result.conflictCount > 0) {
            showToast(`Nenhum show adicionado devido a conflitos de horário.`);
        } else {
            showToast("Seu roteiro já está sincronizado!");
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    };
    
    modal.classList.remove('hidden');
}

function updateMatchModalButtons() {
    const modal = document.getElementById('share-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    
    const items = modal.querySelectorAll('.share-match-item');
    items.forEach(item => {
        const nome = item.dataset.nome;
        const dia = item.dataset.dia;
        const horario = item.dataset.horario;
        if (!nome) return;
        
        const btn = item.querySelector('.btn-share-add');
        if (!btn) return;
        
        const isSelected = selectedAttractions.some(sel => 
            sel.nome === nome && sel.dia === dia && sel.horario === horario
        );
        
        if (isSelected) {
            btn.classList.add('added');
        } else {
            btn.classList.remove('added');
        }
    });
}

function mergeNonConflicting(sharedAttractions) {
    let addedCount = 0;
    let conflictCount = 0;
    
    sharedAttractions.forEach(item => {
        const isAlreadySelected = selectedAttractions.some(sel => 
            sel.nome === item.nome && sel.dia === item.dia && sel.horario === item.horario
        );
        if (isAlreadySelected) return;
        
        const absoluteTime = getAbsoluteTime(item.dia, item.horario);
        let hasConflict = false;
        
        if (absoluteTime < 99999) {
            hasConflict = selectedAttractions.some(sel => {
                const itemAbsTime = getAbsoluteTime(sel.dia, sel.horario);
                if (itemAbsTime === 99999) return false;
                return sel.dia === item.dia && Math.abs(itemAbsTime - absoluteTime) < 60;
            });
        }
        
        if (!hasConflict) {
            selectedAttractions.push(item);
            addedCount++;
        } else {
            conflictCount++;
        }
    });
    
    if (addedCount > 0) {
        saveSelectedToCache();
        updateSelectedBadge();
        renderAttractionsList();
        updateItineraryView();
        triggerGeocodeForItinerary();
    }
    
    return { addedCount, conflictCount };
}

window.handleSuggestedAddClick = function(button, nome, dia, horario) {
    if (button.classList.contains('added')) return;
    tryAddAttraction(nome, dia, horario);
};
