(function exposeTravelModeRules(root, factory) {
    const rules = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = rules;
    }
    if (root) {
        root.AyanaonTravelMode = rules;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTravelModeRules() {
    'use strict';

    const PARKING_CATEGORY = '🅿️ Lokasi Parkir';
    const PARKING_DISTANCE_KM = 3;
    const VEHICLE_CAR = 'car';
    const VEHICLE_MOTORCYCLE = 'motorcycle';

    function normalizeVehicleMode(value) {
        return value === VEHICLE_MOTORCYCLE ? VEHICLE_MOTORCYCLE : VEHICLE_CAR;
    }

    function readParkingAvailability(description, vehicleMode) {
        const label = normalizeVehicleMode(vehicleMode) === VEHICLE_MOTORCYCLE
            ? 'Parkir Motor'
            : 'Parkir Mobil';
        const icon = normalizeVehicleMode(vehicleMode) === VEHICLE_MOTORCYCLE ? '🏍️?' : '🚗';
        const pattern = new RegExp(
            `(?:^|\\n)\\s*(?:${icon}\\s*)?${label}\\s*:\\s*(Ya|Tidak)(?:\\s*\\(\\s*(\\d+)\\s*\\))?`,
            'i'
        );
        const match = String(description || '').replace(/\r\n?/g, '\n').match(pattern);
        if (!match || match[1].toLowerCase() !== 'ya') {
            return false;
        }
        if (typeof match[2] === 'string') {
            return Number(match[2]) > 0;
        }
        return true;
    }

    function shouldShowParkingPin(options = {}) {
        const distanceKm = Number(options.distanceKm);
        if (!options.travelModeActive || !Number.isFinite(distanceKm) || distanceKm < 0 || distanceKm > PARKING_DISTANCE_KM) {
            return false;
        }
        if (![VEHICLE_CAR, VEHICLE_MOTORCYCLE].includes(options.vehicleMode)) {
            return false;
        }
        return readParkingAvailability(options.description, options.vehicleMode);
    }

    return {
        PARKING_CATEGORY,
        PARKING_DISTANCE_KM,
        VEHICLE_CAR,
        VEHICLE_MOTORCYCLE,
        normalizeVehicleMode,
        readParkingAvailability,
        shouldShowParkingPin
    };
}));
