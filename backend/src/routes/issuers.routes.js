// Profil issuer (khusus admin). Hak issuer sendiri diatur di contract, tabel ini
// hanya menyimpan nama dan institusi.
const express = require("express");
const pool = require("../db");
const chain = require("../blockchain");
const v = require("../validators");
const { requireRole } = require("../auth");

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const SELECT = "SELECT wallet_address, display_name, institution, created_by, created_at, updated_at FROM issuer_profiles";

const toDto = (r) =>
  r && {
    address: r.wallet_address,
    displayName: r.display_name,
    institution: r.institution,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

router.use(requireRole("ADMIN"));

router.get(
  "/",
  wrap(async (req, res) => {
    const onchain = await chain.getIssuers();
    const [rows] = await pool.execute(SELECT);
    const profiles = new Map(rows.map((r) => [r.wallet_address, toDto(r)]));
    const items = onchain.map((i) => ({ address: i.address, active: i.active, onchain: true, profile: profiles.get(i.address) || null }));
    for (const [address, profile] of profiles) {
      if (!onchain.some((i) => i.address === address)) items.push({ address, active: false, onchain: false, profile });
    }
    res.json({ items });
  })
);

router.get(
  "/:address/profile",
  wrap(async (req, res) => {
    const address = v.address(req.params.address);
    const [rows] = await pool.execute(`${SELECT} WHERE wallet_address = ?`, [address]);
    if (!rows[0]) return res.status(404).json({ error: "Profil tidak ditemukan" });
    res.json(toDto(rows[0]));
  })
);

router.put(
  "/:address/profile",
  wrap(async (req, res) => {
    const address = v.address(req.params.address);
    const p = v.issuerProfile(req.body);
    await pool.execute(
      `INSERT INTO issuer_profiles (wallet_address, display_name, institution, created_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), institution = VALUES(institution)`,
      [address, p.displayName, p.institution, req.user.address]
    );
    const [rows] = await pool.execute(`${SELECT} WHERE wallet_address = ?`, [address]);
    res.json(toDto(rows[0]));
  })
);

router.delete(
  "/:address/profile",
  wrap(async (req, res) => {
    const address = v.address(req.params.address);
    const [result] = await pool.execute("DELETE FROM issuer_profiles WHERE wallet_address = ?", [address]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Profil tidak ditemukan" });
    res.json({ deleted: true, address });
  })
);

module.exports = router;
