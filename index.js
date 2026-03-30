const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// =======================
// DB
// =======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// =======================
// MODEL
// =======================
const ArticleSchema = new mongoose.Schema({
  title: String,
  link: { type: String, unique: true },
  image: String,
  pubDate: Date,
  source: String,
  team: String,
  category: String
}, { timestamps: true });

const Article = mongoose.model("Article", ArticleSchema);

// =======================
// DETECTION
// =======================
const teamKeywords = {
  PAOK:["παοκ","τουμπ"],
  OLYMPIACOS:["ολυμπιακ","osfp"],
  PANATHINAIKOS:["παναθην","παο"],
  AEK:["αεκ"],
  ARIS:["αρη"],
  OFI:["οφη"],
  VOLOS:["βολο"],
  LEVADIAKOS:["λεβαδ"],
  ATROMITOS:["ατρομη"],
  KIFISIA:["κηφισ"],
  PANETOLIKOS:["παναιτωλ"],
  AEL:["αελ"],
  PANSERRAIKOS:["πανσερ"],
  ASTERAS:["αστερα"],
  KALAMATA:["καλαματ"],
  IRAKLIS:["ηρακλ"]
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

  if (["nba","euroleague","μπασκετ"].some(k => text.includes(k))) return "basket";
  if (["ποδοσφ","football","uefa","super league"].some(k => text.includes(k))) return "football";

  return "other";
}

// =======================
// RSS
// =======================
const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" },
  { url: "https://www.sport-fm.gr/rss/news", source: "SportFM" }
];

function extractImage(item) {
  return item.enclosure?.[0]?.$?.url || "";
}

// =======================
// RSS FETCH
// =======================
async function fetchRSS() {
  const responses = await Promise.all(
    FEEDS.map(feed =>
      axios.get(feed.url).then(r => ({ data: r.data, source: feed.source })).catch(() => null)
    )
  );

  let all = [];

  for (const feed of responses) {
    if (!feed) continue;

    try {
      const result = await xml2js.parseStringPromise(feed.data);
      const items = result?.rss?.channel?.[0]?.item || [];

      const articles = items.map(item => {
        let title = item.title?.[0] || "";

        // fix SportFM weird titles
        if (title.includes("|||")) {
          const parts = title.split("|||").map(p => p.trim());
          title = parts.reduce((a,b)=>a.length>b.length?a:b);
        }

        const link = item.link?.[0] || "";
        const text = title + link;

        return {
          title,
          link,
          image: extractImage(item),
          pubDate: new Date(item.pubDate?.[0] || Date.now()),
          source: feed.source,
          team: detectTeam(text),
          category: detectCategory(text)
        };
      });

      all = all.concat(articles);

    } catch {}
  }

  return all;
}

// =======================
// GENERIC SCRAPER
// =======================
async function scrape(url, source) {
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    let articles = [];

    $("article").each((_, el) => {
      const title = $(el).find("h2, h3").text().trim();
      const link = $(el).find("a").attr("href");

      if (!title || title.length < 20 || !link) return;

      const fullLink = link.startsWith("http") ? link : url + link;

      const image =
        $(el).find("img").attr("src") ||
        $(el).find("img").attr("data-src") ||
        "";

      const text = title + fullLink;

      articles.push({
        title,
        link: fullLink,
        image,
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

// =======================
// ATHLETIKO (CUSTOM FIX)
// =======================
async function fetchAthletiko() {
  return scrape("https://www.athletiko.gr/", "Athletiko");
}

// =======================
// SPORTFM (EXTRA SCRAPE)
// =======================
async function fetchSportFM() {
  return scrape("https://www.sport-fm.gr/", "SportFM");
}

// =======================
// FETCH ALL
// =======================
async function fetchAllSources() {
  const results = await Promise.all([
    fetchRSS(),

    scrape("https://www.sport24.gr/", "Sport24"),
    scrape("https://www.sport24.gr/podosfairo/", "Sport24"),
    scrape("https://www.sport24.gr/mpasket/", "Sport24"),

    scrape("https://www.sdna.gr/podosfairo", "SDNA"),
    scrape("https://www.sdna.gr/mpasket", "SDNA"),

    scrape("https://www.gazzetta.gr/football", "Gazzetta"),
    scrape("https://www.gazzetta.gr/basketball", "Gazzetta"),

    scrape("https://www.to10.gr/", "To10"),
    scrape("https://sportday.gr/", "Sportday"),

    scrape("https://www.novasports.gr/", "Novasports"),

    fetchAthletiko(),
    fetchSportFM()
  ]);

  return results.flat();
}

// =======================
// SAVE
// =======================
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

// =======================
// ENGINE
// =======================
async function fetchAll() {
  console.log("Fetching...");

  const articles = await fetchAllSources();
  await saveArticles(articles);

  console.log("Saved:", articles.length);
}

fetchAll();
setInterval(fetchAll, 2 * 60 * 1000);

// =======================
// API
// =======================
app.get("/articles", async (req, res) => {
  const { team, category, source, page = 1 } = req.query;

  const query = {};
  if (team) query.team = team;
  if (category) query.category = category;
  if (source) query.source = source;

  const articles = await Article.find(query)
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(articles);
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});