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
    return res.status(400).json({
      error: "amount must be a positive number."
    });
  }

  const pledgeAmount = parseFloat(amount);

  try {
    // Start transaction to ensure atomicity of pledge creation and campaign update.
    await pool.query("BEGIN");

    // Fetch campaign FOR UPDATE (prevents race conditions)
    const { rows: campRows } = await pool.query(
      "SELECT * FROM campaigns WHERE id = $1 FOR UPDATE",
      [campaignId]
    );

    const campaign = campRows[0];

    if (!campaign) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Campaign not found." });
    }

    // Check campaign status
    if (campaign.status !== "active") {
      await pool.query("ROLLBACK");
      return res.status(400).json({
        error: "This campaign is not accepting pledges."
      });
    }

    // Deadline validation to prevent pledges after campaign has ended.
    if (new Date(campaign.deadline) < new Date()) {
      await pool.query("ROLLBACK");
      return res.status(400).json({
        error: "Campaign deadline has passed."
      });
    }

    // Insert pledge
    const { rows: pledgeRows } = await pool.query(
      `INSERT INTO pledges (campaign_id, backer_id, amount, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [campaignId, req.user.id, pledgeAmount]
    );

    // Update raised_amount atomically
    const { rows: updatedCampaign } = await pool.query(
      `UPDATE campaigns
       SET raised_amount = raised_amount + $1
       WHERE id = $2
       RETURNING *`,
      [pledgeAmount, campaignId]
    );

    const newCampaign = updatedCampaign[0];

    // Check funding goal
    if (parseFloat(newCampaign.raised_amount) >=
        parseFloat(newCampaign.goal_amount)) {

      await pool.query(
        `UPDATE campaigns
         SET status = 'funded'
         WHERE id = $1`,
        [campaignId]
      );
    }

    await pool.query("COMMIT");

    return res.status(201).json(pledgeRows[0]);

  } catch (err) {
    await pool.query("ROLLBACK");

    console.error(err);
    return res.status(500).json({
      error: "Internal server error."
    });
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
      `SELECT p.id, p.amount, p.status, p.created_at,
              u.name AS backer_name
       FROM pledges p
       JOIN users u ON u.id = p.backer_id
       WHERE p.campaign_id = $1
       AND p.status = 'confirmed'
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

    // Start transaction to ensure atomicity of pledge deletion and campaign update.
    await pool.query("BEGIN");

    const { rows } = await pool.query(
      "SELECT * FROM pledges WHERE id = $1",
      [req.params.pledgeId]
    );

    const pledge = rows[0];

    if (!pledge) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Pledge not found." });
    }

    // Ownership check
    if (pledge.backer_id !== req.user.id) {
      await pool.query("ROLLBACK");
      return res.status(403).json({
        error: "You can only cancel your own pledges."
      });
    }

    // Check campaign status
    const { rows: campaignRows } = await pool.query(
      "SELECT * FROM campaigns WHERE id = $1",
      [req.params.id]
    );

    const campaign = campaignRows[0];

    if (!campaign) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: "Campaign not found." });
    }

    if (campaign.status !== "active") {
      await pool.query("ROLLBACK");
      return res.status(400).json({
        error: "Cannot cancel pledge. Campaign is not active."
      });
    }

    //  Deduct pledge amount from campaign raised total
    await pool.query(
      `UPDATE campaigns
       SET raised_amount = raised_amount - $1
       WHERE id = $2`,
      [pledge.amount, req.params.id]
    );

    // Delete pledge
    await pool.query(
      "DELETE FROM pledges WHERE id = $1",
      [req.params.pledgeId]
    );

    await pool.query("COMMIT");

    return res.status(204).send();

  } catch (err) {
    await pool.query("ROLLBACK");

    console.error(err);
    return res.status(500).json({
      error: "Internal server error."
    });
  }
});


module.exports = router;

