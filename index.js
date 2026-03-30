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
//  DB
// =======================
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 10000
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.log(err));

// =======================
//  MODEL
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
//  KEYWORDS
// =======================
const teamKeywords = {
  PAOK: ["παοκ","τουμπ","δικεφαλ","ασπρομαυρ"],
  OLYMPIACOS: ["ολυμπιακ","osfp","πειραι","ερυθρολευκ"],
  PANATHINAIKOS: ["παναθην","παο","τριφυλλ"],
  AEK: ["αεκ","ενωση"],
  ARIS: ["αρη","κιτριν"],
  OFI: ["οφη"],
  VOLOS: ["βολο"],
  LEVADIAKOS: ["λεβαδ"],
  ATROMITOS: ["ατρομη"],
  KIFISIA: ["κηφισ"],
  PANETOLIKOS: ["παναιτωλ"],
  AEL: ["αελ","λαρισ"],
  PANSERRAIKOS: ["πανσερ"],
  ASTERAS: ["αστερα"],
  KALAMATA: ["καλαματ"],
  IRAKLIS: ["ηρακλ"]
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

  if (["nba","euroleague","μπασκετ","fiba"].some(k => text.includes(k))) return "basket";
  if (["ποδοσφ","football","uefa","champions league","super league"].some(k => text.includes(k))) return "football";

  return "other";
}

// =======================
//  IMAGE
// =======================
function extractImage(item) {
  if (item["media:content"]?.[0]?.$?.url) return item["media:content"][0].$.url;
  if (item.enclosure?.[0]?.$?.url) return item.enclosure[0].$.url;

  const html = item.description?.[0] || "";
  const match = html.match(/<img.*?src="(.*?)"/);
  return match ? match[1] : "";
}

// =======================
//  RSS
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
//  SPORT24 DEEP
// =======================
async function fetchSport24() {
  const urls = [
    "https://www.sport24.gr/",
    "https://www.sport24.gr/podosfairo/",
    "https://www.sport24.gr/mpasket/"
  ];

  let articles = [];

  for (const url of urls) {
    try {
      const res = await axios.get(url);
      const $ = cheerio.load(res.data);

      $("article").each((_, el) => {
        const link = $(el).find("a").attr("href");
        const title = $(el).find("h2, h3").first().text().trim();

        if (!title || title.length < 20) return;

        const text = title + link;

        articles.push({
          title,
          link: link?.startsWith("http") ? link : `https://www.sport24.gr${link}`,
          image: $(el).find("img").attr("src") || "",
          pubDate: new Date(),
          source: "Sport24",
          team: detectTeam(text),
          category: detectCategory(text)
        });
      });

    } catch {}
  }

  return articles;
}

// =======================
//  SAVE (NO DUPLICATES)
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
//  MAIN ENGINE
// =======================
async function fetchAll() {
  console.log("Fetching...");

  const rss = await fetchRSS();
  const sport24 = await fetchSport24();

  const all = [...rss, ...sport24];

  await saveArticles(all);

  console.log("Saved:", all.length);
}

// =======================
fetchAll();
setInterval(fetchAll, 2 * 60 * 1000);

// =======================
//  API (REAL FILTERING)
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