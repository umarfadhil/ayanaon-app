let map;
let temporaryMarker;

function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: -6.2088, lng: 106.8456 },
        zoom: 12
    });

    map.addListener('click', (e) => {
        if (temporaryMarker) {
            temporaryMarker.setMap(null);
        }
        temporaryMarker = new google.maps.Marker({
            position: e.latLng,
            map: map,
        });
    });

    document.getElementById('add-pin-form').addEventListener('submit', submitPin);

    fetchPins();
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
        lat: temporaryMarker.getPosition().lat(),
        lng: temporaryMarker.getPosition().lng()
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
            temporaryMarker.setMap(null);
        }
        addPinToMap(data);
        document.getElementById('add-pin-form').reset();
    });
}

function fetchPins() {
    fetch('/api/pins')
    .then(response => response.json())
    .then(pins => {
        pins.forEach(pin => {
            addPinToMap(pin);
        });
    });
}

function addPinToMap(pin) {
    const marker = new google.maps.Marker({
        position: { lat: pin.lat, lng: pin.lng },
        map: map,
        title: pin.description
    });

    const infowindow = new google.maps.InfoWindow({
        content: `<div><strong>${pin.category}</strong></div><div>${pin.description}</div>`
    });

    marker.addListener('click', () => {
        infowindow.open(map, marker);
    });
}
