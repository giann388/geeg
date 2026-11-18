// Demo: jadikan akun Hardhat #1 dan #2 sebagai issuer.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`Belum ada deployment untuk ${network.name}. Jalankan deploy dulu.`);
  const { address } = JSON.parse(fs.readFileSync(file, "utf8"));

  const [admin, issuer1, issuer2] = await ethers.getSigners();
  const registry = await ethers.getContractAt("CertificateRegistry", address, admin);

  for (const acc of [issuer1, issuer2]) {
    if (await registry.isActiveIssuer(acc.address)) {
      console.log(`Sudah issuer : ${acc.address}`);
      continue;
    }
    const tx = await registry.addIssuer(acc.address);
    await tx.wait();
    console.log(`Issuer baru  : ${acc.address}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
