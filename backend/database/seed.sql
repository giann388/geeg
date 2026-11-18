-- Profil demo untuk akun Hardhat #1 dan #2 (dijadikan issuer oleh npm run seed:local).

USE certificate_registry;

INSERT INTO issuer_profiles (wallet_address, display_name, institution, created_by)
VALUES
  ('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'Dr. Andi Wijaya', 'Fakultas Ilmu Komputer', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
  ('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'Dr. Sari Lestari', 'Fakultas Teknik', '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), institution = VALUES(institution);
