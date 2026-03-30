const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

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

// ================= DETECTION =================
function detectCategory(text) {
  text = text.toLowerCase();
  if (["nba","euroleague","μπασκετ"].some(k => text.includes(k))) return "basket";
  if (["ποδοσφ","football","super league"].some(k => text.includes(k))) return "football";
  return "other";
}

// ================= RSS =================
const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" },
  { url: "https://www.sport-fm.gr/rss/news", source: "SportFM" }
];

async function fetchRSS() {
  const responses = await Promise.all(
    FEEDS.map(f => axios.get(f.url).then(r => ({data:r.data, source:f.source})).catch(()=>null))
  );

  let all = [];

  for (const feed of responses) {
    if (!feed) continue;

    const result = await xml2js.parseStringPromise(feed.data);
    const items = result?.rss?.channel?.[0]?.item || [];

    items.forEach(item => {
      const title = item.title?.[0] || "";
      const link = item.link?.[0] || "";

      all.push({
        title,
        link,
        image: item.enclosure?.[0]?.$?.url || "",
        pubDate: new Date(item.pubDate?.[0] || Date.now()),
        source: feed.source,
        category: detectCategory(title)
      });
    });
  }

  return all;
}

// ================= SPORT24 =================
async function fetchSport24() {
  const res = await axios.get("https://www.sport24.gr/");
  const $ = cheerio.load(res.data);

  let articles = [];

  $(".article").each((_, el) => {
    const title = $(el).find("h3").text().trim();
    const link = $(el).find("a").attr("href");

    if (!title || !link) return;

    articles.push({
      title,
      link,
      image: $(el).find("img").attr("src") || "",
      pubDate: new Date(),
      source: "Sport24",
      category: detectCategory(title)
    });
  });

  return articles;
}

// ================= SDNA =================
async function fetchSDNA() {
  const res = await axios.get("https://www.sdna.gr/podosfairo");
  const $ = cheerio.load(res.data);

  let articles = [];

  $(".node--type-article").each((_, el) => {
    const title = $(el).find("h2").text().trim();
    const link = $(el).find("a").attr("href");

    if (!title) return;

    articles.push({
      title,
      link: "https://www.sdna.gr" + link,
      image: $(el).find("img").attr("src") || "",
      pubDate: new Date(),
      source: "SDNA",
      category: "football"
    });
  });

  return articles;
}

// ================= GAZZETTA =================
async function fetchGazzetta() {
  const res = await axios.get("https://www.gazzetta.gr/football");
  const $ = cheerio.load(res.data);

  let articles = [];

  $("article").each((_, el) => {
    const title = $(el).find("h3").text().trim();
    const link = $(el).find("a").attr("href");

    if (!title) return;

    articles.push({
      title,
      link,
      image: $(el).find("img").attr("src") || "",
      pubDate: new Date(),
      source: "Gazzetta",
      category: "football"
    });
  });

  return articles;
}

// ================= FETCH ALL =================
async function fetchAll() {
  console.log("Fetching...");

  const results = await Promise.all([
    fetchRSS(),
    fetchSport24(),
    fetchSDNA(),
    fetchGazzetta()
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

fetchAll();
setInterval(fetchAll, 120000);

// ================= API =================
app.get("/articles", async (req, res) => {
  const { page = 1 } = req.query;

  const data = await Article.find()
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server running");
});