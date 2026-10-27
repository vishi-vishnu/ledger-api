const { pool, withTransaction } = require('../db');
const { AppError } = require('../errors');
const { isUuid, parseAmount, parsePositiveInt } = require('../validators');

const TYPES = ['credit', 'debit'];

// Core logic. MUST be called inside a DB transaction, after the account row is locked.
async function applyTransaction(client, accountId, { type, amount, description, referenceId }) {
  const dup = await client.query(
    'SELECT * FROM transactions WHERE account_id = $1 AND reference_id = $2',
    [accountId, referenceId]
  );
  if (dup.rowCount) {
    throw new AppError(409, 'DUPLICATE_TRANSACTION',
      'A transaction with this reference_id already exists for this account',
      { transaction: dup.rows[0] });
  }

  // Update balance first. For debit the WHERE clause guarantees enough funds.
  const sql = type === 'credit'
    ? 'UPDATE accounts SET balance = balance + $1 WHERE id = $2 RETURNING balance'
    : 'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance';
  const upd = await client.query(sql, [amount, accountId]);
  if (!upd.rowCount) throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit');

  const ins = await client.query(
    `INSERT INTO transactions (account_id, type, amount, description, reference_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [accountId, type, amount, description, referenceId]
  );
  return { transaction: ins.rows[0], balance: upd.rows[0].balance };
}

async function addTransaction(accountId, body) {
  if (!isUuid(accountId)) throw new AppError(400, 'INVALID_ACCOUNT_ID', 'Account id is not a valid UUID');
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object');
  }

  const { type, amount, description, reference_id } = body;
  if (!TYPES.includes(type)) throw new AppError(400, 'INVALID_TRANSACTION_TYPE', "type must be 'credit' or 'debit'");
  const cleanAmount = parseAmount(amount);
  if (!cleanAmount) throw new AppError(400, 'INVALID_AMOUNT', 'amount must be a number greater than 0 with at most 2 decimals');
  if (typeof reference_id !== 'string' || !reference_id.trim() || reference_id.length > 100) {
    throw new AppError(400, 'VALIDATION_ERROR', 'reference_id is required (non-empty string, max 100 chars)');
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'description must be a string');
  }

  return withTransaction(async (client) => {
    // Row lock: concurrent requests on the same account wait their turn.
    const acc = await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!acc.rowCount) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');

    return applyTransaction(client, accountId, {
      type,
      amount: cleanAmount,
      description: description || null,
      referenceId: reference_id.trim(),
    });
  });
}

async function listTransactions(accountId, query) {
  if (!isUuid(accountId)) throw new AppError(400, 'INVALID_ACCOUNT_ID', 'Account id is not a valid UUID');

  const { type } = query;
  if (type !== undefined && !TYPES.includes(type)) {
    throw new AppError(400, 'INVALID_TRANSACTION_TYPE', "type must be 'credit' or 'debit'");
  }
  const page = query.page === undefined ? 1 : parsePositiveInt(query.page);
  const limit = query.limit === undefined ? 10 : parsePositiveInt(query.limit);
  if (!page) throw new AppError(400, 'INVALID_PAGINATION', 'page must be a positive integer');
  if (!limit || limit > 100) throw new AppError(400, 'INVALID_PAGINATION', 'limit must be an integer between 1 and 100');

  const acc = await pool.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
  if (!acc.rowCount) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Account not found');

  const params = [accountId];
  let where = 'account_id = $1';
  if (type) { params.push(type); where += ` AND type = $${params.length}`; }

  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM transactions WHERE ${where}`, params);
  const total = count.rows[0].total;

  const rows = await pool.query(
    `SELECT * FROM transactions WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );

  return {
    data: rows.rows,
    pagination: { page, limit, total_records: total, total_pages: Math.ceil(total / limit) },
  };
}

// BONUS: transfer money between two accounts, atomically.
async function transfer(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object');
  }
  const { from_account_id, to_account_id, amount, description } = body;
  if (!isUuid(from_account_id) || !isUuid(to_account_id)) {
    throw new AppError(400, 'INVALID_ACCOUNT_ID', 'from_account_id and to_account_id must be valid UUIDs');
  }
  if (from_account_id === to_account_id) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Cannot transfer to the same account');
  }
  const cleanAmount = parseAmount(amount);
  if (!cleanAmount) throw new AppError(400, 'INVALID_AMOUNT', 'amount must be a number greater than 0 with at most 2 decimals');

  return withTransaction(async (client) => {
    // Lock both rows in a fixed order (sorted by id) to avoid deadlocks.
    const locked = await client.query(
      'SELECT id FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[from_account_id, to_account_id]]
    );
    if (locked.rowCount !== 2) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'One or both accounts not found');

    const transferId = require('crypto').randomUUID();
    const note = description || 'Transfer';
    const debit = await applyTransaction(client, from_account_id, {
      type: 'debit', amount: cleanAmount, description: note, referenceId: `transfer:${transferId}:debit`,
    });
    const credit = await applyTransaction(client, to_account_id, {
      type: 'credit', amount: cleanAmount, description: note, referenceId: `transfer:${transferId}:credit`,
    });

    return {
      transfer_id: transferId,
      amount: cleanAmount,
      from: { account_id: from_account_id, balance: debit.balance, transaction: debit.transaction },
      to: { account_id: to_account_id, balance: credit.balance, transaction: credit.transaction },
    };
  });
}

module.exports = { addTransaction, listTransactions, transfer };
