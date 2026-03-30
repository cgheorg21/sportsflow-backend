const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ================= AXIOS CONFIG (CRITICAL FIX) =================
const AXIOS_CONFIG = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "el-GR,el;q=0.9,en-US;q=0.8",
  },
  timeout: 10000,
  maxRedirects: 5,
};

// ================= DB =================
mongoose.connect(process.env.MONGO_URI);

const Article = mongoose.model(
  "Article",
  new mongoose.Schema({
    title: String,
    link: { type: String, unique: true },
    image: String,
    pubDate: Date,
    source: String,
    team: String,
    category: String,
    categories: [String],
  })
);

// ================= HELPERS =================
const normalize = (t = "") =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const teamMap = {
  ΠΑΟΚ: /παοκ/,
  ΟΛΥΜΠΙΑΚΟΣ: /ολυμπιακ/,
  ΠΑΝΑΘΗΝΑΙΚΟΣ: /παναθην/,
  ΑΕΚ: /\bαεκ\b/,
  ΑΡΗΣ: /αρη/,
};

const detectTeam = (text = "") => {
  const t = normalize(text);
  for (const [team, regex] of Object.entries(teamMap)) {
    if (regex.test(t)) return team;
  }
  return "OTHER";
};

const detectCategory = (title = "", url = "", sourceCategory) => {
  const t = normalize(title + " " + url);

  if (t.includes("basket") || t.includes("μπασκετ")) return "BASKET";
  if (t.includes("football") || t.includes("ποδοσφ")) return "FOOTBALL";

  return sourceCategory || "ALL";
};

const buildUrl = (href, base) => {
  try {
    if (!href || href.startsWith("#")) return null;
    if (href.startsWith("http")) return href;
    return new URL(href, base).href;
  } catch {
    return null;
  }
};

const isArticle = (url) => {
  try {
    const u = new URL(url);
    return (
      u.pathname.length > 10 &&
      !u.pathname.includes("tag") &&
      !u.pathname.includes("category")
    );
  } catch {
    return false;
  }
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= SCRAPER =================
const MAX_LINKS = 40;

async function fetchArticle(url, source, sourceCategory) {
  try {
    const res = await axios.get(url, AXIOS_CONFIG);
    const $ = cheerio.load(res.data);

    let title =
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text() ||
      $("title").text();

    if (!title) return null;
    title = title.trim();
    if (title.length < 5) return null;

    let image =
      $("meta[property='og:image']").attr("content") ||
      $("img").first().attr("src");

    if (image?.startsWith("//")) image = "https:" + image;
    if (image?.startsWith("/")) image = new URL(image, url).href;
    if (image?.includes("data:image")) image = null;

    const team = detectTeam(title);
    const baseCategory = detectCategory(title, url, sourceCategory);

    const categories = new Set(["ALL"]);
    if (baseCategory !== "ALL") categories.add(baseCategory);
    if (team !== "OTHER") categories.add(team);
    categories.add(source);

    return {
      title,
      link: url,
      image:
        image || "https://via.placeholder.com/600x400?text=Sport",
      pubDate: new Date(),
      source,
      team,
      category: baseCategory,
      categories: Array.from(categories),
    };
  } catch {
    return null;
  }
}

async function scrape(site) {
  try {
    console.log("📡", site.name);

    const res = await axios.get(site.url, AXIOS_CONFIG);
    const $ = cheerio.load(res.data);

    const links = new Set();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const full = buildUrl(href, site.base);
      if (full && isArticle(full)) links.add(full);
    });

    console.log("🔗 found links:", site.name, links.size);

    const articles = [];
    const list = Array.from(links).slice(0, MAX_LINKS);

    for (const link of list) {
      const a = await fetchArticle(link, site.name, site.category);
      if (a) articles.push(a);

      await delay(250);
    }

    console.log(" articles:", site.name, articles.length);
    return articles;
  } catch (err) {
    console.log("❌", site.name, err.message);
    return [];
  }
}

// ================= SOURCES =================
const sources = [
  { name: "Gazzetta", category: "FOOTBALL", url: "https://www.gazzetta.gr/football", base: "https://www.gazzetta.gr" },
  { name: "Gazzetta", category: "BASKET", url: "https://www.gazzetta.gr/basketball", base: "https://www.gazzetta.gr" },

  { name: "Sport24", category: "FOOTBALL", url: "https://www.sport24.gr/football/", base: "https://www.sport24.gr" },
  { name: "Sport24", category: "BASKET", url: "https://www.sport24.gr/basket/", base: "https://www.sport24.gr" },

  { name: "SDNA", category: "FOOTBALL", url: "https://www.sdna.gr/podosfairo", base: "https://www.sdna.gr" },
  { name: "SDNA", category: "BASKET", url: "https://www.sdna.gr/mpasket", base: "https://www.sdna.gr" },

  { name: "Novasports", category: "FOOTBALL", url: "https://www.novasports.gr/sport/podosfairo/news/", base: "https://www.novasports.gr" },
  { name: "Novasports", category: "BASKET", url: "https://www.novasports.gr/sport/mpasket/news/", base: "https://www.novasports.gr" },

  { name: "To10", category: "FOOTBALL", url: "https://www.to10.gr/category/podosfero/", base: "https://www.to10.gr" },
  { name: "To10", category: "BASKET", url: "https://www.to10.gr/category/basket/", base: "https://www.to10.gr" },

  { name: "Athletiko", category: "FOOTBALL", url: "http://athletiko.gr/podosfairo", base: "http://athletiko.gr" },
  { name: "Athletiko", category: "BASKET", url: "https://www.athletiko.gr/mpasket", base: "https://www.athletiko.gr" },

  { name: "Sportday", category: "FOOTBALL", url: "https://sportday.gr/podosfairo", base: "https://sportday.gr" },
  { name: "Sportday", category: "BASKET", url: "https://sportday.gr/basket", base: "https://sportday.gr" },

  { name: "SportFM", category: "FOOTBALL", url: "https://www.sport-fm.gr/list/podosfairo/1", base: "https://www.sport-fm.gr" },
  { name: "SportFM", category: "BASKET", url: "https://www.sport-fm.gr/list/basket/2", base: "https://www.sport-fm.gr" },
];

// ================= ENGINE =================
async function run() {
  console.log("🚀 SCRAPER START");

  const all = [];

  for (const s of sources) {
    const res = await scrape(s);
    all.push(...res);
  }

  for (const a of all) {
    try {
      await Article.findOneAndUpdate(
        { link: a.link },
        a,
        { upsert: true }
      );
    } catch {}
  }

  console.log("✅ DONE:", all.length);
}

// ================= START =================
mongoose.connection.once("open", () => {
  console.log(" DB READY");

  run();
  setInterval(run, 15 * 60 * 1000);
});

// ================= API =================
app.get("/articles", async (req, res) => {
  const { category, team, source } = req.query;

  const query = {};

  if (category && category !== "ALL") {
    query.categories = { $in: [category] };
  }

  if (team && team !== "ALL") {
    query.categories = { $in: [team] };
  }

  if (source) {
    query.categories = { $in: [source] };
  }

  const data = await Article.find(query)
    .sort({ pubDate: -1 })
    .limit(50);

  res.json(data);
});

app.listen(PORT, () => console.log(" Server running"));