const jwt = require("jsonwebtoken");

/**
 * Middleware that verifies a JWT from the Authorization header.
 * Attaches the decoded user payload to req.user on success.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({ error: "Authorization header required." });
  }

  // Strictly enforce "Bearer <token>" format
  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({
      error: "Authorization header must be in the format: Bearer <token>."
    });
  }
 
  const token = parts[1];

  if (!token) {
    return res.status(401).json({ error: "Token not provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"] // Explicitly pin algorithm
    });

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: "Invalid or expired token."
    });
  }
}

module.exports = { authenticate };
