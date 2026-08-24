const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const travelMode = require('../public/travel-mode.js');

const projectRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

test('parking availability follows the selected vehicle capacity line', () => {
    const both = '🚗 Parkir Mobil: Ya (12)\n🏍️ Parkir Motor: Ya (25)';
    const carOnly = '🚗 Parkir Mobil: Ya (8)\n🏍️ Parkir Motor: Tidak';
    const motorcycleOnly = '🚗 Parkir Mobil: Tidak\n🏍️ Parkir Motor: Ya (40)';

    assert.equal(travelMode.readParkingAvailability(both, travelMode.VEHICLE_CAR), true);
    assert.equal(travelMode.readParkingAvailability(both, travelMode.VEHICLE_MOTORCYCLE), true);
    assert.equal(travelMode.readParkingAvailability(carOnly, travelMode.VEHICLE_CAR), true);
    assert.equal(travelMode.readParkingAvailability(carOnly, travelMode.VEHICLE_MOTORCYCLE), false);
    assert.equal(travelMode.readParkingAvailability(motorcycleOnly, travelMode.VEHICLE_CAR), false);
    assert.equal(travelMode.readParkingAvailability(motorcycleOnly, travelMode.VEHICLE_MOTORCYCLE), true);
    assert.equal(travelMode.readParkingAvailability('Parkir Mobil: Ya (0)', travelMode.VEHICLE_CAR), false);
});

test('parking pins require active travel mode and stay within an inclusive 3 km radius', () => {
    const base = {
        travelModeActive: true,
        vehicleMode: travelMode.VEHICLE_CAR,
        description: '🚗 Parkir Mobil: Ya (12)\n🏍️ Parkir Motor: Tidak'
    };

    assert.equal(travelMode.PARKING_DISTANCE_KM, 3);
    assert.equal(travelMode.shouldShowParkingPin({ ...base, distanceKm: 0 }), true);
    assert.equal(travelMode.shouldShowParkingPin({ ...base, distanceKm: 3 }), true);
    assert.equal(travelMode.shouldShowParkingPin({ ...base, distanceKm: 3.001 }), false);
    assert.equal(travelMode.shouldShowParkingPin({ ...base, travelModeActive: false, distanceKm: 1 }), false);
    assert.equal(travelMode.shouldShowParkingPin({ ...base, vehicleMode: 'walking', distanceKm: 1 }), false);
});

test('main map wires car, motorcycle, and off controls without changing the station radius', () => {
    const html = read('public/index.html');
    const app = read('public/app.js');
    const serviceWorker = read('public/service-worker.js');

    assert.match(html, /id="special-category-on-btn"[^>]*>🚗<\/button>/);
    assert.match(html, /id="special-category-motorcycle-btn"[^>]*>🏍️<\/button>/);
    assert.match(html, /id="special-category-off-btn"[^>]*>🚶🏻<\/button>/);
    assert.ok(html.indexOf('src="travel-mode.js"') < html.indexOf('src="app.js"'));
    assert.match(app, /const SPECIAL_CATEGORY_DISTANCE_KM = 30;/);
    assert.match(app, /category === PARKING_CATEGORY/);
    assert.match(app, /setTravelVehicleMode\(VEHICLE_CAR\)/);
    assert.match(app, /setTravelVehicleMode\(VEHICLE_MOTORCYCLE\)/);
    assert.match(serviceWorker, /'\/travel-mode\.js'/);
});
