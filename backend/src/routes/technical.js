const express = require("express");
const { getTechnical, getTechnicalBatch } = require("../controllers/technicalController");

const router = express.Router();

router.get("/technical/batch", getTechnicalBatch);   // GET /api/technical/batch?symbols=...
router.get("/technical/:symbol", getTechnical);      // GET /api/technical/RELIANCE

module.exports = router;
