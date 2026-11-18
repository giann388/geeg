// node scripts/db.js setup | seed | reset
// reset menghapus seluruh database lalu membuatnya ulang.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function runFile(conn, file) {
  const sql = fs.readFileSync(path.join(__dirname, "..", "database", file), "utf8");
  await conn.query(sql);
  console.log(`OK  ${file}`);
}

async function main() {
  const cmd = process.argv[2];
  if (!["setup", "seed", "reset"].includes(cmd)) {
    console.log("Pemakaian: node scripts/db.js <setup|seed|reset>");
    process.exit(1);
  }
  const dbName = process.env.DB_NAME || "certificate_registry";
  if (dbName !== "certificate_registry") {
    console.warn(`Perhatian: file SQL memakai nama database 'certificate_registry', tetapi DB_NAME=${dbName}.`);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true, // hanya untuk script ini, aplikasi tetap false
  });

  try {
    if (cmd === "reset") {
      await conn.query("DROP DATABASE IF EXISTS certificate_registry");
      console.log("OK  database lama dihapus");
      await runFile(conn, "schema.sql");
      await runFile(conn, "seed.sql");
    } else if (cmd === "setup") {
      await runFile(conn, "schema.sql");
    } else {
      await runFile(conn, "seed.sql");
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Gagal:", err.message);
  process.exit(1);
});
