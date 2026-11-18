// MySQL dan blockchain tidak bisa diupdate dalam satu transaksi, jadi setiap kali data
// dibaca, status di MySQL disamakan dengan blockchain.
const pool = require("../db");
const chain = require("../blockchain");

const COLUMNS =
  "cert_hash, issuer_address, student_name, student_nim, course_name, grade, issue_date, recipient_code, status, tx_hash, created_at, updated_at";

function chainStatus(onchain) {
  if (!onchain.exists) return "PENDING";
  return onchain.revoked ? "REVOKED" : "ISSUED";
}

function consistencyOf(row, onchain) {
  if (!row && onchain.exists) return "OFFCHAIN_MISSING";
  if (row && !onchain.exists) return "NOT_ON_CHAIN"; // masih draft
  if (!row) return "NOT_FOUND";
  if (onchain.issuer !== row.issuer_address) return "ISSUER_MISMATCH";
  if (onchain.recipient.toLowerCase() !== row.recipient_code.toLowerCase()) return "RECIPIENT_MISMATCH";
  return "OK";
}

function toDto(certHash, row, onchain) {
  return {
    certHash,
    status: row ? row.status : chainStatus(onchain),
    consistency: consistencyOf(row, onchain),
    offchain: row
      ? {
          issuerAddress: row.issuer_address,
          studentName: row.student_name,
          studentNim: row.student_nim,
          courseName: row.course_name,
          grade: row.grade,
          issueDate: row.issue_date,
          recipientCode: row.recipient_code,
          txHash: row.tx_hash,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : null,
    onchain,
  };
}

async function findRow(certHash) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM certificates WHERE cert_hash = ?`, [certHash]);
  return rows[0] || null;
}

async function reconcile(certHash, row) {
  const onchain = await chain.getCertificate(certHash);
  if (row && (!onchain.exists || onchain.issuer === row.issuer_address)) {
    const expected = chainStatus(onchain);
    if (row.status !== expected) {
      await pool.execute("UPDATE certificates SET status = ? WHERE cert_hash = ?", [expected, certHash]);
      row = { ...row, status: expected };
    }
  }
  return toDto(certHash, row, onchain);
}

async function listForIssuers(issuerAddresses, { onlyIssuer = null } = {}) {
  let rows;
  if (onlyIssuer) {
    [rows] = await pool.execute(`SELECT ${COLUMNS} FROM certificates WHERE issuer_address = ? ORDER BY created_at DESC`, [onlyIssuer]);
  } else {
    [rows] = await pool.execute(`SELECT ${COLUMNS} FROM certificates ORDER BY created_at DESC`);
  }
  const byHash = new Map(rows.map((r) => [r.cert_hash, r]));
  const hashes = new Set(byHash.keys());
  for (const addr of issuerAddresses) {
    for (const h of await chain.getCertificatesByIssuer(addr)) hashes.add(h.toLowerCase());
  }
  const items = [];
  for (const h of hashes) items.push(await reconcile(h, byHash.get(h) || null));
  return items;
}

module.exports = { COLUMNS, findRow, reconcile, listForIssuers, chainStatus };
