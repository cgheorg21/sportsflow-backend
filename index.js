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
  if (["nba","euroleague","μπασκετ"].some(k => text.includes(k))) return "BASKET";
  if (["ποδοσφ","football","super league","uefa"].some(k => text.includes(k))) return "FOOTBALL";
  return "OTHER";
}

// ================= HELPERS =================
function cleanTitle(title="") {
  if (title.includes("|||")) {
    const parts = title.split("|||").map(p => p.trim());
    return parts.reduce((a,b)=>a.length>b.length?a:b);
  }
  return title.trim();
}

function normalizeUrl(base, link) {
  if (!link) return "";
  return link.startsWith("http") ? link : base + link;
}

function extractImageFromItem(item) {
  return item?.enclosure?.[0]?.$?.url
    || item?.["media:thumbnail"]?.[0]?.$.url
    || "";
}

function buildText(title, desc, link) {
  return (title + " " + (desc||"") + " " + link).toLowerCase();
}

// ================= RSS (ALL) =================
const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://www.sport-fm.gr/rss/news", source: "SportFM" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" }
];

async function fetchRSSAll() {
  const responses = await Promise.all(
    FEEDS.map(f => axios.get(f.url, { timeout: 7000 })
      .then(r => ({ data: r.data, source: f.source }))
      .catch(() => null))
  );

  let all = [];

  for (const feed of responses) {
    if (!feed) continue;
    try {
      const parsed = await xml2js.parseStringPromise(feed.data);
      const items = parsed?.rss?.channel?.[0]?.item || [];

      for (const item of items.slice(0, 80)) {
        let title = cleanTitle(item.title?.[0] || "");
        const desc = item.description?.[0] || "";
        const link = item.link?.[0] || "";

        if (!title || !link) continue;

        const text = buildText(title, desc, link);

        all.push({
          title,
          link,
          image: extractImageFromItem(item),
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

// ================= HTML SCRAPERS (PER SITE) =================

// GAZZETTA
async function scrapeGazzetta() {
  try {
    const res = await axios.get("https://www.gazzetta.gr/football");
    const $ = cheerio.load(res.data);
    let out = [];

    $("article").each((_, el) => {
      const title = $(el).find("h3").text().trim();
      const link = $(el).find("a").attr("href");
      if (!title || !link) return;

      const full = normalizeUrl("https://www.gazzetta.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date(),
        source: "Gazzetta",
        team: detectTeam(text),
        category: "FOOTBALL"
      });
    });

    return out;
  } catch { return []; }
}

// SDNA
async function scrapeSDNA() {
  try {
    const res = await axios.get("https://www.sdna.gr/podosfairo");
    const $ = cheerio.load(res.data);
    let out = [];

    $(".node--type-article").each((_, el) => {
      const title = $(el).find("h2").text().trim();
      const link = $(el).find("a").attr("href");
      if (!title || !link) return;

      const full = normalizeUrl("https://www.sdna.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date(),
        source: "SDNA",
        team: detectTeam(text),
        category: "FOOTBALL"
      });
    });

    return out;
  } catch { return []; }
}

// SPORT24
async function scrapeSport24() {
  try {
    const res = await axios.get("https://www.sport24.gr/");
    const $ = cheerio.load(res.data);
    let out = [];

    $("article").each((_, el) => {
      let title = $(el).find("h2").text().trim() || $(el).find("h3").text().trim();
      const link = $(el).find("a").attr("href");
      if (!title || !link) return;

      const full = normalizeUrl("https://www.sport24.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date(),
        source: "Sport24",
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return out;
  } catch { return []; }
}

// SPORTFM (HTML fallback for extra links)
async function scrapeSportFM() {
  try {
    const res = await axios.get("https://www.sport-fm.gr/");
    const $ = cheerio.load(res.data);
    let out = [];

    $("a").each((_, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr("href");

      if (!title || title.length < 25 || !link) return;
      if (!link.includes("/article/")) return;

      const full = normalizeUrl("https://www.sport-fm.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: "",
        pubDate: new Date(),
        source: "SportFM",
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return out;
  } catch { return []; }
}

// TO10
async function scrapeTo10() {
  try {
    const res = await axios.get("https://www.to10.gr/");
    const $ = cheerio.load(res.data);
    let out = [];

    $("article").each((_, el) => {
      const title = $(el).find("h2").text().trim();
      const link = $(el).find("a").attr("href");
      if (!title || !link) return;

      const full = normalizeUrl("https://www.to10.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date(),
        source: "To10",
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return out;
  } catch { return []; }
}

// SPORTDAY
async function scrapeSportday() {
  try {
    const res = await axios.get("https://sportday.gr/");
    const $ = cheerio.load(res.data);
    let out = [];

    $("article").each((_, el) => {
      const title = $(el).find("h3").text().trim();
      const link = $(el).find("a").attr("href");
      if (!title || !link) return;

      const full = normalizeUrl("https://sportday.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date(),
        source: "Sportday",
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return out;
  } catch { return []; }
}

// ATHLETIKO
async function scrapeAthletiko() {
  try {
    const res = await axios.get("https://www.athletiko.gr/");
    const $ = cheerio.load(res.data);
    let out = [];

    $("article").each((_, el) => {
      const title = $(el).find("h3").text().trim();
      const link = $(el).find("a").attr("href");
      if (!title || !link) return;

      const full = normalizeUrl("https://www.athletiko.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date(),
        source: "Athletiko",
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return out;
  } catch { return []; }
}

// NOVASPORTS
async function scrapeNovasports() {
  try {
    const res = await axios.get("https://www.novasports.gr/");
    const $ = cheerio.load(res.data);
    let out = [];

    $("article").each((_, el) => {
      const title = $(el).find("h3").text().trim();
      const link = $(el).find("a").attr("href");
      if (!title || !link) return;

      const full = normalizeUrl("https://www.novasports.gr", link);
      const text = title + full;

      out.push({
        title,
        link: full,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date(),
        source: "Novasports",
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return out;
  } catch { return []; }
}

// ================= ENGINE =================
async function run() {
  console.log("Fetching...");

  const results = await Promise.all([
    fetchRSSAll(),
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
  if (category) query.category = category;
  if (source) query.source = source;

  const data = await Article.find(query)
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(data);
});

app.listen(PORT, () => console.log("Server running on " + PORT));