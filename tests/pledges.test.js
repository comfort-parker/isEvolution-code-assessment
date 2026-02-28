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
