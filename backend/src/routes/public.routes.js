// Endpoint publik. Jangan kembalikan data mahasiswa di sini: semua hash sertifikat
// terlihat di blockchain, jadi siapa pun bisa memanggil endpoint dengan hash yang valid.
const express = require("express");
const pool = require("../db");
const v = require("../validators");

const router = express.Router();

router.get("/issuers/:address", async (req, res, next) => {
  try {
    const address = v.address(req.params.address);
    const [rows] = await pool.execute("SELECT display_name, institution FROM issuer_profiles WHERE wallet_address = ?", [address]);
    if (!rows[0]) return res.status(404).json({ error: "Profil issuer tidak ditemukan" });
    res.json({ address, displayName: rows[0].display_name, institution: rows[0].institution });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
