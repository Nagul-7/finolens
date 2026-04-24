const express = require("express");
const { getCall, listCalls, listSymbols } = require("../controllers/callsController");

const router = express.Router();

router.get("/symbols", listSymbols);           // GET /api/symbols
router.get("/calls", listCalls);               // GET /api/calls
router.get("/calls/:symbol", getCall);         // GET /api/calls/RELIANCE

module.exports = router;
