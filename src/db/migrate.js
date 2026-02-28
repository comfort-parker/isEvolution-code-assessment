const pool = require("./pool");

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        email       VARCHAR(255) UNIQUE NOT NULL,
        password    VARCHAR(255) NOT NULL,
        name        VARCHAR(255) NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id            SERIAL PRIMARY KEY,
        owner_id      INTEGER NOT NULL REFERENCES users(id),
        title         VARCHAR(255) NOT NULL,
        description   TEXT NOT NULL,
        goal_amount   NUMERIC(14, 2) NOT NULL CHECK (goal_amount > 0),
        -- BUG: raised_amount is updated by application code, not computed
        -- from the pledges table. It can drift out of sync.
        raised_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','funded','cancelled')),
        deadline      TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pledges (
        id            SERIAL PRIMARY KEY,
        campaign_id   INTEGER NOT NULL REFERENCES campaigns(id),
        backer_id     INTEGER NOT NULL REFERENCES users(id),
        amount        NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
        -- BUG (hidden): status column added later in a rushed migration.
        -- 'pending' pledges are counted towards raised_amount even though
        -- payment hasn't been confirmed. This inflates campaign totals.
        status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','confirmed','failed','refunded')),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log("Migration complete.");
  } finally {
    client.release();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
