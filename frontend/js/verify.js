(function () {
  const { $, el, badge, formatTs, readContract, api, explainError } = window.App;
  const result = $("#result");

  function show(type, title, rows = [], note = null) {
    result.className = `result ${type}`;
    result.textContent = "";
    result.append(el("div", { class: "title", text: title }));
    if (rows.length) {
      const dl = el("dl");
      for (const [k, v] of rows) dl.append(el("dt", { text: k }), v instanceof Node ? el("dd", {}, v) : el("dd", { text: v }));
      result.append(dl);
    }
    if (note) result.append(el("p", { class: "hint", text: note }));
  }

  async function issuerLabel(address) {
    try {
      const p = await api(`/api/public/issuers/${address}`);
      return `${p.displayName} — ${p.institution}`;
    } catch {
      return "(profil issuer belum diisi Admin)";
    }
  }

  async function verifyHash(hash) {
    show("neutral", "Memeriksa blockchain…", [["Hash", el("span", { class: "mono", text: hash })]]);
    try {
      const r = await readContract.verify(hash);
      if (!r.exists) {
        return show(
          "bad",
          "✖ TIDAK DITEMUKAN",
          [["Hash", el("span", { class: "mono", text: hash })]],
          "Sertifikat ini tidak terdaftar. Kemungkinan file palsu, sudah diedit, atau bukan file asli yang diterbitkan."
        );
      }
      const name = await issuerLabel(r.issuer);
      const rows = [
        ["Status", r.revoked ? badge("DICABUT", "bad") : badge("VALID", "ok")],
        ["Diterbitkan oleh", name],
        ["Wallet issuer", el("span", { class: "mono", text: r.issuer })],
        ["Tanggal terbit", formatTs(r.issuedAt)],
      ];
      if (r.revoked) rows.push(["Tanggal dicabut", formatTs(r.revokedAt)]);
      rows.push(["Status issuer saat ini", r.issuerActive ? badge("Aktif", "ok") : badge("Tidak aktif", "warn")]);
      rows.push(["Hash", el("span", { class: "mono", text: hash })]);

      if (r.revoked) {
        show("bad", "⚠ SERTIFIKAT DICABUT", rows, "Sertifikat ini pernah diterbitkan tetapi sudah dicabut, sehingga TIDAK berlaku lagi.");
      } else {
        show(
          "ok",
          "✔ SERTIFIKAT VALID",
          rows,
          r.issuerActive ? null : "Catatan: issuer sudah dinonaktifkan Admin setelah sertifikat ini terbit. Sertifikat tetap tercatat valid."
        );
      }
    } catch (err) {
      show("bad", "Gagal memeriksa", [], explainError(err));
    }
  }

  async function handleFile(file) {
    const info = $("#file-info");
    info.textContent = "";
    try {
      const { hash, name, size } = await window.CertHash.hashPdfFile(file);
      info.textContent = `${name} (${(size / 1024).toFixed(1)} KB)`;
      await verifyHash(hash);
    } catch (err) {
      show("bad", "File tidak valid", [], err.message);
    }
  }

  const input = $("#pdf-input");
  input.addEventListener("change", () => {
    if (input.files[0]) handleFile(input.files[0]);
    input.value = "";
  });

  const dz = $("#dropzone");
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  $("#hash-btn").addEventListener("click", () => {
    const v = $("#hash-input").value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(v)) return show("bad", "Hash tidak valid", [], "Format: 0x diikuti 64 karakter hex.");
    verifyHash(v.toLowerCase());
  });
})();
