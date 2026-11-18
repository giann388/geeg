// Data disimpan dulu di MySQL sebagai PENDING, baru issue() lewat MetaMask.
// Kalau transaksi gagal, draft bisa diterbitkan ulang atau dihapus.
(function () {
  const A = window.App;
  const { $, el, badge, shortHex, toast, api, explainError, withBusy, confirmDialog } = A;

  const connectBtn = $("#connect-btn");
  const disconnectBtn = $("#disconnect-btn");
  const area = $("#issuer-area");
  const notIssuer = $("#not-issuer");
  let selectedPdf = null; // { hash, name, size }

  const CONSISTENCY_TEXT = {
    OK: null,
    NOT_ON_CHAIN: "Belum tercatat di blockchain",
    OFFCHAIN_MISSING: "Data mahasiswa belum ada di database",
    RECIPIENT_MISMATCH: "Kode penerima di blockchain belum diperbarui",
    ISSUER_MISMATCH: "Konflik issuer",
  };

  let manualConnect = false;

  function showWrongRole(role) {
    area.classList.add("hidden");
    notIssuer.textContent =
      role === "ADMIN"
        ? "Wallet ini adalah ADMIN. Admin tidak menerbitkan sertifikat; gunakan halaman Admin, atau ganti akun MetaMask ke wallet Issuer."
        : "Wallet ini belum terdaftar sebagai Issuer aktif. Minta Admin menambahkan wallet ini, lalu hubungkan ulang.";
    notIssuer.classList.remove("hidden");
  }

  async function openDashboard() {
    notIssuer.classList.add("hidden");
    area.classList.remove("hidden");
    await loadCertificates();
  }

  async function renderBar() {
    await A.renderWalletInfo($("#wallet-info"));
    disconnectBtn.classList.toggle("hidden", !A.state.address);
    connectBtn.classList.toggle("hidden", A.state.role === "ISSUER" && !!A.state.token);
  }

  async function connect() {
    manualConnect = true;
    await withBusy(connectBtn, "Menghubungkan…", async () => {
      try {
        const { role } = await A.connectWallet();
        if (role !== "ISSUER") return showWrongRole(role);
        await A.signIn();
        await openDashboard();
      } catch (err) {
        toast(explainError(err), "bad");
      }
    });
    await renderBar();
  }

  async function restore() {
    const s = await A.restoreSession();
    if (!s || manualConnect) return;
    if (s.role !== "ISSUER") showWrongRole(s.role);
    else if (s.loggedIn) await openDashboard();
    await renderBar();
  }

  async function pickPdf(file) {
    const info = $("#pdf-info");
    selectedPdf = null;
    info.textContent = "Menghitung hash…";
    try {
      selectedPdf = await window.CertHash.hashPdfFile(file);
      info.textContent = "";
      info.append(
        el("div", { text: `${selectedPdf.name} (${(selectedPdf.size / 1024).toFixed(1)} KB)` }),
        el("div", { class: "mono", text: `SHA-256: ${selectedPdf.hash}` })
      );
      const existing = await A.readContract.verify(selectedPdf.hash);
      if (existing.exists) {
        info.append(el("div", {}, badge("File ini SUDAH terdaftar di blockchain (tidak bisa diterbitkan lagi)", "bad")));
      }
    } catch (err) {
      info.textContent = "";
      info.append(badge(err.message, "bad"));
    }
  }
  const input = $("#pdf-input");
  input.addEventListener("change", () => input.files[0] && pickPdf(input.files[0]));
  const dz = $("#dropzone");
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("drag");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) pickPdf(e.dataTransfer.files[0]);
  });

  async function issueOnChain(certHash, recipientCode) {
    const { tx } = await A.sendTx("issue", [certHash, recipientCode], "Menerbitkan sertifikat di blockchain…");
    try {
      await api(`/api/certificates/${certHash}/sync`, { method: "POST", auth: true, body: { txHash: tx.hash } });
    } catch {
      // tidak fatal, status diperbaiki saat daftar dimuat ulang
    }
  }

  $("#issue-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selectedPdf) return toast("Pilih file PDF yang valid terlebih dahulu.", "bad");
    const certHash = selectedPdf.hash;
    const body = {
      certHash,
      studentName: $("#f-name").value,
      studentNim: $("#f-nim").value,
      courseName: $("#f-course").value,
      grade: $("#f-grade").value,
      issueDate: $("#f-date").value,
    };

    await withBusy($("#issue-btn"), "Memproses…", async () => {
      try {
        const existing = await A.readContract.verify(certHash);
        if (existing.exists) throw new Error("Sertifikat dengan file ini sudah terdaftar di blockchain (duplikat).");

        // kalau draft untuk file ini sudah ada, lanjutkan dengan data draft itu
        let recipientCode;
        try {
          recipientCode = (await api("/api/certificates", { method: "POST", auth: true, body })).recipientCode;
        } catch (err) {
          if (err.status !== 409) throw err;
          const current = await api(`/api/certificates/${certHash}`, { auth: true });
          recipientCode = current.offchain.recipientCode;
          toast("Draft untuk file ini sudah ada; melanjutkan penerbitan dengan data draft tersebut.");
        }

        try {
          await issueOnChain(certHash, recipientCode);
        } catch (err) {
          toast(`Data tersimpan sebagai PENDING tetapi belum terbit: ${explainError(err)}`, "bad");
          await loadCertificates();
          return;
        }
        toast("Sertifikat berhasil diterbitkan!", "ok");
        e.target.reset();
        $("#f-date").value = new Date().toISOString().slice(0, 10); // reset() mengosongkan tanggal
        selectedPdf = null;
        $("#pdf-info").textContent = "";
        await loadCertificates();
      } catch (err) {
        toast(explainError(err), "bad");
      }
    });
  });

  async function loadCertificates() {
    const tbody = $("#cert-rows");
    try {
      const { items } = await api("/api/certificates", { auth: true });
      tbody.textContent = "";
      if (!items.length) {
        tbody.append(el("tr", {}, el("td", { colspan: "5", class: "empty", text: "Belum ada sertifikat." })));
        return;
      }
      for (const it of items) tbody.append(row(it));
    } catch (err) {
      tbody.textContent = "";
      tbody.append(el("tr", {}, el("td", { colspan: "5", class: "empty", text: explainError(err) })));
    }
  }

  function row(it) {
    const off = it.offchain;
    const statusType = it.status === "ISSUED" ? "ok" : it.status === "REVOKED" ? "bad" : "warn";
    const warn = CONSISTENCY_TEXT[it.consistency];
    const actions = el("td");
    const btn = (text, cls, fn) => actions.append(el("button", { class: `small ${cls}`, text, onclick: (e) => fn(e.target) }));

    if (it.consistency === "NOT_ON_CHAIN") {
      btn("Terbitkan", "", (b) => retryIssue(it, b));
      btn("Hapus draft", "secondary", (b) => deleteCert(it.certHash, b));
    }
    if (it.consistency === "OFFCHAIN_MISSING") btn("Lengkapi data", "", () => openEdit(it, true));
    if (it.consistency === "RECIPIENT_MISMATCH" && !it.onchain.revoked) btn("Perbarui di blockchain", "", (b) => fixRecipient(it, b));
    if (off && it.onchain.exists && !it.onchain.revoked) btn("Edit", "secondary", () => openEdit(it, false));
    if (off && !it.onchain.exists) btn("Edit", "secondary", () => openEdit(it, false));
    if (it.onchain.exists && !it.onchain.revoked) btn("Cabut", "danger", (b) => revoke(it.certHash, b));
    if (off && it.onchain.revoked) btn("Hapus data", "secondary", (b) => deleteCert(it.certHash, b));
    btn("Sinkronkan", "secondary", (b) => sync(it.certHash, b));

    return el(
      "tr",
      {},
      el("td", { class: "mono", title: it.certHash, text: shortHex(it.certHash, 10) }),
      el("td", {}, off ? el("div", { text: off.studentName }) : "-", off ? el("div", { class: "hint", text: off.studentNim }) : null),
      el("td", {}, off ? el("div", { text: off.courseName }) : "-", off ? el("div", { class: "hint", text: `Nilai: ${off.grade} • ${off.issueDate}` }) : null),
      el("td", {}, badge(it.status, statusType), warn ? el("div", { style: "margin-top:4px" }, badge(warn, "warn")) : null),
      actions
    );
  }

  async function retryIssue(it, button) {
    await withBusy(button, "…", async () => {
      try {
        await issueOnChain(it.certHash, it.offchain.recipientCode);
        toast("Sertifikat berhasil diterbitkan!", "ok");
      } catch (err) {
        toast(explainError(err), "bad");
      }
      await loadCertificates();
    });
  }

  async function fixRecipient(it, button) {
    await withBusy(button, "…", async () => {
      try {
        await A.sendTx("updateMetadata", [it.certHash, it.offchain.recipientCode], "Memperbarui kode penerima di blockchain…");
        await api(`/api/certificates/${it.certHash}/sync`, { method: "POST", auth: true, body: {} });
        toast("Data blockchain sudah sesuai.", "ok");
      } catch (err) {
        toast(explainError(err), "bad");
      }
      await loadCertificates();
    });
  }

  async function revoke(certHash, button) {
    const ok = await confirmDialog(
      "Cabut sertifikat?",
      "Sertifikat akan berstatus DICABUT selamanya. Riwayat penerbitan tetap tercatat di blockchain dan tindakan ini tidak bisa dibatalkan.",
      "Cabut sertifikat"
    );
    if (!ok) return;
    await withBusy(button, "…", async () => {
      try {
        await A.sendTx("revoke", [certHash], "Mencabut sertifikat…");
        await api(`/api/certificates/${certHash}/sync`, { method: "POST", auth: true, body: {} }).catch(() => {});
        toast("Sertifikat dicabut.", "ok");
      } catch (err) {
        toast(explainError(err), "bad");
      }
      await loadCertificates();
    });
  }

  async function deleteCert(certHash, button) {
    if (!(await confirmDialog("Hapus data off-chain?", "Data mahasiswa untuk hash ini akan dihapus dari database.", "Hapus"))) return;
    await withBusy(button, "…", async () => {
      try {
        await api(`/api/certificates/${certHash}`, { method: "DELETE", auth: true });
        toast("Data dihapus.", "ok");
      } catch (err) {
        toast(explainError(err), "bad");
      }
      await loadCertificates();
    });
  }

  async function sync(certHash, button) {
    await withBusy(button, "…", async () => {
      try {
        await api(`/api/certificates/${certHash}/sync`, { method: "POST", auth: true, body: {} }).catch((e) => {
          if (e.status !== 404) throw e;
        });
        toast("Status disinkronkan dengan blockchain.", "ok");
      } catch (err) {
        toast(explainError(err), "bad");
      }
      await loadCertificates();
    });
  }

  const dlg = $("#edit-dialog");
  let editing = null; // { certHash, createMode }
  function openEdit(it, createMode) {
    editing = { certHash: it.certHash, createMode };
    $("#edit-title").textContent = createMode ? "Lengkapi data sertifikat" : "Edit data sertifikat";
    $("#edit-hash").textContent = it.certHash;
    const o = it.offchain || {};
    $("#e-name").value = o.studentName || "";
    $("#e-nim").value = o.studentNim || "";
    $("#e-course").value = o.courseName || "";
    $("#e-grade").value = o.grade || "";
    $("#e-date").value = o.issueDate || "";
    dlg.showModal();
  }
  $("#edit-cancel").addEventListener("click", () => dlg.close());
  $("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      studentName: $("#e-name").value,
      studentNim: $("#e-nim").value,
      courseName: $("#e-course").value,
      grade: $("#e-grade").value,
      issueDate: $("#e-date").value,
    };
    await withBusy($("#edit-save"), "Menyimpan…", async () => {
      try {
        let res;
        if (editing.createMode) {
          res = await api("/api/certificates", { method: "POST", auth: true, body: { certHash: editing.certHash, ...body } });
        } else {
          res = await api(`/api/certificates/${editing.certHash}`, { method: "PUT", auth: true, body });
        }
        dlg.close();
        toast("Data off-chain disimpan.", "ok");
        // NIM berubah, kode penerima di blockchain ikut diperbarui
        if (res.consistency === "RECIPIENT_MISMATCH" && res.onchain.exists && !res.onchain.revoked) {
          try {
            await A.sendTx("updateMetadata", [editing.certHash, res.recipientCode], "Memperbarui kode penerima di blockchain…");
            await api(`/api/certificates/${editing.certHash}/sync`, { method: "POST", auth: true, body: {} });
            toast("Kode penerima di blockchain diperbarui.", "ok");
          } catch (err) {
            toast(`Blockchain belum diperbarui: ${explainError(err)}. Klik "Perbarui di blockchain" untuk mencoba lagi.`, "bad");
          }
        }
      } catch (err) {
        toast(explainError(err), "bad");
      }
      await loadCertificates();
    });
  });

  connectBtn.addEventListener("click", connect);
  disconnectBtn.addEventListener("click", async () => {
    await A.disconnect();
    location.reload();
  });
  $("#refresh-btn").addEventListener("click", loadCertificates);
  $("#f-date").value = new Date().toISOString().slice(0, 10);
  restore();
})();
