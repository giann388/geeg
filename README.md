# Certificate Registry

dApp untuk menerbitkan dan memverifikasi sertifikat digital di blockchain.

- **Admin**: mengelola issuer
- **Issuer**: menerbitkan dan mencabut sertifikat
- **Verifier**: mengecek keaslian sertifikat, tanpa login

## Teknologi

Solidity, Hardhat, Node.js + Express, MySQL, ethers.js, MetaMask

## Persiapan

- Node.js minimal versi 20 (disarankan 22)
- MySQL 8
- Browser dengan ekstensi MetaMask

## Menjalankan pertama kali

**Terminal 1**
```bash
cd blockchain
npm install
npm run node
```
Biarkan terminal ini tetap terbuka.

**Terminal 2**
```bash
cd blockchain
npm run deploy:local
npm run seed:local
cd ../backend
npm install
copy .env.example .env
```

Buka `backend/.env`, lalu isi:
- `DB_PASSWORD` dengan password MySQL (kosongkan jika tidak ada)
- `JWT_SECRET` dan `RECIPIENT_SECRET` dengan dua nilai acak yang berbeda, dibuat dengan:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Lanjutkan di Terminal 2:
```bash
npm run db:setup
npm run db:seed
npm start
```

Buka http://localhost:3000

## MetaMask

1. Tambahkan jaringan: RPC `http://127.0.0.1:8545`, chain ID `31337`, simbol `ETH`.
2. Import akun dari private key yang tampil di Terminal 1:
   - Account #0: Admin
   - Account #1 dan #2: Issuer

## Menjalankan ulang

**Terminal 1**
```bash
cd blockchain
npm run node
```

**Terminal 2**
```bash
cd blockchain
npm run deploy:local
npm run seed:local
cd ../backend
npm run db:reset
npm start
```

Lalu di MetaMask: Settings > Advanced > Clear activity tab data.
