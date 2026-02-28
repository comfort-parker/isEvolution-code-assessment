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

  // BUG (junior-level): This splits on any whitespace and takes index [1],
  // which works for "Bearer <token>" but silently accepts malformed headers
  // like "token" (no scheme), returning undefined as the token — which then
  // throws an unclear JsonWebTokenError rather than a clean 401.
  // A junior dev copy-pasted this from a tutorial and it mostly works,
  // but the error handling path is broken.
  const token = authHeader.split(" ")[1];

  try {
    // BUG (subtle): algorithms is not explicitly specified.
    // This allows the 'none' algorithm attack on older versions of jsonwebtoken.
    // Even on patched versions, best practice requires explicit algorithm pinning.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

module.exports = { authenticate };
