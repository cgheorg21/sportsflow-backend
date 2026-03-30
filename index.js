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
  "ΑΡΗΣ": ["αρη"],
  "ΟΦΗ": ["οφη"],
  "ΒΟΛΟΣ": ["βολο"],
  "ΑΤΡΟΜΗΤΟΣ": ["ατρομη"],
  "ΛΕΒΑΔΕΙΑΚΟΣ": ["λεβαδ"],
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
  if (["μπασκετ","nba","euroleague"].some(k => text.includes(k))) return "BASKET";
  if (["ποδοσφ","super league","uefa"].some(k => text.includes(k))) return "FOOTBALL";
  return "OTHER";
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

// ================= LINK SCRAPER BASE =================
async function scrapeLinks(url, base, match, source) {
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    let links = new Set();

    $("a").each((_, el) => {
      const href = $(el).attr("href");

      if (href && match.some(m => href.includes(m))) {
        links.add(href.startsWith("http") ? href : base + href);
      }
    });

    const articles = [];

    for (const link of Array.from(links).slice(0, 50)) {
      const article = await fetchArticle(link, source);
      if (article && article.title.length > 20) {
        articles.push(article);
      }
    }

    return articles;

  } catch {
    return [];
  }
}

// ================= SCRAPERS =================
const scrapeGazzetta = () =>
  scrapeLinks(
    "https://www.gazzetta.gr/football",
    "https://www.gazzetta.gr",
    ["/football/", "/basketball/"],
    "Gazzetta"
  );

const scrapeSDNA = () =>
  scrapeLinks(
    "https://www.sdna.gr/podosfairo",
    "https://www.sdna.gr",
    ["/podosfairo/", "/mpasket/"],
    "SDNA"
  );

const scrapeSport24 = () =>
  scrapeLinks(
    "https://www.sport24.gr/",
    "https://www.sport24.gr",
    ["/football/", "/basket/"],
    "Sport24"
  );

const scrapeSportFM = () =>
  scrapeLinks(
    "https://www.sport-fm.gr/",
    "https://www.sport-fm.gr",
    ["/article/"],
    "SportFM"
  );

const scrapeTo10 = () =>
  scrapeLinks(
    "https://www.to10.gr/",
    "https://www.to10.gr",
    ["/category/podosfero/", "/category/basket/"],
    "To10"
  );

const scrapeSportday = () =>
  scrapeLinks(
    "https://sportday.gr/",
    "https://sportday.gr",
    ["/podosfairo/", "/basket/"],
    "Sportday"
  );

const scrapeAthletiko = () =>
  scrapeLinks(
    "https://www.athletiko.gr/",
    "https://www.athletiko.gr",
    ["/podosfairo/", "/mpasket/"],
    "Athletiko"
  );

const scrapeNovasports = () =>
  scrapeLinks(
    "https://www.novasports.gr/",
    "https://www.novasports.gr",
    ["/sport/podosfairo/news/", "/sport/mpasket/news/"],
    "Novasports"
  );

// ================= ENGINE =================
async function run() {
  console.log("Fetching FULL...");

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
  if (category) query.category = category;
  if (source) query.source = source;

  const data = await Article.find(query)
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server running");
});