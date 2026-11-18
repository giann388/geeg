const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  multipleStatements: false,
  dateStrings: true, // tanggal dikembalikan sebagai string "YYYY-MM-DD"
});

module.exports = pool;
