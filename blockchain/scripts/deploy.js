// Deploy contract lalu tulis address + ABI untuk backend dan frontend.
// Admin = akun pertama, kecuali ADMIN_ADDRESS diisi.
const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const adminAddress = process.env.ADMIN_ADDRESS || deployer.address;

  console.log(`Network     : ${network.name} (chainId ${network.config.chainId || 31337})`);
  console.log(`Deployer    : ${deployer.address}`);
  console.log(`Admin       : ${adminAddress}`);

  const Registry = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy(adminAddress);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const deployTx = registry.deploymentTransaction();
  const receipt = await deployTx.wait();

  console.log(`Contract    : ${address}`);
  console.log(`Block       : ${receipt.blockNumber}`);

  const { abi } = await artifacts.readArtifact("CertificateRegistry");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const rpcUrl = network.config.url || "http://127.0.0.1:8545";

  const info = {
    network: network.name,
    chainId,
    rpcUrl,
    address,
    admin: adminAddress,
    deployBlock: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    abi,
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, `${network.name}.json`), JSON.stringify(info, null, 2));

  const backendFile = path.join(__dirname, "..", "..", "backend", "src", "contract-config.json");
  fs.mkdirSync(path.dirname(backendFile), { recursive: true });
  fs.writeFileSync(backendFile, JSON.stringify(info, null, 2));

  // frontend memuat config lewat <script>, jadi ditulis sebagai file JS
  const frontendFile = path.join(__dirname, "..", "..", "frontend", "js", "contract-config.js");
  fs.mkdirSync(path.dirname(frontendFile), { recursive: true });
  fs.writeFileSync(
    frontendFile,
    "// File ini DIBUAT OTOMATIS oleh blockchain/scripts/deploy.js. Jangan diedit manual.\n" +
      `window.CONTRACT_CONFIG = ${JSON.stringify({ chainId, rpcUrl, address, abi }, null, 2)};\n`
  );

  console.log("\nConfig ditulis ke:");
  console.log(` - ${path.relative(process.cwd(), backendFile)}`);
  console.log(` - ${path.relative(process.cwd(), frontendFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
