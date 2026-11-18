const express = require("express");
const v = require("../validators");
const auth = require("../auth");

const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.post(
  "/nonce",
  wrap(async (req, res) => {
    const address = v.address(req.body && req.body.address);
    res.json({ address, message: auth.buildLoginMessage(address) });
  })
);

router.post(
  "/login",
  wrap(async (req, res) => {
    const { address, signature } = req.body || {};
    res.json(await auth.login(address, signature));
  })
);

router.get("/me", auth.requireRole("ADMIN", "ISSUER"), (req, res) => {
  res.json(req.user);
});

module.exports = router;
