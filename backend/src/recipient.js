// Pakai HMAC, bukan hash biasa, supaya kode di blockchain tidak bisa ditebak
// dengan mencoba semua kemungkinan NIM.
const crypto = require("crypto");
const config = require("./config");

function recipientCodeFor(nim) {
  const normalized = String(nim).trim().toUpperCase();
  return "0x" + crypto.createHmac("sha256", config.recipientSecret).update(normalized).digest("hex");
}

module.exports = { recipientCodeFor };
