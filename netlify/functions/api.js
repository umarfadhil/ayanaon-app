const express = require('express');
const bodyParser = require('body-parser');
const serverless = require('serverless-http');
const { MongoClient } = require('mongodb');
const axios = require('axios');

const app = express();
const router = express.Router();

app.use(bodyParser.json());

const MONGODB_URI = process.env.MONGODB_URI;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }

    const client = await MongoClient.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    const db = await client.db('ayanaon-db');
    cachedDb = db;
    return db;
}

router.get('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const { city } = req.query;
    let pins;
    if (city) {
        pins = await db.collection('pins').find({ city: city }).toArray();
    } else {
        pins = await db.collection('pins').find({}).toArray();
    }
    res.json(pins);
});

router.post('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const pin = req.body;
    pin.createdAt = new Date();

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

    const result = await db.collection('pins').insertOne(pin);
    res.json(result.ops[0]);
});

app.use('/', router);

module.exports.handler = serverless(app);
