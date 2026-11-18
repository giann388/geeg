// Test untuk frontend/js/hash.js. Tidak butuh blockchain atau MySQL.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const CertHash = require("../../frontend/js/hash.js");

const SAMPLES = path.join(__dirname, "..", "..", "docs", "sample-certificates");
const read = (name) => fs.readFileSync(path.join(SAMPLES, name));
const asFile = (buf, name = "x.pdf", type = "application/pdf") => ({
  name,
  type,
  size: buf.length,
  arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
});

test("hash browser = SHA-256 standar (sama dengan sha256sum)", async () => {
  const buf = read("sertifikat-budi-santoso.pdf");
  const { hash } = await CertHash.hashPdfFile(asFile(buf, "sertifikat-budi-santoso.pdf"));
  assert.equal(hash, "0x" + crypto.createHash("sha256").update(buf).digest("hex"));
  assert.match(hash, /^0x[0-9a-f]{64}$/);
});

test("file yang sama -> hash yang sama (deterministik)", async () => {
  const buf = read("sertifikat-citra-dewi.pdf");
  const a = await CertHash.hashPdfFile(asFile(buf));
  const b = await CertHash.hashPdfFile(asFile(Buffer.from(buf)));
  assert.equal(a.hash, b.hash);
});

test("file diubah 1 byte -> hash berbeda total", async () => {
  const buf = read("sertifikat-budi-santoso.pdf");
  const modified = Buffer.from(buf);
  modified[modified.length - 10] ^= 0x01;
  const a = await CertHash.hashPdfFile(asFile(buf));
  const b = await CertHash.hashPdfFile(asFile(modified));
  assert.notEqual(a.hash, b.hash);
});

test("sertifikat palsu (nilai diubah) punya hash berbeda dari aslinya", async () => {
  const asli = await CertHash.hashPdfFile(asFile(read("sertifikat-budi-santoso.pdf")));
  const palsu = await CertHash.hashPdfFile(asFile(read("PALSU-sertifikat-budi-nilai-diubah.pdf")));
  assert.notEqual(asli.hash, palsu.hash);
});

test("validasi file: bukan .pdf, tipe salah, kosong, terlalu besar, isi bukan PDF", async () => {
  const pdf = read("sertifikat-budi-santoso.pdf");
  await assert.rejects(CertHash.hashPdfFile(asFile(pdf, "cert.exe")), /\.pdf/);
  await assert.rejects(CertHash.hashPdfFile(asFile(pdf, "cert.pdf", "text/html")), /application\/pdf/);
  await assert.rejects(CertHash.hashPdfFile(asFile(Buffer.alloc(0))), /kosong/);
  await assert.rejects(CertHash.hashPdfFile({ ...asFile(pdf), size: CertHash.MAX_PDF_BYTES + 1 }), /10 MB/);
  await assert.rejects(CertHash.hashPdfFile(asFile(Buffer.from("<html>bukan pdf</html>"), "palsu.pdf")), /bukan PDF/);
  await assert.rejects(CertHash.hashPdfFile(null), /Pilih file/);
});
