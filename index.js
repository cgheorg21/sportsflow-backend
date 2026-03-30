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
// 🔥 DB
// =======================
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.log(err));

// =======================
// 🔥 MODEL
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
// 🔥 DETECTION
// =======================
const teamKeywords = {
  PAOK:["παοκ","τουμπ","δικεφαλ"],
  OLYMPIACOS:["ολυμπιακ","osfp","πειραι"],
  PANATHINAIKOS:["παναθην","παο"],
  AEK:["αεκ","ενωση"],
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
// 🔥 IMAGE
// =======================
function extractImage(item) {
  if (item["media:content"]?.[0]?.$?.url) return item["media:content"][0].$.url;
  if (item.enclosure?.[0]?.$?.url) return item.enclosure[0].$.url;

  const html = item.description?.[0] || "";
  const match = html.match(/<img.*?src="(.*?)"/);
  return match ? match[1] : "";
}

// =======================
// 🔥 RSS
// =======================
const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" }
];

async function fetchRSS() {
  const responses = await Promise.all(
    FEEDS.map(feed =>
      axios.get(feed.url, { timeout: 5000 })
        .then(r => ({ data: r.data, source: feed.source }))
        .catch(() => null)
    )
  );

  let all = [];

  for (const feed of responses) {
    if (!feed) continue;

    try {
      const result = await xml2js.parseStringPromise(feed.data);
      const items = result?.rss?.channel?.[0]?.item || [];

      const articles = items.map(item => {
        const title = item.title?.[0] || "";
        const link = item.link?.[0] || "";
        const description = item.description?.[0] || "";

        const text = title + description + link;

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
// 🔥 GENERIC SCRAPER
// =======================
async function scrapePage(url, source) {
  try {
    const res = await axios.get(url, { timeout: 5000 });
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
// 🔥 ALL SCRAPERS
// =======================
async function fetchAllSources() {
  const tasks = [
    fetchRSS(),

    scrapePage("https://www.sport24.gr/", "Sport24"),
    scrapePage("https://www.sport24.gr/podosfairo/", "Sport24"),
    scrapePage("https://www.sport24.gr/mpasket/", "Sport24"),

    scrapePage("https://www.sdna.gr/podosfairo", "SDNA"),
    scrapePage("https://www.sdna.gr/mpasket", "SDNA"),

    scrapePage("https://www.gazzetta.gr/football", "Gazzetta"),
    scrapePage("https://www.gazzetta.gr/basketball", "Gazzetta"),

    scrapePage("https://www.to10.gr/", "To10"),
    scrapePage("https://sportday.gr/", "Sportday"),
    scrapePage("https://www.novasports.gr/", "Novasports")
  ];

  const results = await Promise.all(tasks);
  return results.flat();
}

// =======================
// 🔥 SAVE
// =======================
async function saveArticles(list) {
  for (const article of list) {
    try {
      await Article.updateOne(
        { link: article.link },
        { $setOnInsert: article },
        { upsert: true }
      );
    } catch {}
  }
}

// =======================
// 🔥 ENGINE
// =======================
async function fetchAll() {
  console.log("Fetching all sources...");

  const articles = await fetchAllSources();
  await saveArticles(articles);

  console.log("Saved:", articles.length);
}

// =======================
fetchAll();
setInterval(fetchAll, 2 * 60 * 1000);

// =======================
// 🔥 API
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

// =======================
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});