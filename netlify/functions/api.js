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

// Establish the database connection outside of the handler
const client = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let db;

async function connectToDatabase() {
    if (db) return db;
    try {
        await client.connect();
        db = client.db('ayanaon-db');
        return db;
    } catch (error) {
        console.error("Failed to connect to the database", error);
        throw new Error("Failed to connect to the database");
    }
}

// Immediately connect to the database when the function is initialized
connectToDatabase();

async function recordIpAddress(ip) {
    if (!ip) return;
    const db = await connectToDatabase();
    const collection = db.collection('unique_ips');
    // Use updateOne with upsert for an atomic and efficient operation
    await collection.updateOne({ ip: ip }, { $set: { timestamp: new Date() } }, { upsert: true });
}

router.get('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const ip = req.headers['x-nf-client-connection-ip'];
    await recordIpAddress(ip);

    const { city } = req.query;
    let query = { $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] };

    if (city) {
        query.city = city;
    }

    console.log('Executing pins query:', query);
    const pins = await db.collection('pins').find(query).toArray();
    res.json(pins);
});

router.get('/pins/count', async (req, res) => {
    const db = await connectToDatabase();
    const count = await db.collection('pins').countDocuments({ $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }] });
    res.json({ count: count });
});

router.get('/unique-ips', async (req, res) => {
    try {
        const db = await connectToDatabase();
        // Use estimatedDocumentCount for a faster count
        const count = await db.collection('unique_ips').estimatedDocumentCount();
        res.json({ count: count });
    } catch (error) {
        console.error('Error fetching unique IP count:', error);
        res.status(500).json({ message: 'Error fetching unique IP count' });
    }
});

router.get('/config', (req, res) => {
    res.json({ googleMapsApiKey: GOOGLE_MAPS_API_KEY });
});

router.get('/ip', (req, res) => {
    const ip = req.headers['x-nf-client-connection-ip'];
    res.json({ ip: ip });
});

router.post('/pins', async (req, res) => {
    const db = await connectToDatabase();
    const pin = req.body;
    pin.createdAt = new Date();
    pin.reporter = req.headers['x-nf-client-connection-ip']; // Add this line
    pin.upvotes = 0;
    pin.downvotes = 0;
    pin.upvoterIps = [];
    pin.downvoterIps = [];

    // Calculate expiresAt
    if (pin.lifetime) {
        let expiresAt = new Date();
        if (pin.lifetime.type === 'today') {
            expiresAt.setHours(23, 59, 59, 999);
        } else if (pin.lifetime.type === 'date' && pin.lifetime.value) {
            expiresAt = new Date(pin.lifetime.value);
            expiresAt.setHours(23, 59, 59, 999);
        }
        pin.expiresAt = expiresAt;
    } else {
        pin.expiresAt = null; // Or a default expiration if you want
    }

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

router.put('/pins/:id', async (req, res) => {
    const db = await connectToDatabase();
    const { id } = req.params;
    const ip = req.headers['x-nf-client-connection-ip'];
    const pin = await db.collection('pins').findOne({ _id: new ObjectId(id) });

    if (pin.reporter !== ip) {
        return res.status(403).json({ message: 'You are not authorized to edit this pin.' });
    }

    const { title, description, category, link, lifetime } = req.body;
    const updatedPin = {
        title,
        description,
        category,
        link,
        lifetime
    };

    const result = await db.collection('pins').updateOne({ _id: new ObjectId(id) }, { $set: updatedPin });
    res.json(result);
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
