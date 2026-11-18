-- Data off-chain Certificate Registry (MySQL 8). Dijalankan oleh: npm run db:setup

CREATE DATABASE IF NOT EXISTS certificate_registry
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE certificate_registry;

-- Profil issuer, dikelola admin. Nama dan institusi ditampilkan ke verifier.
CREATE TABLE IF NOT EXISTS issuer_profiles (
  wallet_address  CHAR(42)      NOT NULL,
  display_name    VARCHAR(100)  NOT NULL,
  institution     VARCHAR(150)  NOT NULL,
  created_by      CHAR(42)      NOT NULL,          -- wallet admin
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (wallet_address)
) ENGINE=InnoDB;

-- Data mahasiswa per sertifikat. Hanya bisa dibaca issuer pemilik dan admin.
CREATE TABLE IF NOT EXISTS certificates (
  cert_hash       CHAR(66)      NOT NULL,          -- SHA-256 file PDF
  issuer_address  CHAR(42)      NOT NULL,
  student_name    VARCHAR(100)  NOT NULL,
  student_nim     VARCHAR(20)   NOT NULL,
  course_name     VARCHAR(150)  NOT NULL,
  grade           VARCHAR(6)    NOT NULL,
  issue_date      DATE          NOT NULL,
  recipient_code  CHAR(66)      NOT NULL,          -- HMAC(NIM), disimpan juga di blockchain
  status          ENUM('PENDING','ISSUED','REVOKED') NOT NULL DEFAULT 'PENDING',
  tx_hash         CHAR(66)      NULL,
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cert_hash),
  INDEX idx_cert_issuer (issuer_address),
  INDEX idx_cert_nim (student_nim)
) ENGINE=InnoDB;

-- Opsional: user database khusus aplikasi dengan hak terbatas (jalankan manual sebagai root).
--   CREATE USER 'cr_app'@'localhost' IDENTIFIED BY 'ganti_password_kuat';
--   GRANT SELECT, INSERT, UPDATE, DELETE ON certificate_registry.* TO 'cr_app'@'localhost';
--   FLUSH PRIVILEGES;
