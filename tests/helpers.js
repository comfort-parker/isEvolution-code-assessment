require("dotenv").config({ path: ".env.example" });
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../src/db/pool");

/**
 * Wipe and rebuild all tables for a clean test run.
 */
async function resetDb() {
  await pool.query("DROP TABLE IF EXISTS pledges CASCADE");
  await pool.query("DROP TABLE IF EXISTS campaigns CASCADE");
  await pool.query("DROP TABLE IF EXISTS users CASCADE");

  await pool.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE campaigns (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      goal_amount NUMERIC(14,2) NOT NULL CHECK (goal_amount > 0),
      raised_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','active','funded','cancelled')),
      deadline TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE pledges (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
      backer_id INTEGER NOT NULL REFERENCES users(id),
      amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','confirmed','failed','refunded')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

/**
 * Create a test user and return their record + a signed token.
 */
async function createUser(overrides = {}) {
  const email = overrides.email || "test@example.com";
  const name = overrides.name || "Test User";
  const password = overrides.password || "password123";
  const hash = await bcrypt.hash(password, 10);

  const { rows } = await pool.query(
    "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING *",
    [email, hash, name]
  );
  const user = rows[0];
  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET || "dev-jwt-secret-not-for-production"
  );
  return { user, token };
}

/**
 * Create a test campaign owned by the given user.
 */
async function createCampaign(ownerId, overrides = {}) {
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
  const { rows } = await pool.query(
    `INSERT INTO campaigns
       (owner_id, title, description, goal_amount, raised_amount, status, deadline)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      ownerId,
      overrides.title || "Test Campaign",
      overrides.description || "A test campaign description.",
      overrides.goal_amount || 1000,
      overrides.raised_amount || 0,
      overrides.status || "active",
      overrides.deadline || nextMonth,
    ]
  );
  return rows[0];
}

async function closeDb() {
  await pool.end();
}

module.exports = { resetDb, createUser, createCampaign, closeDb };
