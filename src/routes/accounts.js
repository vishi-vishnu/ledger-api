const express = require('express');
const accountService = require('../services/accountService');
const txService = require('../services/transactionService');
const { AppError } = require('../errors');

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.post('/', wrap(async (req, res) => {
  res.status(201).json(await accountService.createAccount(req.body));
}));

router.get('/:id/balance', wrap(async (req, res) => {
  res.json(await accountService.getBalance(req.params.id));
}));

router.post('/:id/transactions', wrap(async (req, res) => {
  const result = await txService.addTransaction(req.params.id, req.body);
  res.status(201).json(result);
}));

router.get('/:id/transactions', wrap(async (req, res) => {
  res.json(await txService.listTransactions(req.params.id, req.query));
}));

// Transactions are immutable: explicitly reject edit/delete attempts.
router.all('/:id/transactions/:txId', (req, res, next) => {
  next(new AppError(405, 'METHOD_NOT_ALLOWED', 'Transactions are immutable and cannot be modified or deleted'));
});

module.exports = router;
