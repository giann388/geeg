// Hash SHA-256 file PDF di browser; file tidak dikirim ke server.
// Juga dipakai di backend/test/hash.test.js.
(function (root) {
  const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
  const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function sha256Hex(arrayBuffer) {
    const digest = await root.crypto.subtle.digest("SHA-256", arrayBuffer);
    return "0x" + toHex(digest);
  }

  function hasPdfSignature(arrayBuffer) {
    const head = new Uint8Array(arrayBuffer.slice(0, PDF_MAGIC.length));
    return PDF_MAGIC.every((b, i) => head[i] === b);
  }

  function validatePdfMeta(file) {
    if (!file) throw new Error("Pilih file PDF terlebih dahulu.");
    if (!/\.pdf$/i.test(file.name)) throw new Error("File harus berekstensi .pdf");
    if (file.type && file.type !== "application/pdf") throw new Error("Tipe file harus application/pdf");
    if (file.size === 0) throw new Error("File kosong.");
    if (file.size > MAX_PDF_BYTES) throw new Error("Ukuran file maksimal 10 MB.");
  }

  async function hashPdfFile(file) {
    validatePdfMeta(file);
    const buffer = await file.arrayBuffer();
    if (!hasPdfSignature(buffer)) throw new Error("Isi file bukan PDF yang valid (signature %PDF- tidak ditemukan).");
    return { hash: await sha256Hex(buffer), name: file.name, size: file.size };
  }

  const api = { MAX_PDF_BYTES, sha256Hex, hasPdfSignature, validatePdfMeta, hashPdfFile };
  root.CertHash = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
