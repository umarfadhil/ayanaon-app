const express = require('express');
const bodyParser = require('body-parser');
const serverless = require('serverless-http');

const app = express();
const router = express.Router();

app.use(bodyParser.json());

let pins = [];

router.get('/pins', (req, res) => {
    res.json(pins);
});

router.post('/pins', (req, res) => {
    const pin = req.body;
    pin.id = Date.now();
    pins.push(pin);
    res.json(pin);

    // Remove pin after 1 hour
    setTimeout(() => {
        pins = pins.filter(p => p.id !== pin.id);
    }, 3600000);
});

app.use('/', router);

module.exports.handler = serverless(app);
