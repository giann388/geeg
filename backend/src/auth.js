// Login wallet: pengguna menandatangani pesan berisi nonce, backend mencocokkan
// tanda tangan dan role on-chain, lalu memberi JWT.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { ethers } = require("ethers");
const config = require("./config");
const chain = require("./blockchain");
const v = require("./validators");

const MAX_PENDING_NONCES = 10000;
const pendingNonces = new Map(); // address -> { message, expiresAt }

function purgeExpired() {
  const now = Date.now();
  for (const [addr, entry] of pendingNonces) {
    if (entry.expiresAt < now) pendingNonces.delete(addr);
  }
}

function buildLoginMessage(address) {
  purgeExpired();
  if (pendingNonces.size >= MAX_PENDING_NONCES) {
    const err = new Error("Terlalu banyak permintaan login. Coba lagi nanti.");
    err.status = 429;
    throw err;
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const message =
    `Certificate Registry - Login\n\n` +
    `Wallet: ${address}\n` +
    `Chain ID: ${config.chainId}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}\n\n` +
    `Menandatangani pesan ini TIDAK mengirim transaksi dan TIDAK memakan gas.`;
  pendingNonces.set(address, { message, expiresAt: Date.now() + config.nonceTtlMs });
  return message;
}

async function login(rawAddress, signature) {
  const address = v.address(rawAddress);
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw Object.assign(new Error("Format tanda tangan tidak valid"), { status: 400 });
  }

  const entry = pendingNonces.get(address);
  pendingNonces.delete(address); // nonce hanya bisa dipakai sekali
  if (!entry || entry.expiresAt < Date.now()) {
    throw Object.assign(new Error("Pesan login tidak ditemukan atau kedaluwarsa. Minta pesan baru."), { status: 401 });
  }

  let recovered;
  try {
    recovered = ethers.verifyMessage(entry.message, signature);
  } catch {
    throw Object.assign(new Error("Tanda tangan tidak valid"), { status: 401 });
  }
  if (recovered !== address) {
    throw Object.assign(new Error("Tanda tangan bukan dari wallet ini"), { status: 401 });
  }

  const role = await chain.getRole(address);
  if (role === "VERIFIER") {
    throw Object.assign(
      new Error("Wallet ini bukan Admin/Issuer. Verifikasi sertifikat bisa dilakukan tanpa login."),
      { status: 403 }
    );
  }

  const token = jwt.sign({ role }, config.jwtSecret, {
    algorithm: "HS256",
    subject: address,
    expiresIn: config.jwtExpiresIn,
  });
  return { token, address, role, expiresIn: config.jwtExpiresIn };
}

function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    try {
      const header = req.get("authorization") || "";
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) {
        return res.status(401).json({ error: "Harus login terlebih dahulu" });
      }
      let payload;
      try {
        payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
      } catch {
        return res.status(401).json({ error: "Token tidak valid atau kedaluwarsa. Silakan login ulang." });
      }
      const address = v.address(payload.sub);

      // role dibaca ulang dari contract supaya issuer yang dinonaktifkan langsung kehilangan akses
      const role = await chain.getRole(address);
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({ error: "Akses ditolak untuk role ini", role });
      }
      req.user = { address, role };
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { buildLoginMessage, login, requireRole, _pendingNonces: pendingNonces };
