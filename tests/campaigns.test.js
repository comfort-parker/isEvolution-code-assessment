/**
 * Tests for /api/campaigns
 *
 * These tests cover the happy path. They pass on CI.
 * Several real bugs are not tested here — that's intentional.
 */

const request = require("supertest");
const app = require("../src/index");
const { resetDb, createUser, createCampaign, closeDb } = require("./helpers");

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeDb();
});

describe("GET /api/campaigns", () => {
  it("returns a list of active campaigns", async () => {
    const { user } = await createUser({ email: "owner1@test.com" });
    await createCampaign(user.id, { status: "active" });

    const res = await request(app).get("/api/campaigns");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("does not return draft campaigns", async () => {
    const { user } = await createUser({ email: "owner2@test.com" });
    await createCampaign(user.id, { title: "Hidden Draft", status: "draft" });

    const res = await request(app).get("/api/campaigns");
    const titles = res.body.map((c) => c.title);
    expect(titles).not.toContain("Hidden Draft");
  });
});

describe("POST /api/campaigns", () => {
  it("creates a campaign when authenticated", async () => {
    const { token } = await createUser({ email: "creator@test.com" });
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();

    const res = await request(app)
      .post("/api/campaigns")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "New Campaign",
        description: "A great idea.",
        goal_amount: 5000,
        deadline: nextMonth,
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("New Campaign");
    expect(res.body.status).toBe("draft");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/campaigns")
      .send({ title: "No auth", description: "x", goal_amount: 100, deadline: new Date().toISOString() });

    expect(res.status).toBe(401);
  });

  // NOTE: There is no test for:
  //   - goal_amount validation (negative / zero values)
  //   - deadline in the past
  //   - missing required fields returning 400
  // These are gaps in coverage. (FUND-112)
});

describe("PATCH /api/campaigns/:id/status", () => {
  it("allows owner to activate a draft campaign", async () => {
    const { user, token } = await createUser({ email: "statusowner@test.com" });
    const campaign = await createCampaign(user.id, { status: "draft" });

    const res = await request(app)
      .patch(`/api/campaigns/${campaign.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "active" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  it("rejects invalid status values", async () => {
    const { user, token } = await createUser({ email: "statusowner2@test.com" });
    const campaign = await createCampaign(user.id, { status: "draft" });

    const res = await request(app)
      .patch(`/api/campaigns/${campaign.id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "funded" });   // 'funded' is not a valid user-settable status

    expect(res.status).toBe(400);
  });

  // NOTE: There is NO test verifying that a user who does NOT own
  // the campaign cannot change its status. This is the IDOR bug.
  // The test above only tests the owner path. (FUND-98)
});
