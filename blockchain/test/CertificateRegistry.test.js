const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// bytes32 dari teks, pengganti hash PDF
const h = (text) => ethers.sha256(ethers.toUtf8Bytes(text));
const ZERO32 = ethers.ZeroHash;

const ROLE = { VERIFIER: 0n, ISSUER: 1n, ADMIN: 2n };

describe("CertificateRegistry", function () {
  async function deployFixture() {
    const [admin, issuerA, issuerB, outsider, newAdmin] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("CertificateRegistry");
    const registry = await Registry.deploy(admin.address);
    await registry.waitForDeployment();
    return { registry, admin, issuerA, issuerB, outsider, newAdmin };
  }

  async function withIssuersFixture() {
    const f = await deployFixture();
    await f.registry.connect(f.admin).addIssuer(f.issuerA.address);
    await f.registry.connect(f.admin).addIssuer(f.issuerB.address);
    return f;
  }

  async function withCertificateFixture() {
    const f = await withIssuersFixture();
    const certHash = h("sertifikat-budi.pdf");
    const recipient = h("recipient-code-budi");
    await f.registry.connect(f.issuerA).issue(certHash, recipient);
    return { ...f, certHash, recipient };
  }

  describe("Deployment & role", function () {
    it("deployer menjadi Admin", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(admin.address);
      expect(await registry.getRole(admin.address)).to.equal(ROLE.ADMIN);
    });

    it("wallet lain default-nya Verifier", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      expect(await registry.getRole(outsider.address)).to.equal(ROLE.VERIFIER);
    });
  });

  describe("Manajemen issuer (Admin)", function () {
    it("Admin bisa menambah issuer", async function () {
      const { registry, admin, issuerA } = await loadFixture(deployFixture);
      await expect(registry.connect(admin).addIssuer(issuerA.address))
        .to.emit(registry, "IssuerAdded")
        .withArgs(issuerA.address, admin.address);
      expect(await registry.getRole(issuerA.address)).to.equal(ROLE.ISSUER);
      expect(await registry.isActiveIssuer(issuerA.address)).to.equal(true);
    });

    it("Admin bisa menonaktifkan issuer, dan issuer bisa diaktifkan lagi tanpa duplikat di daftar", async function () {
      const { registry, admin, issuerA } = await loadFixture(withIssuersFixture);
      await expect(registry.connect(admin).removeIssuer(issuerA.address))
        .to.emit(registry, "IssuerRemoved")
        .withArgs(issuerA.address, admin.address);
      expect(await registry.getRole(issuerA.address)).to.equal(ROLE.VERIFIER);

      await registry.connect(admin).addIssuer(issuerA.address);
      const [accounts, active] = await registry.getIssuers();
      expect(accounts.length).to.equal(2);
      expect(active[0]).to.equal(true);
    });

    it("getIssuers mengembalikan daftar dan status aktif", async function () {
      const { registry, admin, issuerA, issuerB } = await loadFixture(withIssuersFixture);
      await registry.connect(admin).removeIssuer(issuerB.address);
      const [accounts, active] = await registry.getIssuers();
      expect(accounts).to.deep.equal([issuerA.address, issuerB.address]);
      expect(active).to.deep.equal([true, false]);
    });

    it("validasi input: alamat nol, admin sebagai issuer, issuer ganda, hapus issuer yang tidak aktif", async function () {
      const { registry, admin, issuerA, outsider } = await loadFixture(withIssuersFixture);
      await expect(registry.connect(admin).addIssuer(ethers.ZeroAddress)).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await expect(registry.connect(admin).addIssuer(admin.address)).to.be.revertedWithCustomError(registry, "AdminCannotBeIssuer");
      await expect(registry.connect(admin).addIssuer(issuerA.address)).to.be.revertedWithCustomError(registry, "IssuerAlreadyActive");
      await expect(registry.connect(admin).removeIssuer(outsider.address)).to.be.revertedWithCustomError(registry, "IssuerNotActive");
    });
  });

  describe("CRUD sertifikat on-chain", function () {
    it("CREATE: issuer menerbitkan sertifikat", async function () {
      const { registry, issuerA } = await loadFixture(withIssuersFixture);
      const certHash = h("cert-1");
      const recipient = h("rcp-1");
      await expect(registry.connect(issuerA).issue(certHash, recipient)).to.emit(registry, "CertificateIssued");
      expect(await registry.totalCertificates()).to.equal(1n);
      expect(await registry.getCertificatesByIssuer(issuerA.address)).to.deep.equal([certHash]);
    });

    it("READ: verify mengembalikan data sertifikat yang valid", async function () {
      const { registry, issuerA, certHash, recipient } = await loadFixture(withCertificateFixture);
      const r = await registry.verify(certHash);
      expect(r.exists).to.equal(true);
      expect(r.issuer).to.equal(issuerA.address);
      expect(r.recipient).to.equal(recipient);
      expect(r.issuedAt).to.be.greaterThan(0n);
      expect(r.revoked).to.equal(false);
      expect(r.issuerActive).to.equal(true);
    });

    it("READ: verify hash yang tidak terdaftar -> exists = false", async function () {
      const { registry } = await loadFixture(withCertificateFixture);
      const r = await registry.verify(h("tidak-ada"));
      expect(r.exists).to.equal(false);
      expect(r.issuer).to.equal(ethers.ZeroAddress);
    });

    it("UPDATE: issuer pembuat mengubah recipient", async function () {
      const { registry, issuerA, certHash, recipient } = await loadFixture(withCertificateFixture);
      const newRecipient = h("rcp-baru");
      await expect(registry.connect(issuerA).updateMetadata(certHash, newRecipient))
        .to.emit(registry, "MetadataUpdated")
        .withArgs(certHash, issuerA.address, recipient, newRecipient);
      expect((await registry.verify(certHash)).recipient).to.equal(newRecipient);
    });

    it("DELETE (soft): issuer pembuat mencabut sertifikat, riwayat penerbitan tetap ada", async function () {
      const { registry, issuerA, certHash } = await loadFixture(withCertificateFixture);
      await expect(registry.connect(issuerA).revoke(certHash)).to.emit(registry, "CertificateRevoked");
      const r = await registry.verify(certHash);
      expect(r.exists).to.equal(true);
      expect(r.revoked).to.equal(true);
      expect(r.revokedAt).to.be.greaterThan(0n);
      expect(r.issuer).to.equal(issuerA.address);
    });

    it("Admin boleh mencabut sertifikat (darurat)", async function () {
      const { registry, admin, certHash } = await loadFixture(withCertificateFixture);
      await expect(registry.connect(admin).revoke(certHash))
        .to.emit(registry, "CertificateRevoked")
        .withArgs(certHash, admin.address, (v) => v > 0n);
    });

    it("sertifikat issuer yang dinonaktifkan tetap ada, issuerActive = false", async function () {
      const { registry, admin, issuerA, certHash } = await loadFixture(withCertificateFixture);
      await registry.connect(admin).removeIssuer(issuerA.address);
      const r = await registry.verify(certHash);
      expect(r.exists).to.equal(true);
      expect(r.revoked).to.equal(false);
      expect(r.issuerActive).to.equal(false);
    });
  });

  describe("Keamanan", function () {
    it("wallet tanpa izin tidak bisa menerbitkan sertifikat", async function () {
      const { registry, outsider } = await loadFixture(withIssuersFixture);
      await expect(registry.connect(outsider).issue(h("palsu"), h("x")))
        .to.be.revertedWithCustomError(registry, "NotActiveIssuer")
        .withArgs(outsider.address);
    });

    it("Admin tidak bisa menerbitkan sertifikat (pemisahan role)", async function () {
      const { registry, admin } = await loadFixture(withIssuersFixture);
      await expect(registry.connect(admin).issue(h("a"), h("b"))).to.be.revertedWithCustomError(registry, "NotActiveIssuer");
    });

    it("hash yang sama tidak bisa diterbitkan dua kali (oleh issuer mana pun)", async function () {
      const { registry, issuerA, issuerB, certHash } = await loadFixture(withCertificateFixture);
      await expect(registry.connect(issuerA).issue(certHash, h("lain"))).to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
      await expect(registry.connect(issuerB).issue(certHash, h("lain"))).to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
    });

    it("issuer tidak bisa mencabut sertifikat milik issuer lain", async function () {
      const { registry, issuerB, certHash } = await loadFixture(withCertificateFixture);
      await expect(registry.connect(issuerB).revoke(certHash))
        .to.be.revertedWithCustomError(registry, "NotCertificateIssuer")
        .withArgs(issuerB.address, certHash);
    });

    it("wallet bukan Admin tidak bisa mengelola issuer", async function () {
      const { registry, issuerA, outsider } = await loadFixture(withIssuersFixture);
      await expect(registry.connect(outsider).addIssuer(outsider.address)).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      await expect(registry.connect(issuerA).addIssuer(outsider.address)).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      await expect(registry.connect(issuerA).removeIssuer(issuerA.address)).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("pengguna tanpa izin tidak bisa mengubah metadata", async function () {
      const { registry, admin, issuerB, outsider, certHash } = await loadFixture(withCertificateFixture);
      await expect(registry.connect(outsider).updateMetadata(certHash, h("x"))).to.be.revertedWithCustomError(registry, "NotActiveIssuer");
      await expect(registry.connect(issuerB).updateMetadata(certHash, h("x"))).to.be.revertedWithCustomError(registry, "NotCertificateIssuer");
      await expect(registry.connect(admin).updateMetadata(certHash, h("x"))).to.be.revertedWithCustomError(registry, "NotActiveIssuer");
    });

    it("sertifikat yang sudah dicabut terbaca revoked, tidak bisa dicabut ulang / diubah", async function () {
      const { registry, issuerA, certHash } = await loadFixture(withCertificateFixture);
      await registry.connect(issuerA).revoke(certHash);
      expect((await registry.verify(certHash)).revoked).to.equal(true);
      await expect(registry.connect(issuerA).revoke(certHash)).to.be.revertedWithCustomError(registry, "CertificateAlreadyRevoked");
      await expect(registry.connect(issuerA).updateMetadata(certHash, h("x"))).to.be.revertedWithCustomError(registry, "CertificateAlreadyRevoked");
      // hash yang sudah dicabut juga tidak bisa "dihidupkan lagi" dengan issue ulang
      await expect(registry.connect(issuerA).issue(certHash, h("x"))).to.be.revertedWithCustomError(registry, "CertificateAlreadyExists");
    });

    it("wallet tanpa izin tidak bisa mencabut sertifikat", async function () {
      const { registry, outsider, certHash } = await loadFixture(withCertificateFixture);
      await expect(registry.connect(outsider).revoke(certHash)).to.be.revertedWithCustomError(registry, "NotActiveIssuer");
    });

    it("issuer yang sudah dinonaktifkan kehilangan semua hak tulis", async function () {
      const { registry, admin, issuerA, certHash } = await loadFixture(withCertificateFixture);
      await registry.connect(admin).removeIssuer(issuerA.address);
      await expect(registry.connect(issuerA).issue(h("baru"), h("x"))).to.be.revertedWithCustomError(registry, "NotActiveIssuer");
      await expect(registry.connect(issuerA).updateMetadata(certHash, h("x"))).to.be.revertedWithCustomError(registry, "NotActiveIssuer");
      await expect(registry.connect(issuerA).revoke(certHash)).to.be.revertedWithCustomError(registry, "NotActiveIssuer");
    });

    it("validasi input: hash nol, recipient nol, recipient sama, sertifikat tidak ada", async function () {
      const { registry, issuerA, certHash, recipient } = await loadFixture(withCertificateFixture);
      await expect(registry.connect(issuerA).issue(ZERO32, h("x"))).to.be.revertedWithCustomError(registry, "ZeroHash");
      await expect(registry.connect(issuerA).issue(h("y"), ZERO32)).to.be.revertedWithCustomError(registry, "ZeroRecipient");
      await expect(registry.connect(issuerA).updateMetadata(certHash, ZERO32)).to.be.revertedWithCustomError(registry, "ZeroRecipient");
      await expect(registry.connect(issuerA).updateMetadata(certHash, recipient)).to.be.revertedWithCustomError(registry, "SameRecipient");
      await expect(registry.connect(issuerA).revoke(h("tidak-ada"))).to.be.revertedWithCustomError(registry, "CertificateNotFound");
      await expect(registry.connect(issuerA).updateMetadata(h("tidak-ada"), h("x"))).to.be.revertedWithCustomError(registry, "CertificateNotFound");
    });

    it("Admin tidak bisa renounceOwnership (contract tidak boleh kehilangan Admin)", async function () {
      const { registry, admin } = await loadFixture(deployFixture);
      await expect(registry.connect(admin).renounceOwnership()).to.be.revertedWithCustomError(registry, "RenounceDisabled");
      expect(await registry.owner()).to.equal(admin.address);
    });

    it("pindah Admin harus 2 langkah dan tidak boleh ke issuer aktif", async function () {
      const { registry, admin, issuerA, newAdmin, outsider } = await loadFixture(withIssuersFixture);
      await expect(registry.connect(admin).transferOwnership(issuerA.address)).to.be.revertedWithCustomError(registry, "AdminCannotBeIssuer");

      await registry.connect(admin).transferOwnership(newAdmin.address);
      expect(await registry.owner()).to.equal(admin.address); // belum pindah
      await expect(registry.connect(outsider).acceptOwnership()).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");

      // calon Admin dijadikan issuer sebelum menerima -> ditolak saat accept
      await registry.connect(admin).addIssuer(newAdmin.address);
      await expect(registry.connect(newAdmin).acceptOwnership()).to.be.revertedWithCustomError(registry, "AdminCannotBeIssuer");

      await registry.connect(admin).removeIssuer(newAdmin.address);
      await registry.connect(newAdmin).acceptOwnership();
      expect(await registry.owner()).to.equal(newAdmin.address);
      expect(await registry.getRole(admin.address)).to.equal(ROLE.VERIFIER);
    });
  });
});
