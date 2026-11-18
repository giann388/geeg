(function () {
  const A = window.App;
  const { $, el, badge, shortHex, toast, api, explainError, withBusy, confirmDialog, ethers } = A;

  const connectBtn = $("#connect-btn");
  const disconnectBtn = $("#disconnect-btn");
  const area = $("#admin-area");
  const notAdmin = $("#not-admin");

  let manualConnect = false;

  function showWrongRole(role) {
    area.classList.add("hidden");
    notAdmin.textContent = `Wallet ini memiliki role ${role}, bukan ADMIN. Ganti akun di MetaMask ke wallet Admin (Hardhat Account #0).`;
    notAdmin.classList.remove("hidden");
  }

  async function openDashboard() {
    notAdmin.classList.add("hidden");
    area.classList.remove("hidden");
    await refreshAll();
  }

  async function renderBar() {
    await A.renderWalletInfo($("#wallet-info"));
    disconnectBtn.classList.toggle("hidden", !A.state.address);
    connectBtn.classList.toggle("hidden", A.state.role === "ADMIN" && !!A.state.token);
  }

  async function connect() {
    manualConnect = true;
    await withBusy(connectBtn, "Menghubungkan…", async () => {
      try {
        const { role } = await A.connectWallet();
        if (role !== "ADMIN") return showWrongRole(role);
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
    if (s.role !== "ADMIN") showWrongRole(s.role);
    else if (s.loggedIn) await openDashboard();
    await renderBar();
  }

  async function refreshAll() {
    await Promise.all([loadIssuers(), loadCertificates()]);
  }

  async function loadIssuers() {
    const tbody = $("#issuer-rows");
    try {
      const { items } = await api("/api/issuers", { auth: true });
      tbody.textContent = "";
      if (!items.length) {
        tbody.append(el("tr", {}, el("td", { colspan: "4", class: "empty", text: "Belum ada issuer." })));
        return;
      }
      for (const it of items) {
        const actions = el("td");
        if (it.onchain && it.active) {
          actions.append(el("button", { class: "small danger", text: "Nonaktifkan", onclick: (e) => setActive(it.address, false, e.target) }));
        } else {
          actions.append(el("button", { class: "small", text: "Aktifkan", onclick: (e) => setActive(it.address, true, e.target) }));
        }
        actions.append(el("button", { class: "small secondary", text: it.profile ? "Edit profil" : "Isi profil", onclick: () => openProfile(it) }));
        if (it.profile) actions.append(el("button", { class: "small secondary", text: "Hapus profil", onclick: (e) => deleteProfile(it.address, e.target) }));

        tbody.append(
          el(
            "tr",
            {},
            el("td", { class: "mono", text: it.address }),
            el(
              "td",
              {},
              it.profile ? el("div", { text: it.profile.displayName }) : badge("Profil belum diisi", "warn"),
              it.profile ? el("div", { class: "hint", text: it.profile.institution }) : null
            ),
            el("td", {}, !it.onchain ? badge("Belum pernah ditambahkan", "warn") : it.active ? badge("AKTIF", "ok") : badge("NONAKTIF", "bad")),
            actions
          )
        );
      }
    } catch (err) {
      tbody.textContent = "";
      tbody.append(el("tr", {}, el("td", { colspan: "4", class: "empty", text: explainError(err) })));
    }
  }

  async function setActive(address, active, button) {
    const ok = await confirmDialog(
      active ? "Aktifkan issuer?" : "Nonaktifkan issuer?",
      active
        ? `Wallet ${address} akan bisa menerbitkan sertifikat.`
        : `Wallet ${address} tidak bisa lagi menerbitkan, mengubah, atau mencabut sertifikat. Sertifikat yang sudah terbit TETAP valid.`,
      active ? "Aktifkan" : "Nonaktifkan",
      !active
    );
    if (!ok) return;
    await withBusy(button, "Memproses…", async () => {
      try {
        await A.sendTx(active ? "addIssuer" : "removeIssuer", [address]);
        toast(active ? "Issuer diaktifkan." : "Issuer dinonaktifkan.", "ok");
        await loadIssuers();
      } catch (err) {
        toast(explainError(err), "bad");
      }
    });
  }

  $("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = $("#issuer-address").value.trim();
    const displayName = $("#issuer-name").value.trim();
    const institution = $("#issuer-inst").value.trim();
    if (!ethers.isAddress(raw)) return toast("Alamat wallet tidak valid.", "bad");
    const address = ethers.getAddress(raw);

    await withBusy($("#add-btn"), "Memproses…", async () => {
      try {
        if (!(await A.readContract.isActiveIssuer(address))) {
          await A.sendTx("addIssuer", [address], "Menambahkan issuer di blockchain…");
        }
      } catch (err) {
        return toast(explainError(err), "bad");
      }
      // kalau gagal, issuer sudah aktif dan profil bisa diisi ulang lewat "Isi profil"
      try {
        await api(`/api/issuers/${address}/profile`, { method: "PUT", auth: true, body: { displayName, institution } });
        toast("Issuer berhasil ditambahkan.", "ok");
        e.target.reset();
      } catch (err) {
        toast(`Issuer aktif di blockchain, tetapi profil gagal disimpan: ${explainError(err)}. Klik "Isi profil" untuk mencoba lagi.`, "bad");
      }
      await loadIssuers();
    });
  });

  const dlg = $("#profile-dialog");
  let editing = null;
  function openProfile(item) {
    editing = item.address;
    $("#profile-address").textContent = item.address;
    $("#profile-name").value = item.profile?.displayName || "";
    $("#profile-inst").value = item.profile?.institution || "";
    dlg.showModal();
  }
  $("#profile-cancel").addEventListener("click", () => dlg.close());
  $("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/api/issuers/${editing}/profile`, {
        method: "PUT",
        auth: true,
        body: { displayName: $("#profile-name").value.trim(), institution: $("#profile-inst").value.trim() },
      });
      dlg.close();
      toast("Profil disimpan.", "ok");
      await loadIssuers();
    } catch (err) {
      toast(explainError(err), "bad");
    }
  });

  async function deleteProfile(address, button) {
    if (!(await confirmDialog("Hapus profil?", "Hanya data profil off-chain yang dihapus. Status issuer di blockchain tidak berubah.", "Hapus"))) return;
    await withBusy(button, "…", async () => {
      try {
        await api(`/api/issuers/${address}/profile`, { method: "DELETE", auth: true });
        toast("Profil dihapus.", "ok");
        await loadIssuers();
      } catch (err) {
        toast(explainError(err), "bad");
      }
    });
  }

  async function loadCertificates() {
    const tbody = $("#cert-rows");
    try {
      const { items } = await api("/api/certificates", { auth: true });
      tbody.textContent = "";
      if (!items.length) {
        tbody.append(el("tr", {}, el("td", { colspan: "5", class: "empty", text: "Belum ada sertifikat." })));
        return;
      }
      for (const it of items) {
        const issuer = it.onchain.exists ? it.onchain.issuer : it.offchain?.issuerAddress;
        const statusType = it.status === "ISSUED" ? "ok" : it.status === "REVOKED" ? "bad" : "warn";
        const actions = el("td");
        if (it.onchain.exists && !it.onchain.revoked) {
          actions.append(el("button", { class: "small danger", text: "Cabut (darurat)", onclick: (e) => emergencyRevoke(it.certHash, e.target) }));
        }
        if (it.offchain && (!it.onchain.exists || it.onchain.revoked)) {
          actions.append(el("button", { class: "small secondary", text: "Hapus data", onclick: (e) => deleteCert(it.certHash, e.target) }));
        }
        tbody.append(
          el(
            "tr",
            {},
            el("td", { class: "mono", text: shortHex(it.certHash, 10) }),
            el("td", { class: "mono", text: shortHex(issuer) }),
            el("td", { text: it.offchain ? `${it.offchain.studentName} (${it.offchain.studentNim})` : "-" }),
            el("td", {}, badge(it.status, statusType), it.consistency !== "OK" ? el("div", {}, badge(it.consistency, "warn")) : null),
            actions
          )
        );
      }
    } catch (err) {
      tbody.textContent = "";
      tbody.append(el("tr", {}, el("td", { colspan: "5", class: "empty", text: explainError(err) })));
    }
  }

  async function emergencyRevoke(certHash, button) {
    if (!(await confirmDialog("Cabut sertifikat (darurat)?", "Tindakan ini permanen dan tercatat di blockchain atas nama Admin.", "Cabut"))) return;
    await withBusy(button, "…", async () => {
      try {
        await A.sendTx("revoke", [certHash], "Mencabut sertifikat…");
        try {
          await api(`/api/certificates/${certHash}/sync`, { method: "POST", auth: true, body: {} });
        } catch {}
        toast("Sertifikat dicabut.", "ok");
        await loadCertificates();
      } catch (err) {
        toast(explainError(err), "bad");
      }
    });
  }

  async function deleteCert(certHash, button) {
    if (!(await confirmDialog("Hapus data off-chain?", "Data pribadi mahasiswa untuk sertifikat ini akan dihapus dari database.", "Hapus"))) return;
    await withBusy(button, "…", async () => {
      try {
        await api(`/api/certificates/${certHash}`, { method: "DELETE", auth: true });
        toast("Data dihapus.", "ok");
        await loadCertificates();
      } catch (err) {
        toast(explainError(err), "bad");
      }
    });
  }

  connectBtn.addEventListener("click", connect);
  disconnectBtn.addEventListener("click", async () => {
    await A.disconnect();
    location.reload();
  });
  $("#refresh-issuers").addEventListener("click", loadIssuers);
  $("#refresh-certs").addEventListener("click", loadCertificates);
  restore();
})();
