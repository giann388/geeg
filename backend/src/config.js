const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function requireSecret(name) {
  const value = process.env[name] || "";
  if (value.length < 32 || value.startsWith("ganti_dengan")) {
    throw new Error(
      `${name} di .env belum diisi dengan benar (minimal 32 karakter acak). ` +
        `Buat dengan: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return value;
}

function loadContractConfig() {
  const file = path.join(__dirname, "contract-config.json");
  if (!fs.existsSync(file)) {
    throw new Error("src/contract-config.json belum ada. Jalankan deploy contract dulu: cd blockchain && npm run deploy:local");
  }
  const { address, abi, chainId } = JSON.parse(fs.readFileSync(file, "utf8"));
  return { address, abi, chainId };
}

const config = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "certificate_registry",
  },
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  chainId: Number(process.env.CHAIN_ID || 31337),
  jwtSecret: requireSecret("JWT_SECRET"),
  recipientSecret: requireSecret("RECIPIENT_SECRET"),
  jwtExpiresIn: Number(process.env.JWT_EXPIRES_IN || 3600),
  nonceTtlMs: 5 * 60 * 1000, // pesan login berlaku 5 menit
  contract: loadContractConfig(),
};

module.exports = config;
