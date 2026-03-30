const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const cors = require("cors");
const cheerio = require("cheerio");
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

// ================= RSS FETCH =================
async function fetchRSS() {
  let all = [];

  const responses = await Promise.all(
    FEEDS.map(f =>
      axios.get(f.url).then(r => ({ data: r.data, source: f.source })).catch(() => null)
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

// ================= SCRAPER =================
async function scrapeLinks(url, base, source) {
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    let articles = [];

    $("a").each((_, el) => {
      const link = $(el).attr("href");
      const title = $(el).text().trim();

      if (!link || !title || title.length < 25) return;

      if (
        !link.includes("podosfairo") &&
        !link.includes("mpasket") &&
        !link.includes("article")
      ) return;

      const fullLink = link.startsWith("http") ? link : base + link;

      const text = title + fullLink;

      articles.push({
        title,
        link: fullLink,
        image: "",
        pubDate: new Date(),
        source,
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return articles;

  } catch {
    return [];
  }
}

// ================= ALL SOURCES =================
async function fetchAll() {
  console.log("Fetching...");

  const rss = await fetchRSS();

  const scrapers = await Promise.all([
    scrapeLinks("https://www.gazzetta.gr/football", "https://www.gazzetta.gr", "Gazzetta"),
    scrapeLinks("https://www.sdna.gr/podosfairo", "https://www.sdna.gr", "SDNA"),
    scrapeLinks("https://www.sport24.gr/", "https://www.sport24.gr", "Sport24"),
    scrapeLinks("https://www.to10.gr/", "https://www.to10.gr", "To10"),
    scrapeLinks("https://sportday.gr/", "https://sportday.gr", "Sportday"),
    scrapeLinks("https://www.sport-fm.gr/", "https://www.sport-fm.gr", "SportFM"),
    scrapeLinks("https://www.athletiko.gr/", "https://www.athletiko.gr", "Athletiko")
  ]);

  const all = [...rss, ...scrapers.flat()];

  for (const a of all) {
    try {
      await Article.updateOne(
        { link: a.link },
        { $setOnInsert: a },
        { upsert: true }
      );
    } catch {}
  }

  console.log("Saved:", all.length);
}

fetchAll();
setInterval(fetchAll, 2 * 60 * 1000);

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

app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});