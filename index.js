const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// ================= MODEL =================
const Article = mongoose.model("Article", new mongoose.Schema({
  title: String,
  link: { type: String, unique: true },
  image: String,
  pubDate: Date,
  source: String,
  team: String,
  category: String
}));

// ================= KEYWORDS =================
const teamKeywords = {
  "ΟΛΥΜΠΙΑΚΟΣ": ["ολυμπιακ","osfp"],
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": ["παναθην","παο"],
  "ΑΕΚ": ["αεκ"],
  "ΠΑΟΚ": ["παοκ"],
  "ΑΡΗΣ": ["αρη"],
  "ΟΦΗ": ["οφη"],
  "ΒΟΛΟΣ": ["βολο"],
  "ΛΕΒΑΔΕΙΑΚΟΣ": ["λεβαδ"],
  "ΑΤΡΟΜΗΤΟΣ": ["ατρομη"],
  "ΚΗΦΙΣΙΑ": ["κηφισ"],
  "ΠΑΝΑΙΤΩΛΙΚΟΣ": ["παναιτωλ"],
  "ΑΕΛ": ["αελ"],
  "ΠΑΝΣΕΡΑΙΚΟΣ": ["πανσερ"],
  "ΑΣΤΕΡΑΣ": ["αστερα"],
  "ΚΑΛΑΜΑΤΑ": ["καλαματ"],
  "ΗΡΑΚΛΗΣ": ["ηρακλ"]
};

function detectTeam(text) {
  text = text.toLowerCase();
  for (const team in teamKeywords) {
    if (teamKeywords[team].some(k => text.includes(k))) return team;
  }
  return null;
}

function detectCategory(text) {
  text = text.toLowerCase();

  if (["nba","euroleague","μπασκετ"].some(k => text.includes(k)))
    return "BASKET";

  if (["ποδοσφ","football","super league","uefa"].some(k => text.includes(k)))
    return "FOOTBALL";

  return "OTHER";
}

// ================= RSS =================
const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://www.sport-fm.gr/rss/news", source: "SportFM" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" }
];

// ================= FETCH =================
async function fetchArticles() {
  let all = [];

  const responses = await Promise.all(
    FEEDS.map(f =>
      axios.get(f.url, { timeout: 5000 })
        .then(r => ({ data: r.data, source: f.source }))
        .catch(() => null)
    )
  );

  for (const feed of responses) {
    if (!feed) continue;

    try {
      const parsed = await xml2js.parseStringPromise(feed.data);
      const items = parsed?.rss?.channel?.[0]?.item || [];

      for (const item of items) {
        let title = item.title?.[0] || "";
        const desc = item.description?.[0] || "";
        const link = item.link?.[0] || "";

        // FIX SportFM titles
        if (title.includes("|||")) {
          const parts = title.split("|||").map(p => p.trim());
          title = parts.reduce((a,b)=>a.length>b.length?a:b);
        }

        const text = (title + " " + desc + " " + link).toLowerCase();

        all.push({
          title,
          link,
          image: item.enclosure?.[0]?.$.url || "",
          pubDate: new Date(item.pubDate?.[0] || Date.now()),
          source: feed.source,
          team: detectTeam(text),
          category: detectCategory(text)
        });
      }

    } catch {}
  }

  return all;
}

// ================= SAVE =================
async function saveArticles(list) {
  for (const a of list) {
    try {
      await Article.updateOne(
        { link: a.link },
        { $setOnInsert: a },
        { upsert: true }
      );
    } catch {}
  }
}

// ================= ENGINE =================
async function run() {
  console.log("Fetching articles...");

  const articles = await fetchArticles();
  await saveArticles(articles);

  console.log("Saved:", articles.length);
}

run();
setInterval(run, 2 * 60 * 1000);

// ================= API =================
app.get("/articles", async (req, res) => {
  const { team, category, source, page = 1 } = req.query;

  const query = {};

  if (team) query.team = team;
  if (category) query.category = category;
  if (source) query.source = source;

  const data = await Article.find(query)
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(data);
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});