const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");
const { parseStringPromise } = require("xml2js");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const AXIOS_CONFIG = () => ({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  },
  timeout: 15000,
});

// ================= DB =================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ DB Error:", err));

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

// ================= TEAM DETECTION =================
const teamMap = {
  ΠΑΟΚ: /παοκ|τούμπα/i,
  ΟΛΥΜΠΙΑΚΟΣ: /ολυμπιακ|θρύλος/i,
  ΠΑΝΑΘΗΝΑΙΚΟΣ: /παναθην|τριφύλλι/i,
  ΑΕΚ: /\bαεκ\b|αγιά\s*σοφιά/i,
  ΑΡΗΣ: /άρης|aris/i,
};

const detectTeam = (text = "") => {
  for (const [name, regex] of Object.entries(teamMap)) {
    if (regex.test(text.toLowerCase())) return name;
  }
  return "OTHER";
};

// ================= CATEGORY DETECTION =================
const detectCategory = (title = "", url = "", sourceCategory = null) => {
  const t = (title + " " + url).toLowerCase();

  if (t.includes("basket") || t.includes("μπασκετ")) return "BASKET";
  if (t.includes("football") || t.includes("ποδοσφ")) return "FOOTBALL";

  return sourceCategory || "ALL";
};

// ================= URL BUILDER =================
function buildUrl(href, base) {
  try {
    if (!href || href.startsWith("#") || href.startsWith("javascript"))
      return null;
    if (href.startsWith("http")) return href;
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// ================= ARTICLE SCRAPER =================
async function fetchArticleDetails(url, source, sourceCategory) {
  try {
    const res = await axios.get(url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);

    const title =
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text();

    if (!title || title.length < 10) return null;

    let image =
      $("meta[property='og:image']").attr("content") ||
      $("img").first().attr("src");

    if (image?.startsWith("//")) image = "https:" + image;
    if (image?.startsWith("/")) image = new URL(image, url).href;
    if (image?.includes("data:image")) image = null;

    const team = detectTeam(title);
    const baseCategory = detectCategory(title, url, sourceCategory);

    const categories = new Set();
    categories.add("ALL");

    if (baseCategory !== "ALL") categories.add(baseCategory);
    if (team !== "OTHER") categories.add(team);
    if (source) categories.add(source);

    return {
      title: title.trim(),
      link: url,
      image:
        image || "https://via.placeholder.com/600x400?text=Sport+News",
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

// ================= GENERIC ARTICLE FILTER =================
const isArticleGeneric = (url) => {
  try {
    const u = new URL(url);
    return (
      u.pathname.split("/").length > 2 &&
      !u.pathname.includes("tag") &&
      !u.pathname.includes("video") &&
      !u.pathname.includes("category")
    );
  } catch {
    return false;
  }
};

// ================= SCRAPER =================
async function scrapeHtmlSource(site) {
  try {
    console.log(`📡 ${site.name} → ${site.url}`);
    const res = await axios.get(site.url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);

    const links = new Set();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const full = buildUrl(href, site.base);
      if (!full) return;

      if (isArticleGeneric(full)) links.add(full);
    });

    const linkArray = Array.from(links).slice(0, 150);
    const articles = [];

    for (const link of linkArray) {
      const a = await fetchArticleDetails(
        link,
        site.name,
        site.category
      );
      if (a) articles.push(a);
    }

    return articles;
  } catch (err) {
    console.log(`❌ ${site.name}`, err.message);
    return [];
  }
}

// ================= SOURCES =================
const htmlSources = [
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
  console.log("🚀 RUN SCRAPER");

  const results = await Promise.all(
    htmlSources.map((s) => scrapeHtmlSource(s))
  );

  const allArticles = results.flat();

  let totalNew = 0;

  for (const a of allArticles) {
    try {
      const res = await Article.updateOne(
        { link: a.link },
        { $set: a },
        { upsert: true }
      );
      if (res.upsertedCount > 0) totalNew++;
    } catch {}
  }

  console.log(`✅ ${totalNew} new / ${allArticles.length}`);
}

run();
setInterval(run, 15 * 60 * 1000);

// ================= API =================
app.get("/articles", async (req, res) => {
  try {
    const { team, category, source, page = 1 } = req.query;

    const query = {};

    if (team && team !== "ALL") query.team = team;
    if (source) query.source = source;

    if (category && category !== "ALL") {
      query.categories = category.toUpperCase();
    }

    const data = await Article.find(query)
      .sort({ pubDate: -1 })
      .skip((page - 1) * 20)
      .limit(20);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🌍 Server on ${PORT}`));