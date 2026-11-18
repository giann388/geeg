const { ethers } = require("ethers");

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const NAME_RE = /^[\p{L} .'-]{2,100}$/u;
const NIM_RE = /^[0-9A-Za-z]{5,20}$/;
const COURSE_RE = /^[\p{L}\p{N} .,'()&/:-]{2,150}$/u;
const GRADE_RE = /^([A-E][+-]?|\d{1,3}(\.\d{1,2})?)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_RE = /^[\p{L}\p{N} .,'()&/:-]{2,150}$/u;

function hash(value, field = "certHash") {
  if (typeof value !== "string" || !HASH_RE.test(value)) {
    throw new ValidationError(`${field} harus berupa hash 0x + 64 karakter hex`);
  }
  return value.toLowerCase();
}

function address(value, field = "address") {
  if (typeof value !== "string" || !ethers.isAddress(value)) {
    throw new ValidationError(`${field} bukan alamat wallet yang valid`);
  }
  return ethers.getAddress(value); // format checksum
}

function text(value, re, field, message) {
  if (typeof value !== "string") throw new ValidationError(`${field} wajib diisi`);
  const v = value.trim();
  if (!re.test(v)) throw new ValidationError(`${field} ${message}`);
  return v;
}

function date(value, field = "issueDate") {
  if (typeof value !== "string" || !DATE_RE.test(value)) throw new ValidationError(`${field} harus berformat YYYY-MM-DD`);
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new ValidationError(`${field} bukan tanggal yang valid`);
  const year = d.getUTCFullYear();
  if (year < 1950 || year > 2100) throw new ValidationError(`${field} di luar rentang yang masuk akal`);
  return value;
}

function certificateDetails(body) {
  if (!body || typeof body !== "object") throw new ValidationError("Body request tidak valid");
  return {
    studentName: text(body.studentName, NAME_RE, "studentName", "harus 2-100 huruf (boleh spasi, titik, petik, strip)"),
    studentNim: text(body.studentNim, NIM_RE, "studentNim", "harus 5-20 karakter huruf/angka").toUpperCase(),
    courseName: text(body.courseName, COURSE_RE, "courseName", "harus 2-150 karakter yang wajar"),
    grade: text(body.grade, GRADE_RE, "grade", "harus nilai huruf (A, B+, C-, ...) atau angka (contoh 85.5)"),
    issueDate: date(body.issueDate),
  };
}

function issuerProfile(body) {
  if (!body || typeof body !== "object") throw new ValidationError("Body request tidak valid");
  return {
    displayName: text(body.displayName, NAME_RE, "displayName", "harus 2-100 huruf"),
    institution: text(body.institution, TEXT_RE, "institution", "harus 2-150 karakter yang wajar"),
  };
}

module.exports = { ValidationError, hash, address, certificateDetails, issuerProfile };
