/**
 * Tests for /api/campaigns/:id/pledges
 *
 * Happy-path coverage only. The raised_amount sync bug, the expired
 * deadline bug, and the missing decrement on cancellation are not tested.
 */

const request = require("supertest");
const pool = require("../src/db/pool");
const app = require("../src/index");
const { resetDb, createUser, createCampaign, closeDb } = require("./helpers");

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

describe("POST /api/campaigns/:id/pledges", () => {
  it("creates a pledge on an active campaign", async () => {
    const { user: owner } = await createUser({ email: "pledgeowner@test.com" });
    const { user: backer, token } = await createUser({ email: "backer@test.com" });
    const campaign = await createCampaign(owner.id, { status: "active", goal_amount: 1000 });

    const res = await request(app)
      .post(`/api/campaigns/${campaign.id}/pledges`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 100 });

    expect(res.status).toBe(201);
    expect(parseFloat(res.body.amount)).toBe(100);
  });

  it("rejects a pledge on a non-active campaign", async () => {
    const { user: owner } = await createUser({ email: "draftowner@test.com" });
    const { token } = await createUser({ email: "draftbacker@test.com" });
    const campaign = await createCampaign(owner.id, { status: "draft" });

    const res = await request(app)
      .post(`/api/campaigns/${campaign.id}/pledges`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 50 });

    expect(res.status).toBe(400);
  });

  it("rejects a pledge with no amount", async () => {
    const { user: owner } = await createUser({ email: "noamtowner@test.com" });
    const { token } = await createUser({ email: "noamtbacker@test.com" });
    const campaign = await createCampaign(owner.id, { status: "active" });

    const res = await request(app)
      .post(`/api/campaigns/${campaign.id}/pledges`)
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("marks campaign as funded when goal is reached", async () => {
    const { user: owner } = await createUser({ email: "fundedowner@test.com" });
    const { token } = await createUser({ email: "fundedbacker@test.com" });
    const campaign = await createCampaign(owner.id, {
      status: "active",
      goal_amount: 100,
      raised_amount: 0,
    });

    await request(app)
      .post(`/api/campaigns/${campaign.id}/pledges`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 100 });

    const { rows } = await pool.query("SELECT status FROM campaigns WHERE id = $1", [campaign.id]);
    expect(rows[0].status).toBe("funded");
  });

  // NOTE: No test for pledges on expired (past-deadline) campaigns.
  // No test that raised_amount is correctly decremented on cancellation.
  // No test that pending pledges are not counted as raised. (FUND-134)
});

describe("DELETE /api/campaigns/:id/pledges/:pledgeId", () => {
  it("allows a backer to cancel their own pledge", async () => {
    const { user: owner } = await createUser({ email: "delowner@test.com" });
    const { user: backer, token } = await createUser({ email: "delbacker@test.com" });
    const campaign = await createCampaign(owner.id, { status: "active", goal_amount: 1000 });

    const pledgeRes = await request(app)
      .post(`/api/campaigns/${campaign.id}/pledges`)
      .set("Authorization", `Bearer ${token}`)
      .send({ amount: 50 });

    const pledgeId = pledgeRes.body.id;

    const deleteRes = await request(app)
      .delete(`/api/campaigns/${campaign.id}/pledges/${pledgeId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(deleteRes.status).toBe(204);

    // NOTE: This test does NOT verify that raised_amount was decremented.
    // The bug is that it isn't. A test checking raised_amount after deletion
    // would catch it immediately.
  });

  it("prevents a non-backer from cancelling another user's pledge", async () => {
    const { user: owner } = await createUser({ email: "prot-owner@test.com" });
    const { user: backer, token: backerToken } = await createUser({ email: "prot-backer@test.com" });
    const { token: otherToken } = await createUser({ email: "prot-other@test.com" });
    const campaign = await createCampaign(owner.id, { status: "active", goal_amount: 1000 });

    const pledgeRes = await request(app)
      .post(`/api/campaigns/${campaign.id}/pledges`)
      .set("Authorization", `Bearer ${backerToken}`)
      .send({ amount: 75 });

    const pledgeId = pledgeRes.body.id;

    const deleteRes = await request(app)
      .delete(`/api/campaigns/${campaign.id}/pledges/${pledgeId}`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(deleteRes.status).toBe(403);
  });
});

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

// Additional test to cover the expired deadline bug (FUND-134)
it("should reject pledges when campaign deadline has passed", async () => {

  const { token, user } = await createUser({
    email: "deadlinecheck@test.com"
  });

  const campaign = await createCampaign(user.id, {
    status: "active",
    deadline: new Date(Date.now() - 86400000).toISOString()
  });

  const res = await request(app)
    .post(`/api/campaigns/${campaign.id}/pledges`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      amount: 100
    });

  expect(res.status).toBe(400);
});
