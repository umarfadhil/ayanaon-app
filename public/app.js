console.log('app.js loaded');

let map;
let temporaryMarker;
let userMarker;
let userCity;

async function initMap() {
    const { Map } = await google.maps.importLibrary("maps");
    const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");

    map = new Map(document.getElementById('map'), {
        center: { lat: -6.2088, lng: 106.8456 },
        zoom: 12,
        mapId: '4504f8b37365c3d0'
    });

    // Get user's current location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(position => {
            const userLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            map.setCenter(userLocation);
            const userMarkerPin = new google.maps.marker.PinElement({
                scale: 1.5,
                background: '#4285F4',
                borderColor: 'white',
                glyphColor: 'white',
            });
            userMarker = new AdvancedMarkerElement({
                position: userLocation,
                map: map,
                title: 'Your Location',
                content: userMarkerPin.element,
            });

            // Get user's city
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ 'location': userLocation }, (results, status) => {
                if (status === 'OK') {
                    if (results[0]) {
                        for (const component of results[0].address_components) {
                            if (component.types.includes('administrative_area_level_2')) {
                                userCity = component.long_name;
                                fetchPins(userCity);
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

    fetchPins();
}

function handleLocationError(browserHasGeolocation) {
    // You can handle the error here, e.g., show a message to the user
    console.error(browserHasGeolocation ?
        'Error: The Geolocation service failed.' :
        'Error: Your browser doesn\'t support geolocation.');
}

function submitPin(e) {
    e.preventDefault();

    const description = document.getElementById('description').value;
    const category = document.getElementById('category').value;

    if (!description || !category) {
        alert('Please fill out all fields');
        return;
    }

    if (!temporaryMarker) {
        alert('Please select a location on the map first');
        return;
    }

    const pin = {
        description,
        category,
        lat: temporaryMarker.position.lat,
        lng: temporaryMarker.position.lng
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
        if (temporaryMarker) {
            temporaryMarker.map = null;
        }
        addPinToMap(data);
        document.getElementById('add-pin-form').reset();
        alert('Pin dropped successfully!');
    });
}

function fetchPins(city) {
    let url = '/api/pins';
    if (city) {
        url += `?city=${city}`;
    }
    fetch(url)
    .then(response => response.json())
    .then(pins => {
        // Clear existing pins before adding new ones
        // (You might want to implement a more sophisticated way to handle this)
        // For now, we'll just log the pins to the console
        console.log(pins);
        pins.forEach(pin => {
            addPinToMap(pin);
        });
    });
}

function addPinToMap(pin) {
    const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: pin.lat, lng: pin.lng },
        map: map,
        title: pin.description
    });

    const infowindow = new google.maps.InfoWindow({
        content: `<div><strong>${pin.category}</strong></div><div>${pin.description}</div>`
    });

    marker.addListener('gmp-click', () => {
        infowindow.open(map, marker);
    });
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
