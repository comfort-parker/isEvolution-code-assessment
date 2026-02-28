const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");

const router = express.Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password, and name are required." });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name",
      [email, hash, name]
    );
    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    return res.status(201).json({ user, token });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already registered." });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required." });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    const user = rows[0];

    // BUG (timing attack / information leak): Returning 404 when user is not found
    // vs 401 when password is wrong leaks whether an email is registered.
    // Should always return 401 with a generic message, and use bcrypt.compare
    // even when user is not found (to prevent timing differences).
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      user: { id: user.id, email: user.email, name: user.name },
      token,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
