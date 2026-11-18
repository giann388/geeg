// Backend hanya membaca contract dan tidak memegang private key.
const { ethers } = require("ethers");
const config = require("./config");

const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const contract = new ethers.Contract(config.contract.address, config.contract.abi, provider);

const ROLE_NAMES = ["VERIFIER", "ISSUER", "ADMIN"];

async function getRole(address) {
  const role = await contract.getRole(address);
  return ROLE_NAMES[Number(role)];
}

async function getCertificate(certHash) {
  const r = await contract.verify(certHash);
  return {
    exists: r.exists,
    issuer: r.issuer,
    recipient: r.recipient,
    issuedAt: Number(r.issuedAt),
    updatedAt: Number(r.updatedAt),
    revoked: r.revoked,
    revokedAt: Number(r.revokedAt),
    issuerActive: r.issuerActive,
  };
}

async function getIssuers() {
  const [accounts, active] = await contract.getIssuers();
  return accounts.map((address, i) => ({ address, active: active[i] }));
}

async function getCertificatesByIssuer(address) {
  return [...(await contract.getCertificatesByIssuer(address))];
}

async function isReachable() {
  try {
    await provider.getBlockNumber();
    const code = await provider.getCode(config.contract.address);
    return code !== "0x";
  } catch {
    return false;
  }
}

module.exports = { provider, contract, getRole, getCertificate, getIssuers, getCertificatesByIssuer, isReachable };
