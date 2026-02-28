require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

async function seed() {
  const client = await pool.connect();
  try {
    // Run migrations first
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS campaigns (
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
      CREATE TABLE IF NOT EXISTS pledges (
        id SERIAL PRIMARY KEY,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        backer_id INTEGER NOT NULL REFERENCES users(id),
        amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','confirmed','failed','refunded')),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query("DELETE FROM pledges");
    await client.query("DELETE FROM campaigns");
    await client.query("DELETE FROM users");

    const hash = await bcrypt.hash("password123", 10);

    const { rows: users } = await client.query(
      `INSERT INTO users (email, password, name) VALUES
        ('alice@example.com', $1, 'Alice Chen'),
        ('bob@example.com',   $1, 'Bob Marsh'),
        ('carol@example.com', $1, 'Carol Singh')
       RETURNING id`,
      [hash]
    );

    const [alice, bob, carol] = users;
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();

    const { rows: campaigns } = await client.query(
      `INSERT INTO campaigns
        (owner_id, title, description, goal_amount, raised_amount, status, deadline)
       VALUES
        ($1, 'Solar-Powered Community Library',
             'Bringing renewable energy to our local library.',
             10000, 6200, 'active', $4),
        ($2, 'Open Source Recipe App',
             'A free app for sharing family recipes across generations.',
             5000, 5000, 'funded', $3),
        ($1, 'Urban Beekeeping Starter Kit',
             'Help us launch a rooftop beekeeping program.',
             2000, 0, 'draft', $4),
        ($3, 'Midnight Run Documentary',
             'A short film about overnight delivery workers.',
             8000, 1500, 'active', $4),
        ($2, 'Expired Campaign',
             'This campaign deadline has passed.',
             3000, 800, 'active', $5)
       RETURNING id`,
      [alice.id, bob.id, carol.id, nextMonth, yesterday]
    );

    const [library, recipe, beekeeping, documentary, expired] = campaigns;

    // Pledges — a mix of confirmed and pending
    await client.query(
      `INSERT INTO pledges (campaign_id, backer_id, amount, status) VALUES
        ($1, $3, 1500, 'confirmed'),
        ($1, $4, 2000, 'confirmed'),
        ($1, $3, 1200, 'pending'),   -- pending but already in raised_amount (the bug)
        ($1, $4, 1500, 'confirmed'),
        ($2, $3, 2500, 'confirmed'),
        ($2, $4, 2500, 'confirmed'),
        ($4, $3,  750, 'confirmed'),
        ($4, $3,  750, 'pending'),
        ($5, $4,  800, 'confirmed')`,
      [library.id, recipe.id, alice.id, carol.id, bob.id]
    );

    console.log("Seed complete. Test accounts:");
    console.log("  alice@example.com / password123");
    console.log("  bob@example.com   / password123");
    console.log("  carol@example.com / password123");
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
