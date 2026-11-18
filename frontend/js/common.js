// Fungsi bersama semua halaman. Role di frontend hanya untuk tampilan;
// pengecekan sebenarnya ada di contract dan backend.
(function () {
  const { ethers } = window;
  const CFG = window.CONTRACT_CONFIG;
  const ROLE_NAMES = ["VERIFIER", "ISSUER", "ADMIN"];
  const CHAIN_HEX = "0x" + Number(CFG.chainId).toString(16);

  const readProvider = new ethers.JsonRpcProvider(CFG.rpcUrl, CFG.chainId, { staticNetwork: true });
  const readContract = new ethers.Contract(CFG.address, CFG.abi, readProvider);
  const iface = new ethers.Interface(CFG.abi);

  const state = { browserProvider: null, signer: null, address: null, role: null, token: null };
  const listeners = [];

  function $(sel) {
    return document.querySelector(sel);
  }
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "onclick") node.addEventListener("click", v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }
  function toast(message, type = "") {
    let box = $("#toast-container");
    if (!box) {
      box = el("div", { id: "toast-container" });
      document.body.append(box);
    }
    const t = el("div", { class: `toast ${type}`, text: message });
    box.append(t);
    setTimeout(() => t.remove(), type === "bad" ? 8000 : 5000);
  }
  function shortHex(v, n = 6) {
    return v ? `${v.slice(0, n + 2)}…${v.slice(-4)}` : "-";
  }
  function formatTs(sec) {
    if (!sec) return "-";
    return new Date(Number(sec) * 1000).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  }
  function badge(text, type = "") {
    return el("span", { class: `badge ${type}`, text });
  }
  async function withBusy(button, label, fn) {
    const original = button ? button.textContent : "";
    if (button) {
      button.disabled = true;
      button.textContent = "";
      button.append(el("span", { class: "spinner" }), label);
    }
    try {
      return await fn();
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function confirmDialog(title, message, okLabel = "Ya, lanjutkan", danger = true) {
    return new Promise((resolve) => {
      const dlg = el(
        "dialog",
        {},
        el("h2", { text: title }),
        el("p", { text: message }),
        el(
          "div",
          { class: "actions" },
          el("button", { class: danger ? "danger" : "", onclick: () => close(true), text: okLabel }),
          el("button", { class: "secondary", onclick: () => close(false), text: "Batal" })
        )
      );
      function close(v) {
        dlg.close();
        dlg.remove();
        resolve(v);
      }
      dlg.addEventListener("cancel", () => close(false));
      document.body.append(dlg);
      dlg.showModal();
    });
  }

  const ERROR_TEXT = {
    ZeroAddress: "Alamat wallet tidak boleh kosong (0x000…).",
    ZeroHash: "Hash sertifikat tidak valid.",
    ZeroRecipient: "Kode penerima tidak valid.",
    AdminCannotBeIssuer: "Wallet Admin tidak boleh merangkap Issuer.",
    IssuerAlreadyActive: "Wallet ini sudah menjadi issuer aktif.",
    IssuerNotActive: "Wallet ini bukan issuer aktif.",
    NotActiveIssuer: "Wallet Anda bukan issuer aktif.",
    CertificateAlreadyExists: "Sertifikat dengan file ini SUDAH terdaftar di blockchain (duplikat).",
    CertificateNotFound: "Sertifikat tidak ditemukan di blockchain.",
    NotCertificateIssuer: "Anda bukan issuer yang menerbitkan sertifikat ini.",
    CertificateAlreadyRevoked: "Sertifikat sudah dicabut.",
    SameRecipient: "Kode penerima sama dengan sebelumnya (tidak ada perubahan).",
    RenounceDisabled: "Fitur melepas Admin dinonaktifkan.",
    OwnableUnauthorizedAccount: "Hanya Admin yang boleh melakukan aksi ini.",
  };

  function findRevertData(err) {
    const candidates = [err?.data, err?.error?.data, err?.info?.error?.data, err?.info?.error?.data?.data, err?.error?.data?.data];
    return candidates.find((d) => typeof d === "string" && d.startsWith("0x") && d.length >= 10);
  }

  function explainError(err) {
    if (!err) return "Terjadi kesalahan.";
    if (err.code === "ACTION_REJECTED" || err?.info?.error?.code === 4001 || err.code === 4001) return "Dibatalkan di MetaMask.";
    let name = err.revert?.name;
    if (!name) {
      const data = findRevertData(err);
      if (data) {
        try {
          name = iface.parseError(data)?.name;
        } catch {}
      }
    }
    if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
    if (name) return `Ditolak smart contract: ${name}`;
    const msg = err.shortMessage || err.message || String(err);
    if (/nonce/i.test(msg)) return "Nonce MetaMask tidak cocok. Buka MetaMask > Settings > Advanced > Clear activity tab data, lalu coba lagi.";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "Tidak bisa terhubung ke server/blockchain. Pastikan Hardhat node dan backend berjalan.";
    return msg;
  }

  async function api(path, { method = "GET", body, auth = false } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      if (!state.token) throw new Error("Belum login ke backend.");
      headers.Authorization = `Bearer ${state.token}`;
    }
    const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) {
      if (res.status === 401 && auth) clearSession();
      const e = new Error((data && data.error) || `Request gagal (${res.status})`);
      e.status = res.status;
      e.body = data;
      throw e;
    }
    return data;
  }

  function tokenKey(address) {
    return `cr_token_${address.toLowerCase()}`;
  }
  function clearSession() {
    if (state.address) sessionStorage.removeItem(tokenKey(state.address));
    state.token = null;
  }

  async function ensureNetwork() {
    const current = await window.ethereum.request({ method: "eth_chainId" });
    if (current === CHAIN_HEX) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (err) {
      if (err.code === 4902 || err?.data?.originalError?.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_HEX,
              chainName: "Hardhat Local",
              rpcUrls: [CFG.rpcUrl],
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            },
          ],
        });
      } else {
        throw new Error("Pindahkan MetaMask ke jaringan Hardhat Local (chainId 31337).");
      }
    }
  }

  async function getRoleOf(address) {
    return ROLE_NAMES[Number(await readContract.getRole(address))];
  }

  // diset saat Putuskan; selama ada, halaman tidak tersambung otomatis
  const DISCONNECTED_KEY = "cr_disconnected";

  // Dipanggil saat halaman dibuka. eth_accounts tidak memunculkan popup MetaMask,
  // jadi pindah halaman tidak perlu klik Hubungkan lagi.
  async function restoreSession() {
    if (!window.ethereum || sessionStorage.getItem(DISCONNECTED_KEY)) return null;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (!accounts || !accounts.length) return null;
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (String(chainId).toLowerCase() !== CHAIN_HEX) return null;

      state.browserProvider = new ethers.BrowserProvider(window.ethereum);
      state.address = ethers.getAddress(accounts[0]);
      state.signer = await state.browserProvider.getSigner(state.address);
      state.role = await getRoleOf(state.address);
      state.token = sessionStorage.getItem(tokenKey(state.address));
      if (state.token) {
        try {
          await api("/api/auth/me", { auth: true });
        } catch {
          clearSession(); // token kedaluwarsa atau role berubah
        }
      }
      notify();
      return { address: state.address, role: state.role, loggedIn: !!state.token };
    } catch {
      state.browserProvider = state.signer = state.address = state.role = state.token = null;
      return null;
    }
  }

  async function connectWallet() {
    if (!window.ethereum) throw new Error("MetaMask tidak terdeteksi. Install ekstensi MetaMask terlebih dahulu.");
    sessionStorage.removeItem(DISCONNECTED_KEY);
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureNetwork();
    state.browserProvider = new ethers.BrowserProvider(window.ethereum);
    state.signer = await state.browserProvider.getSigner();
    state.address = ethers.getAddress(await state.signer.getAddress());
    state.role = await getRoleOf(state.address);
    state.token = sessionStorage.getItem(tokenKey(state.address));
    notify();
    return { address: state.address, role: state.role };
  }

  async function signIn() {
    if (!state.signer) throw new Error("Hubungkan wallet terlebih dahulu.");
    if (state.token) {
      try {
        await api("/api/auth/me", { auth: true });
        return; // token masih berlaku
      } catch {}
    }
    const { message } = await api("/api/auth/nonce", { method: "POST", body: { address: state.address } });
    const signature = await state.signer.signMessage(message);
    const res = await api("/api/auth/login", { method: "POST", body: { address: state.address, signature } });
    state.token = res.token;
    state.role = res.role;
    sessionStorage.setItem(tokenKey(state.address), res.token);
    notify();
  }

  async function disconnect() {
    clearSession();
    sessionStorage.setItem(DISCONNECTED_KEY, "1");
    try {
      await window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {}
    state.browserProvider = state.signer = state.address = state.role = null;
    notify();
  }

  function writeContract() {
    if (!state.signer) throw new Error("Hubungkan wallet terlebih dahulu.");
    return new ethers.Contract(CFG.address, CFG.abi, state.signer);
  }

  async function sendTx(fnName, args, pendingMsg) {
    const c = writeContract();
    const tx = await c[fnName](...args);
    toast(pendingMsg || "Transaksi dikirim, menunggu konfirmasi…");
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("Transaksi gagal di blockchain.");
    return { tx, receipt };
  }

  function onChange(fn) {
    listeners.push(fn);
  }
  function notify() {
    for (const fn of listeners) fn({ ...state });
  }

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => {
      clearSession();
      toast("Akun MetaMask berubah. Silakan hubungkan ulang.");
      setTimeout(() => location.reload(), 800);
    });
    window.ethereum.on?.("chainChanged", () => location.reload());
  }

  async function renderWalletInfo(container) {
    container.textContent = "";
    if (!state.address) return;
    let balance = "-";
    try {
      balance = Number(ethers.formatEther(await readProvider.getBalance(state.address))).toFixed(4) + " ETH";
    } catch {}
    const roleType = state.role === "ADMIN" ? "ok" : state.role === "ISSUER" ? "ok" : "warn";
    container.append(
      el(
        "dl",
        {},
        el("dt", { text: "Wallet" }),
        el("dd", { class: "mono", text: state.address }),
        el("dt", { text: "Role" }),
        el("dd", {}, badge(state.role, roleType)),
        el("dt", { text: "Jaringan" }),
        el("dd", { text: `Hardhat Local (chainId ${CFG.chainId})` }),
        el("dt", { text: "Saldo" }),
        el("dd", { text: balance }),
        el("dt", { text: "Login backend" }),
        el("dd", {}, state.token ? badge("Sudah login", "ok") : badge("Belum", "warn"))
      )
    );
  }

  window.App = {
    CFG,
    ethers,
    readContract,
    readProvider,
    state,
    $,
    el,
    toast,
    badge,
    shortHex,
    formatTs,
    withBusy,
    confirmDialog,
    explainError,
    api,
    connectWallet,
    restoreSession,
    signIn,
    disconnect,
    sendTx,
    getRoleOf,
    onChange,
    renderWalletInfo,
  };
})();
