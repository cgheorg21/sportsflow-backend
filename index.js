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
  PAOK: ["παοκ"],
  OLYMPIACOS: ["ολυμπιακ"],
  PANATHINAIKOS: ["παναθην"],
  AEK: ["αεκ"],
  ARIS: ["αρη"]
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

  if (["ποδοσφ","football","super league","uefa"].some(k => text.includes(k)))
    return "FOOTBALL";

  return "ALL";
}

// ================= IMAGE =================
function extractImage(item) {
  const description = item.description?.[0] || "";
  const content = item["content:encoded"]?.[0] || "";

  if (item["media:content"]?.[0]?.$?.url)
    return item["media:content"][0].$.url;

  if (item.enclosure?.[0]?.$?.url)
    return item.enclosure[0].$.url;

  const matchContent = content.match(/<img.*?src="(.*?)"/);
  if (matchContent) return matchContent[1];

  const matchDesc = description.match(/<img.*?src="(.*?)"/);
  if (matchDesc) return matchDesc[1];

  return "";
}

// ================= FETCH ARTICLE PAGE =================
async function fetchArticlePage(url) {
  try {
    const res = await axios.get(url, { timeout: 5000 });
    const $ = cheerio.load(res.data);

    return (
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      ""
    );
  } catch {
    return "";
  }
}

// ================= RSS =================
const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" }
];

// ================= FETCH RSS =================
async function fetchRSS() {
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

      for (const item of items.slice(0, 60)) {
        const title = item.title?.[0] || "";
        const link = item.link?.[0] || "";
        const text = title + link;

        let image = extractImage(item);

        if (!image) {
          image = await fetchArticlePage(link);
        }

        all.push({
          title,
          link,
          image,
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

// ================= SPORT24 =================
async function fetchSport24() {
  try {
    const res = await axios.get("https://www.sport24.gr/");
    const $ = cheerio.load(res.data);

    let articles = [];

    $("article").each((_, el) => {
      const link = $(el).find("a").attr("href");
      const title = $(el).find("h2, h3").first().text().trim();

      if (!title || !link) return;

      articles.push({
        title,
        link: link.startsWith("http") ? link : "https://www.sport24.gr" + link,
        image: "",
        pubDate: new Date(),
        source: "Sport24"
      });
    });

    return articles.slice(0, 60);

  } catch {
    return [];
  }
}

// ================= SPORTFM =================
async function fetchSportFM() {
  try {
    const res = await axios.get("https://www.sport-fm.gr/rss/news");
    const parsed = await xml2js.parseStringPromise(res.data);
    const items = parsed?.rss?.channel?.[0]?.item || [];

    let articles = [];

    for (const item of items.slice(0, 50)) {
      const link = item.link?.[0];
      const title = item.title?.[0];

      let image =
        item["media:thumbnail"]?.[0]?.$.url ||
        item.enclosure?.[0]?.$.url ||
        "";

      if (!image) {
        image = await fetchArticlePage(link);
      }

      articles.push({
        title,
        link,
        image,
        pubDate: new Date(),
        source: "SportFM"
      });
    }

    return articles;

  } catch {
    return [];
  }
}

// ================= ENGINE =================
async function run() {
  console.log("Fetching...");

  const [rss, sport24, sportfm] = await Promise.all([
    fetchRSS(),
    fetchSport24(),
    fetchSportFM()
  ]);

  let all = [...rss, ...sport24, ...sportfm];

  // CLEAN
  all = all.filter(a =>
    a.title && a.title.length > 20 && a.link && a.link.startsWith("http")
  );

  // DEDUP
  const map = new Map();
  all.forEach(a => {
    if (!map.has(a.link)) map.set(a.link, a);
  });

  all = Array.from(map.values());

  // SAVE
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
  const { team, category, source } = req.query;

  const query = {};

  if (team) query.team = team;
  if (source) query.source = source;

  if (category && category !== "ALL") {
    query.category = category;
  }

  const articles = await Article.find(query)
    .sort({ pubDate: -1 })
    .limit(300);

  res.json(articles);
});

app.listen(PORT, () => {
  console.log("Server running");
});