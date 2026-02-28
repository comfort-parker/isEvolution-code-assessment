const express = require("express");
const pool = require("../db/pool");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

/**
 * POST /api/campaigns/:id/pledges
 * Back a campaign with a pledge.
 *
 * In production, this would integrate with Stripe. Here we stub the
 * payment step and mark pledges 'confirmed' immediately — except we
 * don't (see bug below).
 */
router.post("/:id/pledges", authenticate, async (req, res) => {
  const campaignId = req.params.id;
  const { amount } = req.body;

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: "amount must be a positive number." });
  }

  try {
    // Fetch campaign
    const { rows: campRows } = await pool.query(
      "SELECT * FROM campaigns WHERE id = $1",
      [campaignId]
    );
    const campaign = campRows[0];

    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    if (campaign.status !== "active") {
      return res.status(400).json({ error: "This campaign is not accepting pledges." });
    }

    // BUG: No check that campaign.deadline hasn't passed.
    // A campaign with status='active' but a deadline in the past can still
    // receive pledges indefinitely. There is a seed record for exactly this case.

    // BUG (race condition / double-spend):
    // raised_amount is updated in a separate query from the pledge insert.
    // Under concurrent load, two requests can both read the same raised_amount,
    // both insert pledges, and both add their amount — resulting in raised_amount
    // being incremented only once (last-write-wins) while two pledges exist.
    // The fix is a single atomic UPDATE … RETURNING or a transaction with
    // SELECT … FOR UPDATE.

    const pledgeAmount = parseFloat(amount);

    // Insert pledge (status defaults to 'pending' — simulating async payment)
    const { rows: pledgeRows } = await pool.query(
      `INSERT INTO pledges (campaign_id, backer_id, amount, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [campaignId, req.user.id, pledgeAmount]
    );

    // BUG: raised_amount is updated immediately even though the pledge is
    // 'pending' (payment not confirmed). If payment later fails, raised_amount
    // is never rolled back — overstating the campaign's funding.
    const newRaised = parseFloat(campaign.raised_amount) + pledgeAmount;

    await pool.query(
      "UPDATE campaigns SET raised_amount = $1 WHERE id = $2",
      [newRaised, campaignId]
    );

    // Check if campaign has now hit its goal — if so, mark it funded
    if (newRaised >= parseFloat(campaign.goal_amount)) {
      await pool.query(
        "UPDATE campaigns SET status = 'funded' WHERE id = $1",
        [campaignId]
      );
    }

    return res.status(201).json(pledgeRows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * GET /api/campaigns/:id/pledges
 * List all pledges for a campaign. Public — shows confirmed pledges only.
 */
router.get("/:id/pledges", async (req, res) => {
  try {
    // BUG: Returns ALL pledge statuses including 'pending' and 'failed',
    // not just 'confirmed'. Backers can see their own failed payment attempts
    // in the public list, leaking payment failure info.
    // Also returns backer_id which could be used to correlate users across
    // campaigns — a minor privacy issue for a junior to spot.
    const { rows } = await pool.query(
      `SELECT p.id, p.backer_id, p.amount, p.status, p.created_at,
              u.name AS backer_name
       FROM pledges p
       JOIN users u ON u.id = p.backer_id
       WHERE p.campaign_id = $1
       ORDER BY p.created_at DESC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * DELETE /api/campaigns/:id/pledges/:pledgeId
 * Cancel (retract) a pledge. Only the backer may do this,
 * and only if the campaign is still active.
 */
router.delete("/:id/pledges/:pledgeId", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM pledges WHERE id = $1",
      [req.params.pledgeId]
    );
    const pledge = rows[0];

    if (!pledge) return res.status(404).json({ error: "Pledge not found." });
    if (pledge.backer_id !== req.user.id) {
      return res.status(403).json({ error: "You can only cancel your own pledges." });
    }

    // BUG: raised_amount is NOT decremented when a pledge is cancelled.
    // The campaign total stays inflated permanently after a cancellation,
    // potentially showing the campaign as 'funded' even after backers withdraw.
    await pool.query("DELETE FROM pledges WHERE id = $1", [req.params.pledgeId]);

    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
