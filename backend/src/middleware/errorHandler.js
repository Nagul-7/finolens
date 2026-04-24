function errorHandler(err, req, res, _next) {
  console.error("[error]", err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
}

function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

module.exports = { errorHandler, notFound };
