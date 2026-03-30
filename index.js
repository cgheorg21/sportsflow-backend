const express = require("express");
const axios = require("axios");
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

// ================= TEAM =================
const teamKeywords = {
  "ΠΑΟΚ": ["παοκ"],
  "ΟΛΥΜΠΙΑΚΟΣ": ["ολυμπιακ"],
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": ["παναθην"],
  "ΑΕΚ": ["αεκ"],
  "ΑΡΗΣ": ["αρη"]
};

function detectTeam(text) {
  text = text.toLowerCase();
  for (const team in teamKeywords) {
    if (teamKeywords[team].some(k => text.includes(k))) return team;
  }
  return null;
}

// ================= CATEGORY =================
function detectCategory(text) {
  text = text.toLowerCase();

  if (["μπασκετ","nba","euroleague"].some(k => text.includes(k)))
    return "BASKET";

  if (["ποδοσφ","super league","uefa"].some(k => text.includes(k)))
    return "FOOTBALL";

  return "ALL"; // 🔥 σωστό ALL
}

// ================= ARTICLE FETCH =================
async function fetchArticle(url, source) {
  try {
    const res = await axios.get(url, { timeout: 7000 });
    const $ = cheerio.load(res.data);

    const title =
      $("meta[property='og:title']").attr("content") ||
      $("title").text();

    const image =
      $("meta[property='og:image']").attr("content") ||
      "";

    if (!title || title.length < 20) return null;

    const text = title + url;

    return {
      title,
      link: url,
      image,
      pubDate: new Date(),
      source,
      team: detectTeam(text),
      category: detectCategory(text)
    };

  } catch {
    return null;
  }
}

// ================= LINK SCRAPER =================
async function scrapeLinks(url, base, patterns, source) {
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    let links = new Set();

    $("a").each((_, el) => {
      const href = $(el).attr("href");

      if (!href || href.length < 30) return;
      if (!patterns.some(p => href.includes(p))) return;

      const full = href.startsWith("http") ? href : base + href;

      links.add(full);

      if (links.size > 60) return false;
    });

    const articles = [];

    for (const link of links) {
      const article = await fetchArticle(link, source);
      if (article) articles.push(article);
    }

    return articles;

  } catch {
    return [];
  }
}

// ================= SCRAPERS =================

// GAZZETTA
const scrapeGazzetta = async () => [
  ...(await scrapeLinks(
    "https://www.gazzetta.gr/football",
    "https://www.gazzetta.gr",
    ["/football/"],
    "Gazzetta"
  )),
  ...(await scrapeLinks(
    "https://www.gazzetta.gr/basketball",
    "https://www.gazzetta.gr",
    ["/basketball/"],
    "Gazzetta"
  ))
];

// SDNA
const scrapeSDNA = async () => [
  ...(await scrapeLinks(
    "https://www.sdna.gr/podosfairo",
    "https://www.sdna.gr",
    ["/podosfairo/"],
    "SDNA"
  )),
  ...(await scrapeLinks(
    "https://www.sdna.gr/mpasket",
    "https://www.sdna.gr",
    ["/mpasket/"],
    "SDNA"
  ))
];

// SPORT24
const scrapeSport24 = async () => [
  ...(await scrapeLinks(
    "https://www.sport24.gr/football",
    "https://www.sport24.gr",
    ["/football/"],
    "Sport24"
  )),
  ...(await scrapeLinks(
    "https://www.sport24.gr/basket",
    "https://www.sport24.gr",
    ["/basket/"],
    "Sport24"
  ))
];

// SPORTFM
const scrapeSportFM = async () => [
  ...(await scrapeLinks(
    "https://www.sport-fm.gr/news/podosfairo",
    "https://www.sport-fm.gr",
    ["/article/"],
    "SportFM"
  )),
  ...(await scrapeLinks(
    "https://www.sport-fm.gr/news/basket",
    "https://www.sport-fm.gr",
    ["/article/"],
    "SportFM"
  ))
];

// TO10
const scrapeTo10 = async () => [
  ...(await scrapeLinks(
    "https://www.to10.gr/category/podosfero/",
    "https://www.to10.gr",
    ["/podosfero/"],
    "To10"
  )),
  ...(await scrapeLinks(
    "https://www.to10.gr/category/basket/",
    "https://www.to10.gr",
    ["/basket/"],
    "To10"
  ))
];

// SPORTDAY
const scrapeSportday = async () => [
  ...(await scrapeLinks(
    "https://sportday.gr/podosfairo",
    "https://sportday.gr",
    ["/podosfairo/"],
    "Sportday"
  )),
  ...(await scrapeLinks(
    "https://sportday.gr/basket",
    "https://sportday.gr",
    ["/basket/"],
    "Sportday"
  ))
];

// ATHLETIKO
const scrapeAthletiko = async () => [
  ...(await scrapeLinks(
    "https://www.athletiko.gr/podosfairo",
    "https://www.athletiko.gr",
    ["/podosfairo/"],
    "Athletiko"
  )),
  ...(await scrapeLinks(
    "https://www.athletiko.gr/mpasket",
    "https://www.athletiko.gr",
    ["/mpasket/"],
    "Athletiko"
  ))
];

// NOVASPORTS
const scrapeNovasports = async () => [
  ...(await scrapeLinks(
    "https://www.novasports.gr/sport/podosfairo/news/",
    "https://www.novasports.gr",
    ["/podosfairo/"],
    "Novasports"
  )),
  ...(await scrapeLinks(
    "https://www.novasports.gr/sport/mpasket/news/",
    "https://www.novasports.gr",
    ["/mpasket/"],
    "Novasports"
  ))
];

// ================= ENGINE =================
async function run() {
  console.log("Fetching...");

  const results = await Promise.all([
    scrapeGazzetta(),
    scrapeSDNA(),
    scrapeSport24(),
    scrapeSportFM(),
    scrapeTo10(),
    scrapeSportday(),
    scrapeAthletiko(),
    scrapeNovasports()
  ]);

  const all = results.flat();

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

run();
setInterval(run, 2 * 60 * 1000);

// ================= API =================
app.get("/articles", async (req, res) => {
  const { team, category, source, page = 1 } = req.query;

  const query = {};

  if (team) query.team = team;
  if (source) query.source = source;

  // 🔥 ALL = ΔΕΝ φιλτράρει
  if (category && category !== "ALL") {
    query.category = category;
  }

  const data = await Article.find(query)
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server running");
});