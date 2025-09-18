console.log('app.js loaded');

let map;
let temporaryMarker;
let userMarker;
let userCity;
let markers = [];
let userIp;
let editingPinId = null;

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('welcome-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const infoBtn = document.getElementById('info-btn');
    const locateMeBtn = document.getElementById('locate-me-btn');
    const filterBtn = document.getElementById('filter-btn');
    const filterDropdown = document.getElementById('filter-dropdown');
    const selectAllCategories = document.getElementById('select-all-categories');
    const categoryCheckboxes = document.querySelectorAll('.category-checkbox');

    const hasVisited = localStorage.getItem('hasVisited');

    if (!hasVisited) {
        modal.classList.remove('hidden');
    }

    closeModalBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        localStorage.setItem('hasVisited', 'true');
    });

    infoBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
    });

    locateMeBtn.addEventListener('click', () => {
        if (userMarker) {
            map.setCenter(userMarker.position);
            map.setZoom(15);
        } else {
            alert('Could not determine your location.');
        }
    });

    filterBtn.addEventListener('click', () => {
        filterDropdown.classList.toggle('hidden');
    });

    selectAllCategories.addEventListener('change', (e) => {
        categoryCheckboxes.forEach(checkbox => {
            checkbox.checked = e.target.checked;
        });
        filterMarkers();
    });

    categoryCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            if (!checkbox.checked) {
                selectAllCategories.checked = false;
            }
            filterMarkers();
        });
    });

    function filterMarkers() {
        const selectedCategories = Array.from(categoryCheckboxes)
            .filter(checkbox => checkbox.checked)
            .map(checkbox => checkbox.value);

        markers.forEach(marker => {
            if (selectedCategories.includes(marker.category)) {
                marker.map = map;
            } else {
                marker.map = null;
            }
        });
    }

    // Lifetime options logic
    const lifetimeSelect = document.getElementById('lifetime-select');
    const lifetimeDatePicker = document.getElementById('lifetime-date-picker');

    // Hide date picker by default
    lifetimeDatePicker.style.display = 'none';

    lifetimeSelect.addEventListener('change', (e) => {
        if (e.target.value === 'date') {
            lifetimeDatePicker.style.display = 'block';
        } else {
            lifetimeDatePicker.style.display = 'none';
        }
    });
});

async function initMap() {
    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

    class CustomInfoWindow extends google.maps.OverlayView {
        constructor(pin, content) {
            super();
            this.pin = pin;
            this.position = new google.maps.LatLng(pin.lat, pin.lng);
            this.content = content;
            this.container = document.createElement('div');
            this.container.classList.add('custom-info-window');
            this.container.innerHTML = content;
    
            this.container.style.position = 'absolute';
            this.container.style.display = 'none';
        }
    
        onAdd() {
            this.getPanes().floatPane.appendChild(this.container);
        }
    
        onRemove() {
            if (this.container.parentElement) {
                this.container.parentElement.removeChild(this.container);
            }
        }
    
        draw() {
            const overlayProjection = this.getProjection();
            const sw = overlayProjection.fromLatLngToDivPixel(this.position);
            this.container.style.left = sw.x + 'px';
            this.container.style.top = sw.y + 'px';
        }
    
        show() {
            this.container.style.display = 'block';
        }
    
        hide() {
            this.container.style.display = 'none';
        }
    }

    map = new Map(document.getElementById('map'), {
        center: { lat: -6.2088, lng: 106.8456 },
        zoom: 12,
        mapId: '4504f8b37365c3d0'
    });

    function addPinToMap(pin) {
        const icon = getIconForCategory(pin.category);
        const markerElement = document.createElement('div');
        markerElement.textContent = icon;
        markerElement.style.fontSize = '24px';
    
        const marker = new google.maps.marker.AdvancedMarkerElement({
            position: { lat: pin.lat, lng: pin.lng },
            map: map,
            title: pin.title,
            content: markerElement
        });
    
        // Store category on marker object
        marker.category = pin.category;
        marker.pin = pin;
    
        let linkElement = '';
        if (pin.link) {
            linkElement = `<div class="info-window-link"><a href="${pin.link}" target="_blank" style="text-decoration: none; color: #90f2a8">${pin.link}</a></div>`;
        }

        let editButton = '';
        if (userIp === pin.reporter) {
            editButton = `<button class="edit-btn" onclick="editPin('${pin._id}')" style="background-color: #4285f4; font-size: 15px">edit</button>`;
        }
    
        let when = 'N/A';
        if (pin.lifetime) {
            if (pin.lifetime.type === 'today') {
                when = 'Hari ini';
            } else if (pin.lifetime.type === 'date' && pin.lifetime.value) {
                when = formatDate(pin.lifetime.value);
            }
        }
    
        const descriptionWithBreaks = pin.description.replace(/\n/g, '<br>');

        const contentString = `
            <div class="info-window-content">
                <div class="info-window-header">
                    <div class="info-window-category">${pin.category}</div>
                    <button class="close-info-window">&times;</button>
                </div>
                <div class="info-window-title">${pin.title}</div>
                <div class="info-window-description">${descriptionWithBreaks}</div>
                <div class="info-window-when">${when}</div>
                ${linkElement}
                <div class="info-window-vote">
                    <button onclick="upvotePin('${pin._id}')">👍</button>
                    <span id="upvotes-${pin._id}">${pin.upvotes}</span>
                    <button onclick="downvotePin('${pin._id}')">👎</button>
                    <span id="downvotes-${pin._id}">${pin.downvotes}</span>
                    ${editButton}
                </div>
            </div>
        `;
    
        const infowindow = new CustomInfoWindow(pin, contentString);
        infowindow.setMap(map);
    
        const closeButton = infowindow.container.querySelector('.close-info-window');
        closeButton.addEventListener('click', () => {
            infowindow.hide();
        });
    
        marker.addListener('gmp-click', () => {
            infowindow.show();
        });
    
        markers.push(marker);
    }

    function fetchPins(city) {
        // Clear existing markers
        markers.forEach(marker => marker.map = null);
        markers = [];
    
        let url = '/api/pins';
        if (city) {
            url += `?city=${city}`;
        }
        fetch(url)
        .then(response => response.json())
        .then(pins => {
            console.log(pins);
            pins.forEach(pin => {
                addPinToMap(pin);
            });
        });
    }

    function submitPin(e) {
        e.preventDefault();

        if (editingPinId) {
            updatePin(editingPinId);
            return;
        }
    
        const title = document.getElementById('title').value;
        const description = document.getElementById('description').value;
        const category = document.getElementById('category').value;
        const link = document.getElementById('link').value;
        const lifetimeType = document.getElementById('lifetime-select').value;
        const lifetimeValue = document.getElementById('lifetime-date-picker').value;
    
        if (!title || !description || !category || !lifetimeType) {
            alert('Please fill out all fields');
            return;
        }
    
        if (lifetimeType === 'date' && !lifetimeValue) {
            alert('Please select an expiration date.');
            return;
        }
    
        if (!temporaryMarker) {
            alert('Please select a location on the map first');
            return;
        }
    
        const pin = {
            title,
            description,
            category,
            link,
            lat: temporaryMarker.position.lat,
            lng: temporaryMarker.position.lng,
            lifetime: {
                type: lifetimeType,
                value: lifetimeValue
            }
        };
    
        fetch('/api/pins', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(pin)
        })
        .then(response => response.json())
        .then(data => {
            if (data.message) {
                alert('Error: ' + data.message);
                return;
            }
            if (temporaryMarker) {
                temporaryMarker.map = null;
            }
            console.log('Adding new pin to map:', data);
            addPinToMap(data);
            document.getElementById('add-pin-form').reset();
            document.getElementById('lifetime-date-picker').style.display = 'none';
            alert('Pin dropped successfully!');
        });
    }

    function handleLocationError(browserHasGeolocation) {
        // You can handle the error here, e.g., show a message to the user
        console.error(browserHasGeolocation ?
            'Error: The Geolocation service failed.' :
            'Error: Your browser\'s doesn\'t support geolocation.');
    }

    // Get user's current location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            map.setCenter(userLocation);
            const userMarkerDiv = document.createElement('div');
            userMarkerDiv.style.width = '14px';
            userMarkerDiv.style.height = '14px';
            userMarkerDiv.style.borderRadius = '50%';
            userMarkerDiv.style.backgroundColor = '#4285F4';
            userMarkerDiv.style.border = '2px solid white';
            userMarker = new AdvancedMarkerElement({
                position: userLocation,
                map: map,
                title: 'Your Location',
                content: userMarkerDiv,
            });

            // Get user's city
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ 'location': userLocation }, (results, status) => {
                if (status === 'OK') {
                    if (results[0]) {
                        for (const component of results[0].address_components) {
                            if (component.types.includes('administrative_area_level_2')) {
                                userCity = component.long_name;
                                fetchPins(userCity); // Call fetchPins here after userCity is set
                                break;
                            }
                        }
                    }
                } else {
                    console.error('Geocoder failed due to: ' + status);
                }
            });

        }, () => {
            handleLocationError(true);
        });

        // Watch user's location
        navigator.geolocation.watchPosition(position => {
            const userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            if (userMarker) {
                userMarker.position = userLocation;
            }
        }, () => {
            handleLocationError(false);
        });
    } else {
        // Browser doesn't support Geolocation
        handleLocationError(false);
    }


    map.addListener('click', (e) => {
        if (temporaryMarker) {
            temporaryMarker.map = null;
        }
        temporaryMarker = new AdvancedMarkerElement({
            position: e.latLng,
            map: map,
        });
    });

    document.getElementById('add-pin-form').addEventListener('submit', submitPin);
    document.getElementById('add-pin-btn').addEventListener('click', () => {
        const pinForm = document.getElementById('pin-form');
        pinForm.classList.toggle('hidden');
        editingPinId = null; // Reset editing state
        document.getElementById('add-pin-form').reset();
    });

    fetchPins();
    getUserIp();
    fetchActivePinsCount(); // Call the new function
    setInterval(fetchActivePinsCount, 30000); // Update every 30 seconds
}

function upvotePin(id) {
    fetch(`/api/pins/${id}/upvote`, { method: 'POST' })
        .then(response => {
            if (response.ok) {
                const upvotesSpan = document.getElementById(`upvotes-${id}`);
                upvotesSpan.textContent = parseInt(upvotesSpan.textContent) + 1;
            } else if (response.status === 403) {
                alert('You have already voted for this pin.');
            }
        });
}

function downvotePin(id) {
    fetch(`/api/pins/${id}/downvote`, { method: 'POST' })
        .then(response => {
            if (response.ok) {
                const downvotesSpan = document.getElementById(`downvotes-${id}`);
                downvotesSpan.textContent = parseInt(downvotesSpan.textContent) + 1;
            } else if (response.status === 403) {
                alert('You have already voted for this pin.');
            }
        });
}

function getIconForCategory(category) {
    const icons = {
        '🎉 Acara': '🎉',
        '🍔 Promo & Diskon Makanan / Minuman': '🍔',
        '💸 Promo & Diskon Lainnya': '💸',
        '🤝 Jual-Beli Barang': '🤝',
        '🚦 Lalu Lintas & Kecelakaan': '🚦',
        '🛍️ Pasar Lokal & Pameran': '🛍️',
        '🎭 Budaya & Hiburan': '🎭',
        '🏃🏻‍♂️‍➡️ Olahraga & Aktivitas Hobi': '🏃🏻‍♂️‍➡️',
        '🎓 Komunitas & Edukasi': '🎓',
        '🌧️ Cuaca & Bencana Alam': '🌧️',
        '🐾 Barang & Hewan Hilang': '🐾',
        '🧑‍🤝‍🧑 Sosial & Kopdar': '🧑‍🤝‍🧑',
        '💡 Lain-lain': '💡'
    };
    return icons[category] || '💡';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    
    const dayName = days[date.getDay()];
    const day = date.getDate();
    const monthName = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${dayName}, ${day} ${monthName} ${year}`;
}

function getUserIp() {
    fetch('/api/ip')
        .then(response => response.json())
        .then(data => {
            userIp = data.ip;
        });
}

function editPin(id) {
    const pin = markers.find(marker => marker.pin._id === id).pin;
    document.getElementById('title').value = pin.title;
    document.getElementById('description').value = pin.description;
    document.getElementById('category').value = pin.category;
    document.getElementById('link').value = pin.link;
    document.getElementById('lifetime-select').value = pin.lifetime.type;
    if (pin.lifetime.type === 'date') {
        document.getElementById('lifetime-date-picker').style.display = 'block';
        document.getElementById('lifetime-date-picker').value = pin.lifetime.value.split('T')[0];
    } else {
        document.getElementById('lifetime-date-picker').style.display = 'none';
    }

    editingPinId = id;
    document.getElementById('pin-form').classList.remove('hidden');
}

function updatePin(id) {
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const category = document.getElementById('category').value;
    const link = document.getElementById('link').value;
    const lifetimeType = document.getElementById('lifetime-select').value;
    const lifetimeValue = document.getElementById('lifetime-date-picker').value;

    const updatedPin = {
        title,
        description,
        category,
        link,
        lifetime: {
            type: lifetimeType,
            value: lifetimeValue
        }
    };

    fetch(`/api/pins/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatedPin)
    })
    .then(response => response.json())
    .then(data => {
        if (data.message) {
            alert('Error: ' + data.message);
            return;
        }
        alert('Pin updated successfully!');
        document.getElementById('add-pin-form').reset();
        document.getElementById('pin-form').classList.add('hidden');
        editingPinId = null;
        fetchPins(userCity);
    });
}

function fetchActivePinsCount() {
    fetch('/api/pins/count')
        .then(response => response.json())
        .then(data => {
            document.getElementById('active-pins-count').textContent = `Jumlah Pin Aktif  : ${data.count} Pin`;
        })
        .catch(error => console.error('Error fetching active pins count:', error));
}

console.log('Fetching API key...');
// Fetch the API key and load the Google Maps script
fetch('/api/config')
    .then(response => response.json())
    .then(config => {
        console.log('API key fetched, loading map...');
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${config.googleMapsApiKey}&callback=initMap&libraries=marker`;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
    });

function scheduleDailyRefresh() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const timeUntilMidnight = tomorrow - now;

    setTimeout(() => {
        location.reload();
    }, timeUntilMidnight);
}

scheduleDailyRefresh();

function fetchUniqueIpCount() {
    fetch('/api/unique-ips')
        .then(response => response.json())
        .then(data => {
            document.getElementById('unique-ips-count').textContent = `Jumlah Reporter : ${data.count} Warga`;
        })
        .catch(error => console.error('Error fetching unique IP count:', error));
}

// Call initially
fetchUniqueIpCount();

// Call every 5 seconds
// setInterval(fetchUniqueIpCount, 5000);
