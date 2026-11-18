// Butuh Hardhat node (deploy:local + seed:local) dan MySQL, lihat README bagian 6.
// Private key di bawah adalah akun bawaan Hardhat yang publik, hanya untuk jaringan lokal.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const request = require("supertest");
const { ethers } = require("ethers");

const app = require("../src/app");
const config = require("../src/config");
const pool = require("../src/db");
const { recipientCodeFor } = require("../src/recipient");

const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const KEYS = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // Account #0
  issuerA: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // Account #1
  issuerB: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // Account #2
  outsider: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // Account #3
  tempIssuer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // Account #4
};
const W = Object.fromEntries(Object.entries(KEYS).map(([k, pk]) => [k, new ethers.NonceManager(new ethers.Wallet(pk, provider))]));
const addr = {};
const contractAs = (who) => new ethers.Contract(config.contract.address, config.contract.abi, W[who]);

const randomHash = () => "0x" + crypto.randomBytes(32).toString("hex");
const details = (over = {}) => ({
  studentName: "Budi Santoso",
  studentNim: "2501234567",
  courseName: "Blockchain Fundamental",
  grade: "A",
  issueDate: "2026-11-16",
  ...over,
});

async function login(who) {
  const address = addr[who];
  const n = await request(app).post("/api/auth/nonce").send({ address }).expect(200);
  const signature = await W[who].signer.signMessage(n.body.message);
  const res = await request(app).post("/api/auth/login").send({ address, signature });
  return res;
}
const tokens = {};
const bearer = (who) => ({ Authorization: `Bearer ${tokens[who]}` });

before(async () => {
  for (const [k, w] of Object.entries(W)) addr[k] = await w.getAddress();
  for (const who of ["admin", "issuerA", "issuerB"]) {
    const res = await login(who);
    assert.equal(res.status, 200, `login ${who} gagal: ${JSON.stringify(res.body)} (sudah jalankan seed:local?)`);
    tokens[who] = res.body.token;
  }
});

after(async () => {
  await pool.end();
  provider.destroy();
});

// Autentikasi wallet
test("login Admin & Issuer berhasil, role berasal dari smart contract", async () => {
  const me = await request(app).get("/api/auth/me").set(bearer("admin")).expect(200);
  assert.equal(me.body.role, "ADMIN");
  const me2 = await request(app).get("/api/auth/me").set(bearer("issuerA")).expect(200);
  assert.equal(me2.body.role, "ISSUER");
});

test("tanda tangan dari wallet lain ditolak (401)", async () => {
  const n = await request(app).post("/api/auth/nonce").send({ address: addr.admin }).expect(200);
  const forged = await W.outsider.signer.signMessage(n.body.message); // outsider mengaku sebagai admin
  const res = await request(app).post("/api/auth/login").send({ address: addr.admin, signature: forged });
  assert.equal(res.status, 401);
});

test("nonce tidak bisa dipakai ulang (replay attack)", async () => {
  const n = await request(app).post("/api/auth/nonce").send({ address: addr.issuerA }).expect(200);
  const signature = await W.issuerA.signer.signMessage(n.body.message);
  await request(app).post("/api/auth/login").send({ address: addr.issuerA, signature }).expect(200);
  const replay = await request(app).post("/api/auth/login").send({ address: addr.issuerA, signature });
  assert.equal(replay.status, 401);
});

test("wallet tanpa role (Verifier) tidak mendapat token (403)", async () => {
  const res = await login("outsider");
  assert.equal(res.status, 403);
  assert.equal(res.body.token, undefined);
});

test("tanpa token / token palsu / token dengan role palsu ditolak", async () => {
  await request(app).get("/api/certificates").expect(401);
  await request(app).get("/api/certificates").set({ Authorization: "Bearer abc.def.ghi" }).expect(401);
  // Token ditandatangani dengan secret lain + klaim role ADMIN
  const jwt = require("jsonwebtoken");
  const fake = jwt.sign({ role: "ADMIN" }, "secret-penyerang-yang-tidak-diketahui-server-xx", { subject: addr.outsider });
  await request(app).get("/api/issuers").set({ Authorization: `Bearer ${fake}` }).expect(401);
  // Token "alg: none"
  const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") + "." +
    Buffer.from(JSON.stringify({ sub: addr.outsider, role: "ADMIN" })).toString("base64url") + ".";
  await request(app).get("/api/issuers").set({ Authorization: `Bearer ${none}` }).expect(401);
});

test("issuer yang dinonaktifkan langsung kehilangan akses walau token masih berlaku", async () => {
  const admin = contractAs("admin");
  if (!(await admin.isActiveIssuer(addr.tempIssuer))) await (await admin.addIssuer(addr.tempIssuer)).wait();
  const res = await login("tempIssuer");
  assert.equal(res.status, 200);
  const token = res.body.token;
  await request(app).get("/api/certificates").set({ Authorization: `Bearer ${token}` }).expect(200);
  await (await admin.removeIssuer(addr.tempIssuer)).wait();
  await request(app).get("/api/certificates").set({ Authorization: `Bearer ${token}` }).expect(403);
});

// CRUD off-chain + konsistensi dengan on-chain
test("alur lengkap: create draft -> issue on-chain -> sync -> update -> revoke -> delete", async () => {
  const certHash = randomHash();

  // CREATE (off-chain, status PENDING)
  const created = await request(app).post("/api/certificates").set(bearer("issuerA")).send({ certHash, ...details() }).expect(201);
  assert.equal(created.body.status, "PENDING");
  assert.equal(created.body.consistency, "NOT_ON_CHAIN");
  assert.equal(created.body.recipientCode, recipientCodeFor("2501234567"));

  // ON-CHAIN issue (seperti yang dilakukan frontend lewat MetaMask)
  const tx = await contractAs("issuerA").issue(certHash, created.body.recipientCode);
  await tx.wait();

  // SYNC
  const synced = await request(app).post(`/api/certificates/${certHash}/sync`).set(bearer("issuerA")).send({ txHash: tx.hash }).expect(200);
  assert.equal(synced.body.status, "ISSUED");
  assert.equal(synced.body.consistency, "OK");
  assert.equal(synced.body.offchain.txHash, tx.hash);

  // READ
  const list = await request(app).get("/api/certificates").set(bearer("issuerA")).expect(200);
  assert.ok(list.body.items.some((i) => i.certHash === certHash));

  // UPDATE tanpa ganti NIM -> tidak perlu update on-chain
  const up1 = await request(app).put(`/api/certificates/${certHash}`).set(bearer("issuerA")).send(details({ grade: "A-" })).expect(200);
  assert.equal(up1.body.needsChainUpdate, false);
  assert.equal(up1.body.offchain.grade, "A-");

  // UPDATE ganti NIM -> RECIPIENT_MISMATCH sampai updateMetadata() dipanggil
  const up2 = await request(app).put(`/api/certificates/${certHash}`).set(bearer("issuerA")).send(details({ studentNim: "2509999999" })).expect(200);
  assert.equal(up2.body.needsChainUpdate, true);
  assert.equal(up2.body.consistency, "RECIPIENT_MISMATCH");
  await (await contractAs("issuerA").updateMetadata(certHash, up2.body.recipientCode)).wait();
  const after = await request(app).post(`/api/certificates/${certHash}/sync`).set(bearer("issuerA")).send({}).expect(200);
  assert.equal(after.body.consistency, "OK");

  // DELETE ditolak selama sertifikat masih aktif
  await request(app).delete(`/api/certificates/${certHash}`).set(bearer("issuerA")).expect(409);

  // REVOKE on-chain -> status di DB ikut berubah lewat rekonsiliasi
  await (await contractAs("issuerA").revoke(certHash)).wait();
  const revoked = await request(app).get(`/api/certificates/${certHash}`).set(bearer("issuerA")).expect(200);
  assert.equal(revoked.body.status, "REVOKED");

  // UPDATE ditolak setelah dicabut
  await request(app).put(`/api/certificates/${certHash}`).set(bearer("issuerA")).send(details()).expect(409);

  // DELETE diizinkan setelah dicabut
  await request(app).delete(`/api/certificates/${certHash}`).set(bearer("issuerA")).expect(200);
  await request(app).get(`/api/certificates/${certHash}`).set(bearer("issuerA")).expect(200); // masih ada on-chain
  const [rows] = await pool.execute("SELECT 1 FROM certificates WHERE cert_hash = ?", [certHash]);
  assert.equal(rows.length, 0);
});

test("draft yang gagal diterbitkan bisa dihapus", async () => {
  const certHash = randomHash();
  await request(app).post("/api/certificates").set(bearer("issuerA")).send({ certHash, ...details() }).expect(201);
  await request(app).delete(`/api/certificates/${certHash}`).set(bearer("issuerA")).expect(200);
});

test("rekonsiliasi: transaksi berhasil tapi sync tidak pernah dipanggil -> status diperbaiki saat dibaca", async () => {
  const certHash = randomHash();
  const c = await request(app).post("/api/certificates").set(bearer("issuerA")).send({ certHash, ...details() }).expect(201);
  await (await contractAs("issuerA").issue(certHash, c.body.recipientCode)).wait();
  // tanpa memanggil /sync
  const list = await request(app).get("/api/certificates").set(bearer("issuerA")).expect(200);
  const item = list.body.items.find((i) => i.certHash === certHash);
  assert.equal(item.status, "ISSUED");
  const [rows] = await pool.execute("SELECT status FROM certificates WHERE cert_hash = ?", [certHash]);
  assert.equal(rows[0].status, "ISSUED");
});

test("sertifikat on-chain tanpa data off-chain tampil sebagai OFFCHAIN_MISSING dan bisa dilengkapi", async () => {
  const certHash = randomHash();
  await (await contractAs("issuerA").issue(certHash, ethers.id("kode-sementara"))).wait();
  const list = await request(app).get("/api/certificates").set(bearer("issuerA")).expect(200);
  assert.equal(list.body.items.find((i) => i.certHash === certHash).consistency, "OFFCHAIN_MISSING");
  const c = await request(app).post("/api/certificates").set(bearer("issuerA")).send({ certHash, ...details() }).expect(201);
  assert.equal(c.body.status, "ISSUED");
  assert.equal(c.body.consistency, "RECIPIENT_MISMATCH"); // perlu updateMetadata agar kode cocok
});

// Otorisasi data off-chain
test("issuer lain tidak bisa membaca / mengubah / menghapus data issuer A", async () => {
  const certHash = randomHash();
  await request(app).post("/api/certificates").set(bearer("issuerA")).send({ certHash, ...details() }).expect(201);
  await request(app).get(`/api/certificates/${certHash}`).set(bearer("issuerB")).expect(404);
  await request(app).put(`/api/certificates/${certHash}`).set(bearer("issuerB")).send(details({ grade: "E" })).expect(404);
  await request(app).delete(`/api/certificates/${certHash}`).set(bearer("issuerB")).expect(404);
  await request(app).post(`/api/certificates/${certHash}/sync`).set(bearer("issuerB")).send({}).expect(404);
  const listB = await request(app).get("/api/certificates").set(bearer("issuerB")).expect(200);
  assert.ok(!listB.body.items.some((i) => i.certHash === certHash));
});

test("issuer B tidak bisa 'mengklaim' hash yang sudah diterbitkan issuer A", async () => {
  const certHash = randomHash();
  await (await contractAs("issuerA").issue(certHash, ethers.id("x"))).wait();
  await request(app).post("/api/certificates").set(bearer("issuerB")).send({ certHash, ...details() }).expect(409);
});

test("Admin bisa membaca semua, tapi tidak bisa membuat/mengubah data sertifikat", async () => {
  const certHash = randomHash();
  await request(app).post("/api/certificates").set(bearer("issuerA")).send({ certHash, ...details() }).expect(201);
  await request(app).get(`/api/certificates/${certHash}`).set(bearer("admin")).expect(200);
  await request(app).post("/api/certificates").set(bearer("admin")).send({ certHash: randomHash(), ...details() }).expect(403);
  await request(app).put(`/api/certificates/${certHash}`).set(bearer("admin")).send(details()).expect(403);
});

test("Issuer tidak bisa mengakses endpoint Admin", async () => {
  await request(app).get("/api/issuers").set(bearer("issuerA")).expect(403);
  await request(app).put(`/api/issuers/${addr.issuerA}/profile`).set(bearer("issuerA")).send({ displayName: "Hacker", institution: "X Y" }).expect(403);
});

test("CRUD profil issuer oleh Admin", async () => {
  const target = addr.tempIssuer;
  const put = await request(app).put(`/api/issuers/${target}/profile`).set(bearer("admin")).send({ displayName: "Dosen Tamu", institution: "Fakultas Sains" }).expect(200);
  assert.equal(put.body.displayName, "Dosen Tamu");
  await request(app).put(`/api/issuers/${target}/profile`).set(bearer("admin")).send({ displayName: "Dosen Tamu Baru", institution: "Fakultas Sains" }).expect(200);
  const get = await request(app).get(`/api/issuers/${target}/profile`).set(bearer("admin")).expect(200);
  assert.equal(get.body.displayName, "Dosen Tamu Baru");
  const list = await request(app).get("/api/issuers").set(bearer("admin")).expect(200);
  assert.ok(list.body.items.some((i) => i.address === target));
  await request(app).delete(`/api/issuers/${target}/profile`).set(bearer("admin")).expect(200);
  await request(app).get(`/api/issuers/${target}/profile`).set(bearer("admin")).expect(404);
});

// Validasi input & paparan data
test("payload SQL injection & input tidak valid ditolak (400), tabel tetap utuh", async () => {
  const bad = [
    { certHash: "0x1234' OR '1'='1", ...details() },
    { certHash: randomHash(), ...details({ studentNim: "1' OR '1'='1" }) },
    { certHash: randomHash(), ...details({ studentName: "Budi'); DROP TABLE certificates;--" }) },
    { certHash: randomHash(), ...details({ studentName: "<script>alert(1)</script>" }) },
    { certHash: randomHash(), ...details({ grade: "A++++++" }) },
    { certHash: randomHash(), ...details({ issueDate: "2026-02-30" }) },
    { certHash: randomHash(), ...details({ studentName: 123 }) },
  ];
  for (const body of bad) {
    const res = await request(app).post("/api/certificates").set(bearer("issuerA")).send(body);
    assert.equal(res.status, 400, `seharusnya ditolak: ${JSON.stringify(body)}`);
  }
  await request(app).get("/api/certificates/1%20OR%201=1").set(bearer("issuerA")).expect(400);
  const [rows] = await pool.query("SHOW TABLES LIKE 'certificates'");
  assert.equal(rows.length, 1);
});

test("JSON rusak / body terlalu besar ditolak tanpa membocorkan detail error", async () => {
  const broken = await request(app).post("/api/auth/nonce").set("Content-Type", "application/json").send('{"address": ');
  assert.equal(broken.status, 400);
  assert.ok(!JSON.stringify(broken.body).includes("at "));
  const big = await request(app).post("/api/auth/nonce").send({ address: addr.admin, pad: "x".repeat(50000) });
  assert.equal(big.status, 413);
});

test("endpoint publik tidak membocorkan data mahasiswa", async () => {
  const res = await request(app).get(`/api/public/issuers/${addr.issuerA}`).expect(200);
  assert.deepEqual(Object.keys(res.body).sort(), ["address", "displayName", "institution"]);
  await request(app).get("/api/certificates").expect(401);
  await request(app).get(`/api/certificates/${randomHash()}`).expect(401);
});

test("header keamanan aktif (CSP, X-Content-Type-Options) dan X-Powered-By disembunyikan", async () => {
  const res = await request(app).get("/").expect(200);
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-powered-by"], undefined);
});
