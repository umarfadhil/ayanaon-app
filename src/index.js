const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(bodyParser.json());

let pins = [];

app.get('/api/pins', (req, res) => {
    res.json(pins);
});

app.post('/api/pins', (req, res) => {
    const pin = req.body;
    pin.id = Date.now();
    pins.push(pin);
    res.json(pin);

    // Remove pin after 1 hour
    setTimeout(() => {
        pins = pins.filter(p => p.id !== pin.id);
    }, 3600000);
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
