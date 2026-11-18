const app = require("./app");
const config = require("./config");
const chain = require("./blockchain");
const pool = require("./db");

async function start() {
  try {
    await pool.query("SELECT 1 FROM certificates LIMIT 1");
  } catch (err) {
    console.error("MySQL belum siap:", err.message, "\n-> Cek .env lalu jalankan: npm run db:setup");
  }
  if (!(await chain.isReachable())) {
    console.error(
      `Contract tidak ditemukan di ${config.rpcUrl}.\n` +
        "-> Pastikan 'npm run node' berjalan di folder blockchain, lalu 'npm run deploy:local'."
    );
  }
  app.listen(config.port, () => {
    console.log(`Certificate Registry berjalan di http://localhost:${config.port}`);
    console.log(`Contract: ${config.contract.address} | RPC: ${config.rpcUrl}`);
  });
}

start();
