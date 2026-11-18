const path = require("path");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const config = require("./config");
const pool = require("./db");
const chain = require("./blockchain");

const app = express();
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"],
        "connect-src": ["'self'", config.rpcUrl],
        "img-src": ["'self'", "data:"],
        "upgrade-insecure-requests": null, // masih http di lokal
      },
    },
  })
);

app.use(express.json({ limit: "20kb" }));

const isTest = process.env.NODE_ENV === "test";
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, limit: isTest ? 10000 : 600, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth/", rateLimit({ windowMs: 15 * 60 * 1000, limit: isTest ? 10000 : 60, standardHeaders: true, legacyHeaders: false }));

app.get("/api/health", async (req, res) => {
  let database = false;
  try {
    await pool.query("SELECT 1");
    database = true;
  } catch {}
  const blockchain = await chain.isReachable();
  res.status(database && blockchain ? 200 : 503).json({ database, blockchain, contract: config.contract.address });
});

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/certificates", require("./routes/certificates.routes"));
app.use("/api/issuers", require("./routes/issuers.routes"));
app.use("/api/public", require("./routes/public.routes"));
app.use("/api", (req, res) => res.status(404).json({ error: "Endpoint tidak ditemukan" }));

// ethers untuk browser diambil dari node_modules. require.resolve tidak bisa dipakai
// karena package ethers membatasi path lewat "exports".
const ETHERS_UMD = path.join(__dirname, "..", "node_modules", "ethers", "dist", "ethers.umd.min.js");
app.get("/vendor/ethers.umd.min.js", (req, res) => {
  res.type("application/javascript").sendFile(ETHERS_UMD);
});
app.use(express.static(path.join(__dirname, "..", "..", "frontend"), { extensions: ["html"] }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON tidak valid" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request terlalu besar" });
  const status = err.status && err.status < 500 ? err.status : 500;
  if (status === 500) console.error("[ERROR]", err);
  res.status(status).json({ error: status === 500 ? "Terjadi kesalahan di server" : err.message });
});

module.exports = app;
