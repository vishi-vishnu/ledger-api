const express = require('express');
const accounts = require('./routes/accounts');
const transfers = require('./routes/transfers');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/accounts', accounts);
app.use('/transfers', transfers);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
