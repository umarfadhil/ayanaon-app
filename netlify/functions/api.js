const express = require('express');
const bodyParser = require('body-parser');
const serverless = require('serverless-http');
const { MongoClient, ObjectId } = require('mongodb');
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

async function recordIpAddress(db, ip) {
    if (!ip) return;
    const collection = db.collection('unique_ips');
    const existingIp = await collection.findOne({ ip: ip });
    if (!existingIp) {
        await collection.insertOne({ ip: ip, timestamp: new Date() });
    }
}

router.get('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const ip = req.headers['x-nf-client-connection-ip'];
    await recordIpAddress(db, ip);

    const { city } = req.query;
    let pins;
    if (city) {
        pins = await db.collection('pins').find({ city: city }).toArray();
    } else {
        pins = await db.collection('pins').find({}).toArray();
    }
    res.json(pins);
});

router.get('/unique-ips', async (req, res) => {
    const db = await connectToDatabase();
    const count = await db.collection('unique_ips').countDocuments();
    res.json({ count: count });
});

router.get('/config', (req, res) => {
    res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });
});

router.post('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const pin = req.body;
    pin.createdAt = new Date();
    pin.upvotes = 0;
    pin.downvotes = 0;
    pin.upvoterIps = [];
    pin.downvoterIps = [];

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
    const insertedPin = await db.collection('pins').findOne({ _id: result.insertedId });
    res.json(insertedPin);
});

router.post('/pins/:id/upvote', async (req, res) => {
    const db = await connectToDatabase();
    const { id } = req.params;
    const ip = req.headers['x-nf-client-connection-ip'];
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });

    if (pin.upvoterIps.includes(ip)) {
        return res.status(403).json({ message: 'You have already upvoted this pin.' });
    }

    if (pin.downvoterIps.includes(ip)) {
        // Remove from downvoters and decrement downvotes
        await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $pull: { downvoterIps: ip }, $inc: { downvotes: -1 } });
    }

    const result = await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $inc: { upvotes: 1 }, $push: { upvoterIps: ip } });
    res.json(result);
});

router.post('/pins/:id/downvote', async (req, res) => {
    const db = await connectToDatabase();
    const { id } = req.params;
    const ip = req.headers['x-nf-client-connection-ip'];
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });

    if (pin.downvoterIps.includes(ip)) {
        return res.status(403).json({ message: 'You have already downvoted this pin.' });
    }

    if (pin.upvoterIps.includes(ip)) {
        // Remove from upvoters and decrement upvotes
        await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $pull: { upvoterIps: ip }, $inc: { upvotes: -1 } });
    }

    const result = await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $inc: { downvotes: 1 }, $push: { downvoterIps: ip } });
    res.json(result);
});

app.use('/api', router);

module.exports.handler = serverless(app);
