// Data sertifikat off-chain. Issuer hanya melihat datanya sendiri, admin melihat semua.
const express = require("express");
const pool = require("../db");
const chain = require("../blockchain");
const v = require("../validators");
const { requireRole } = require("../auth");
const { recipientCodeFor } = require("../recipient");
const svc = require("../services/certificates");

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Issuer lain mendapat 404, bukan 403, supaya keberadaan data tidak bocor.
async function loadOwnedRow(req, res, { allowAdmin }) {
  const certHash = v.hash(req.params.hash);
  const row = await svc.findRow(certHash);
  const isOwner = row && row.issuer_address === req.user.address;
  const isAdmin = allowAdmin && req.user.role === "ADMIN";
  if (!row || (!isOwner && !isAdmin)) {
    res.status(404).json({ error: "Data sertifikat tidak ditemukan" });
    return null;
  }
  return { certHash, row };
}

router.get(
  "/",
  requireRole("ISSUER", "ADMIN"),
  wrap(async (req, res) => {
    let items;
    if (req.user.role === "ISSUER") {
      items = await svc.listForIssuers([req.user.address], { onlyIssuer: req.user.address });
    } else {
      const issuers = (await chain.getIssuers()).map((i) => i.address);
      items = await svc.listForIssuers(issuers);
    }
    res.json({ items });
  })
);

router.get(
  "/:hash",
  requireRole("ISSUER", "ADMIN"),
  wrap(async (req, res) => {
    const certHash = v.hash(req.params.hash);
    const row = await svc.findRow(certHash);
    if (row) {
      const ok = await loadOwnedRow(req, res, { allowAdmin: true });
      if (!ok) return;
      return res.json(await svc.reconcile(certHash, row));
    }
    const onchain = await chain.getCertificate(certHash);
    if (onchain.exists && (onchain.issuer === req.user.address || req.user.role === "ADMIN")) {
      return res.json(await svc.reconcile(certHash, null));
    }
    res.status(404).json({ error: "Data sertifikat tidak ditemukan" });
  })
);

router.post(
  "/",
  requireRole("ISSUER"),
  wrap(async (req, res) => {
    const certHash = v.hash(req.body && req.body.certHash);
    const details = v.certificateDetails(req.body);

    if (await svc.findRow(certHash)) {
      return res.status(409).json({ error: "Data off-chain untuk hash ini sudah ada" });
    }
    const onchain = await chain.getCertificate(certHash);
    if (onchain.exists && onchain.issuer !== req.user.address) {
      return res.status(409).json({ error: "Sertifikat dengan file ini sudah diterbitkan oleh issuer lain" });
    }

    const recipientCode = recipientCodeFor(details.studentNim);
    const status = svc.chainStatus(onchain);
    await pool.execute(
      `INSERT INTO certificates
        (cert_hash, issuer_address, student_name, student_nim, course_name, grade, issue_date, recipient_code, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [certHash, req.user.address, details.studentName, details.studentNim, details.courseName, details.grade, details.issueDate, recipientCode, status]
    );
    const item = await svc.reconcile(certHash, await svc.findRow(certHash));
    res.status(201).json({ ...item, recipientCode });
  })
);

router.post(
  "/:hash/sync",
  requireRole("ISSUER", "ADMIN"),
  wrap(async (req, res) => {
    const owned = await loadOwnedRow(req, res, { allowAdmin: true });
    if (!owned) return;
    const { certHash, row } = owned;
    if (req.body && req.body.txHash !== undefined && req.user.address === row.issuer_address) {
      const txHash = v.hash(req.body.txHash, "txHash");
      await pool.execute("UPDATE certificates SET tx_hash = ? WHERE cert_hash = ?", [txHash, certHash]);
    }
    res.json(await svc.reconcile(certHash, await svc.findRow(certHash)));
  })
);

router.put(
  "/:hash",
  requireRole("ISSUER"),
  wrap(async (req, res) => {
    const owned = await loadOwnedRow(req, res, { allowAdmin: false });
    if (!owned) return;
    const { certHash, row } = owned;
    const details = v.certificateDetails(req.body);

    const onchain = await chain.getCertificate(certHash);
    if (onchain.revoked) {
      return res.status(409).json({ error: "Sertifikat sudah dicabut, data tidak bisa diubah" });
    }

    const recipientCode = recipientCodeFor(details.studentNim);
    await pool.execute(
      `UPDATE certificates
         SET student_name = ?, student_nim = ?, course_name = ?, grade = ?, issue_date = ?, recipient_code = ?
       WHERE cert_hash = ? AND issuer_address = ?`,
      [details.studentName, details.studentNim, details.courseName, details.grade, details.issueDate, recipientCode, certHash, req.user.address]
    );
    const item = await svc.reconcile(certHash, await svc.findRow(certHash));
    res.json({
      ...item,
      recipientCode,
      // NIM berubah, kode penerima di blockchain perlu diperbarui lewat updateMetadata()
      needsChainUpdate: onchain.exists && onchain.recipient.toLowerCase() !== recipientCode.toLowerCase(),
      previousNim: row.student_nim,
    });
  })
);

router.delete(
  "/:hash",
  requireRole("ISSUER", "ADMIN"),
  wrap(async (req, res) => {
    const owned = await loadOwnedRow(req, res, { allowAdmin: true });
    if (!owned) return;
    const { certHash } = owned;
    const onchain = await chain.getCertificate(certHash);
    // sertifikat yang masih aktif tidak boleh kehilangan datanya
    if (onchain.exists && !onchain.revoked) {
      return res.status(409).json({ error: "Sertifikat masih aktif di blockchain. Cabut (revoke) dulu sebelum menghapus data." });
    }
    await pool.execute("DELETE FROM certificates WHERE cert_hash = ?", [certHash]);
    res.json({ deleted: true, certHash });
  })
);

module.exports = router;
