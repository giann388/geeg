// Test UI dengan Chrome headless dan MetaMask tiruan yang memakai akun Hardhat.
// Test ini menambah issuer dan menerbitkan sertifikat, jadi jalankan pada state bersih.
// Atur CHROME_PATH jika Chrome tidak ada di lokasi default.
const puppeteer = require("puppeteer-core");
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");

const CHROME_DEFAULTS = {
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/usr/bin/google-chrome",
};
const CHROME_PATH = process.env.CHROME_PATH || CHROME_DEFAULTS[process.platform];
const CONTRACT_ADDRESS = require("../backend/src/contract-config.json").address;
const SHOTS = path.join(__dirname, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = "http://localhost:3000";
const SAMPLES = path.join(__dirname, "..", "docs", "sample-certificates");
const KEYS = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  issuer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  outsider: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
};
const NEW_ISSUER = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"; // Account #5
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", 31337, { staticNetwork: true });

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}

async function newPage(browser, who) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("  [console]", m.text()));
  if (who) {
    const wallet = new ethers.NonceManager(new ethers.Wallet(KEYS[who], provider));
    const address = await wallet.getAddress();
    await page.exposeFunction("__eth", async (method, params) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [address.toLowerCase()];
        case "eth_chainId":
          return "0x7a69";
        case "wallet_switchEthereumChain":
        case "wallet_revokePermissions":
          return null;
        case "personal_sign": {
          const msg = ethers.isHexString(params[0]) ? ethers.getBytes(params[0]) : params[0];
          return wallet.signer.signMessage(msg);
        }
        case "eth_sendTransaction": {
          const t = params[0];
          const tx = await wallet.sendTransaction({ to: t.to, data: t.data, value: t.value || 0, gasLimit: t.gas });
          return tx.hash;
        }
        default:
          return provider.send(method, params || []);
      }
    });
    await page.evaluateOnNewDocument(() => {
      window.ethereum = {
        isMetaMask: true,
        on() {},
        removeListener() {},
        async request({ method, params }) {
          try {
            return await window.__eth(method, params);
          } catch (e) {
            const err = new Error(e.message);
            const m = /data="(0x[0-9a-f]+)"/i.exec(e.message);
            if (m) err.data = m[1];
            throw err;
          }
        },
      };
    });
  }
  return page;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function text(page, sel) {
  return page.$eval(sel, (e) => e.innerText);
}
async function waitText(page, sel, re, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const t = await text(page, sel);
      if (re.test(t)) return t;
    } catch {}
    await sleep(250);
  }
  return await text(page, sel).catch(() => "");
}
async function clickButton(page, label, scope = "body") {
  const ok = await page.evaluate(
    (label, scope) => {
      const b = [...document.querySelectorAll(`${scope} button`)].find((x) => x.innerText.trim() === label && !x.disabled);
      if (b) b.click();
      return !!b;
    },
    label,
    scope
  );
  if (!ok) throw new Error(`Tombol "${label}" tidak ditemukan`);
}
async function toasts(page) {
  return page.$$eval(".toast", (ts) => ts.map((t) => t.innerText).join(" | ")).catch(() => "");
}

async function verifyFile(browser, file) {
  const page = await newPage(browser, null);
  await page.goto(`${BASE}/index.html`);
  const input = await page.$("#pdf-input");
  await input.uploadFile(path.join(SAMPLES, file));
  const t = await waitText(page, "#result .title", /VALID|DICABUT|TIDAK DITEMUKAN|tidak valid/i);
  const body = await text(page, "#result");
  await page.close();
  return { title: t, body };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-sandbox"] });
  try {
    // Verifier: sebelum diterbitkan
    let v = await verifyFile(browser, "sertifikat-budi-santoso.pdf");
    check("Verifier: PDF belum terbit -> TIDAK DITEMUKAN (tanpa wallet)", /TIDAK DITEMUKAN/.test(v.title));

    // Admin
    const admin = await newPage(browser, "admin");
    await admin.goto(`${BASE}/admin.html`);
    await clickButton(admin, "Hubungkan MetaMask & Login");
    await waitText(admin, "#wallet-info", /ADMIN/);
    await admin.waitForSelector("#admin-area:not(.hidden)", { timeout: 15000 });
    check("Admin: connect + login wallet, role ADMIN terdeteksi", /ADMIN/.test(await text(admin, "#wallet-info")) && /Sudah login/.test(await text(admin, "#wallet-info")));
    await waitText(admin, "#issuer-rows", /Andi Wijaya/);
    check("Admin: daftar issuer tampil (on-chain + profil off-chain)", /Dr\. Andi Wijaya/.test(await text(admin, "#issuer-rows")));

    await admin.type("#issuer-address", NEW_ISSUER);
    await admin.type("#issuer-name", "Dosen Tamu");
    await admin.type("#issuer-inst", "Fakultas Sains");
    await clickButton(admin, "Tambah Issuer");
    let rows = await waitText(admin, "#issuer-rows", /Dosen Tamu/);
    check("Admin: tambah issuer (addIssuer on-chain + profil off-chain)", /Dosen Tamu/.test(rows) && (await provider.call({ to: CONTRACT_ADDRESS, data: new ethers.Interface(["function isActiveIssuer(address) view returns (bool)"]).encodeFunctionData("isActiveIssuer", [NEW_ISSUER]) })).endsWith("1"));

    // nonaktifkan issuer baru
    await admin.evaluate((addr) => {
      const tr = [...document.querySelectorAll("#issuer-rows tr")].find((r) => r.innerText.includes(addr));
      [...tr.querySelectorAll("button")].find((b) => b.innerText === "Nonaktifkan").click();
    }, NEW_ISSUER);
    await admin.waitForSelector("dialog[open]");
    await clickButton(admin, "Nonaktifkan", "dialog[open]");
    await sleep(1500);
    rows = await waitText(admin, "#issuer-rows", /NONAKTIF/);
    check("Admin: nonaktifkan issuer (removeIssuer)", /NONAKTIF/.test(rows));
    await admin.screenshot({ path: path.join(SHOTS, "admin.png"), fullPage: true });

    // Issuer
    const iss = await newPage(browser, "issuer");
    await iss.goto(`${BASE}/issuer.html`);
    await clickButton(iss, "Hubungkan MetaMask & Login");
    await iss.waitForSelector("#issuer-area:not(.hidden)", { timeout: 15000 });
    check("Issuer: connect + login wallet, role ISSUER", /ISSUER/.test(await waitText(iss, "#wallet-info", /ISSUER/)));

    async function issue(file, name, nim, course, grade) {
      await (await iss.$("#pdf-input")).uploadFile(path.join(SAMPLES, file));
      await waitText(iss, "#pdf-info", /SHA-256/);
      for (const [sel, val] of [["#f-name", name], ["#f-nim", nim], ["#f-course", course], ["#f-grade", grade]]) {
        await iss.$eval(sel, (e) => (e.value = ""));
        await iss.type(sel, val);
      }
      await clickButton(iss, "Terbitkan Sertifikat");
      await sleep(3000);
    }
    await issue("sertifikat-budi-santoso.pdf", "Budi Santoso", "2501234567", "Blockchain Fundamental", "A");
    let list = await waitText(iss, "#cert-rows", /Budi Santoso[\s\S]*ISSUED/);
    check("Issuer: terbitkan sertifikat (PDF -> SHA-256 -> MySQL -> issue())", /Budi Santoso[\s\S]*ISSUED/.test(list), (await toasts(iss)).slice(0, 120));

    await issue("sertifikat-citra-dewi.pdf", "Citra Dewi", "2501234568", "Blockchain Fundamental", "A-");
    list = await waitText(iss, "#cert-rows", /Citra Dewi/);
    check("Issuer: terbitkan sertifikat kedua", /Citra Dewi/.test(list), (await toasts(iss)) + " // pdf-info: " + (await text(iss, "#pdf-info")));

    // duplikat
    await issue("sertifikat-budi-santoso.pdf", "Budi Santoso", "2501234567", "Blockchain Fundamental", "A");
    const tdup = await toasts(iss);
    check("Issuer: PDF yang sama ditolak (duplikat)", /duplikat|SUDAH terdaftar|sudah terdaftar/i.test(tdup + (await text(iss, "#pdf-info"))), tdup.slice(-120));

    // edit NIM -> updateMetadata on-chain
    await iss.evaluate(() => {
      const tr = [...document.querySelectorAll("#cert-rows tr")].find((r) => r.innerText.includes("Citra Dewi"));
      [...tr.querySelectorAll("button")].find((b) => b.innerText === "Edit").click();
    });
    await iss.waitForSelector("#edit-dialog[open]");
    await iss.$eval("#e-nim", (e) => (e.value = ""));
    await iss.type("#e-nim", "2509999999");
    await iss.$eval("#e-grade", (e) => (e.value = ""));
    await iss.type("#e-grade", "A");
    await clickButton(iss, "Simpan", "#edit-dialog");
    await sleep(4000);
    list = await text(iss, "#cert-rows");
    const citraRow = list.split("\n").join(" ");
    check("Issuer: edit data + NIM berubah -> updateMetadata() on-chain, konsisten", /2509999999/.test(citraRow) && !/belum diperbarui/.test(citraRow), (await toasts(iss)).slice(-160));
    await iss.screenshot({ path: path.join(SHOTS, "issuer.png"), fullPage: true });

    // Verifier: valid & palsu
    v = await verifyFile(browser, "sertifikat-budi-santoso.pdf");
    check("Verifier: PDF asli -> VALID + nama issuer dari profil", /VALID/.test(v.title) && /Andi Wijaya/.test(v.body));
    check("Verifier: data mahasiswa tidak tampil di halaman publik", !/2501234567|Budi/.test(v.body));
    v = await verifyFile(browser, "PALSU-sertifikat-budi-nilai-diubah.pdf");
    check("Verifier: PDF hasil edit -> TIDAK DITEMUKAN", /TIDAK DITEMUKAN/.test(v.title));

    // Revoke
    await iss.evaluate(() => {
      const tr = [...document.querySelectorAll("#cert-rows tr")].find((r) => r.innerText.includes("Budi Santoso"));
      [...tr.querySelectorAll("button")].find((b) => b.innerText === "Cabut").click();
    });
    await iss.waitForSelector("dialog[open]");
    await clickButton(iss, "Cabut sertifikat", "dialog[open]");
    list = await waitText(iss, "#cert-rows", /REVOKED/);
    check("Issuer: cabut sertifikat (revoke on-chain) -> REVOKED", /REVOKED/.test(list));
    v = await verifyFile(browser, "sertifikat-budi-santoso.pdf");
    check("Verifier: sertifikat dicabut -> DICABUT", /DICABUT/.test(v.title));

    // Delete off-chain setelah revoke
    await iss.evaluate(() => {
      const tr = [...document.querySelectorAll("#cert-rows tr")].find((r) => r.innerText.includes("Budi Santoso"));
      [...tr.querySelectorAll("button")].find((b) => b.innerText === "Hapus data").click();
    });
    await iss.waitForSelector("dialog[open]");
    await clickButton(iss, "Hapus", "dialog[open]");
    await sleep(2000);
    list = await text(iss, "#cert-rows");
    check("Issuer: hapus data off-chain setelah dicabut (data mahasiswa hilang, riwayat on-chain tetap)", !/Budi Santoso/.test(list) && /REVOKED/.test(list));

    // Admin melihat semua sertifikat
    await clickButton(admin, "Muat ulang", "section:last-of-type");
    const allCerts = await waitText(admin, "#cert-rows", /Citra Dewi/);
    check("Admin: memantau semua sertifikat", /Citra Dewi/.test(allCerts));

    // Outsider
    const out = await newPage(browser, "outsider");
    await out.goto(`${BASE}/issuer.html`);
    await clickButton(out, "Hubungkan MetaMask & Login");
    const msg = await waitText(out, "#not-issuer", /belum terdaftar/);
    const hidden = await out.$eval("#issuer-area", (e) => e.classList.contains("hidden"));
    check("Outsider: wallet tanpa role tidak bisa membuka dashboard Issuer", /belum terdaftar/.test(msg) && hidden);
    await out.goto(`${BASE}/admin.html`);
    await clickButton(out, "Hubungkan MetaMask & Login");
    check("Outsider: wallet tanpa role tidak bisa membuka dashboard Admin", /bukan ADMIN/.test(await waitText(out, "#not-admin", /bukan ADMIN/)));

    // screenshot verify page
    const vp = await newPage(browser, null);
    await vp.goto(`${BASE}/index.html`);
    await (await vp.$("#pdf-input")).uploadFile(path.join(SAMPLES, "sertifikat-citra-dewi.pdf"));
    await waitText(vp, "#result .title", /VALID/);
    await vp.screenshot({ path: path.join(SHOTS, "verify.png"), fullPage: true });
  } catch (err) {
    check("E2E berjalan tanpa error", false, err.message);
  } finally {
    await browser.close();
    provider.destroy();
    const fail = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - fail}/${results.length} PASS`);
    process.exit(fail ? 1 : 0);
  }
})();
