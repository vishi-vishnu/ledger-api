const { pool } = require('../db');
const { AppError } = require('../errors');
const { isUuid } = require('../validators');

async function createAccount(body) {
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new AppError(400, 'VALIDATION_ERROR', 'name is required');
  if (name.length > 100) throw new AppError(400, 'VALIDATION_ERROR', 'name must be at most 100 characters');

  // Any "balance" sent by the client is ignored; balance always starts at 0 (DB default).
  const { rows } = await pool.query(
    'INSERT INTO accounts (name) VALUES ($1) RETURNING id, name, balance, created_at',
    [name]
  );
  return rows[0];
}

async function getBalance(accountId) {
  if (!isUuid(accountId)) throw new AppError(400, 'INVALID_ACCOUNT_ID', 'Account id is not a valid UUID');
  const { rows } = await pool.query('SELECT id, balance FROM accounts WHERE id = $1', [accountId]);
  if (!rows.length) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');
  return { account_id: rows[0].id, balance: rows[0].balance };
}

module.exports = { createAccount, getBalance };
