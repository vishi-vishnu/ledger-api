const express = require('express');
const txService = require('../services/transactionService');

const router = express.Router();

router.post('/', (req, res, next) => {
  txService.transfer(req.body).then((r) => res.status(201).json(r)).catch(next);
});

module.exports = router;
