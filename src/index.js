require("dotenv").config();
const express = require("express");

const authRoutes = require("./routes/auth");
const campaignRoutes = require("./routes/campaigns");
const pledgeRoutes = require("./routes/pledges");

const app = express();

app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/campaigns", pledgeRoutes);

// Health check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// 404 fallback
app.use((req, res) => res.status(404).json({ error: "Not found." }));

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Fundly API running on port ${PORT}`));
}

module.exports = app;
