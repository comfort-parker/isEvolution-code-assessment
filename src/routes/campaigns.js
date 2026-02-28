const express = require("express");
const pool = require("../db/pool");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/campaigns
 * List all active campaigns. Public endpoint.
 */
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         c.id, c.title, c.description, c.goal_amount,
         c.raised_amount, c.status, c.deadline,
         u.name AS owner_name
       FROM campaigns c
       JOIN users u ON u.id = c.owner_id
       WHERE c.status = 'active'
       ORDER BY c.created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * GET /api/campaigns/:id
 * Get a single campaign with its pledge count.
 */
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         c.*,
         u.name AS owner_name,
         COUNT(p.id)::int AS pledge_count
       FROM campaigns c
       JOIN users u ON u.id = c.owner_id
       LEFT JOIN pledges p ON p.campaign_id = c.id
       WHERE c.id = $1
       GROUP BY c.id, u.name`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Campaign not found." });
    return res.json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign. Authenticated users only.
 */
router.post("/", authenticate, async (req, res) => {
  const { title, description, goal_amount, deadline } = req.body;

  if (!title || !description || !goal_amount || !deadline) {
    return res.status(400).json({ error: "title, description, goal_amount, and deadline are required." });
  }

  // BUG: goal_amount is inserted directly from user input without
  // validating it's a positive number. A negative goal creates a campaign
  // that is "funded" the moment any pledge comes in. The DB CHECK constraint
  // will catch truly negative values, but a value of 0.001 passes both.
  // There's no validation that deadline is in the future either.
  try {
    const { rows } = await pool.query(
      `INSERT INTO campaigns (owner_id, title, description, goal_amount, deadline)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, title, description, goal_amount, deadline]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * PATCH /api/campaigns/:id/status
 * Update campaign status. Only the campaign owner may do this.
 *
 * Valid transitions:
 *   draft     → active
 *   active    → cancelled
 *   (funded is set automatically when goal is reached)
 */
router.patch("/:id/status", authenticate, async (req, res) => {
  const { status } = req.body;
  const VALID_STATUSES = ["active", "cancelled"];

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }

  try {
    const { rows } = await pool.query(
      "SELECT * FROM campaigns WHERE id = $1",
      [req.params.id]
    );
    const campaign = rows[0];

    if (!campaign) return res.status(404).json({ error: "Campaign not found." });

    // BUG (IDOR / missing ownership check):
    // Any authenticated user can change any campaign's status.
    // The ownership check (campaign.owner_id === req.user.id) is missing.
    // This was left out "temporarily" during a demo rush and never added back.

    const { rows: updated } = await pool.query(
      "UPDATE campaigns SET status = $1 WHERE id = $2 RETURNING *",
      [status, req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
