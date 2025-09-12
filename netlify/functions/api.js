const express = require('express');
const bodyParser = require('body-parser');
const serverless = require('serverless-http');
const axios = require('axios');

const app = express();
const router = express.Router();

app.use(bodyParser.json());

let pins = [];
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

router.get('/pins', (req, res) => {
    const { city } = req.query;
    if (city) {
        const filteredPins = pins.filter(p => p.city === city);
        res.json(filteredPins);
    } else {
        res.json(pins);
    }
});

router.post('/pins', async (req, res) => {
    const pin = req.body;
    pin.id = Date.now();

    // Get city from lat/lng
    try {
        const response = await axios.get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${pin.lat},${pin.lng}&key=${GOOGLE_MAPS_API_KEY}`);
        const results = response.data.results;
        if (results.length > 0) {
            for (const component of results[0].address_components) {
                if (component.types.includes('administrative_area_level_2')) {
                    pin.city = component.long_name;
                    break;
                }
            }
        }
    } catch (error) {
        console.error('Error getting city from geocoding API:', error);
    }

    pins.push(pin);
    res.json(pin);

    // Remove pin after 1 hour
    setTimeout(() => {
        pins = pins.filter(p => p.id !== pin.id);
    }, 3600000);
});

app.use('/', router);

module.exports.handler = serverless(app);
