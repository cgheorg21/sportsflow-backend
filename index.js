const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected"))
.catch(err => console.log("Mongo error:", err));

const ArticleSchema = new mongoose.Schema({
  title: String,
  link: String,
  image: String,
  source: String,
  team: String,
  pubDate: Date
});

const Article = mongoose.model("Article", ArticleSchema);

// ================= TEAMS =================
const TEAMS = [
  "ΑΕΚ","ΟΛΥΜΠΙΑΚΟΣ","ΠΑΝΑΘΗΝΑΙΚΟΣ","ΠΑΟΚ","ΑΡΗΣ",
  "ΟΦΗ","ΒΟΛΟΣ","ΛΕΒΑΔΕΙΑΚΟΣ","ΑΤΡΟΜΗΤΟΣ","ΚΗΦΙΣΙΑ",
  "ΠΑΝΑΙΤΩΛΙΚΟΣ","ΑΕΛ","ΠΑΝΣΕΡΑΙΚΟΣ","ΑΣΤΕΡΑΣ",
  "ΚΑΛΑΜΑΤΑ","ΗΡΑΚΛΗΣ"
];

const detectTeam = (title) => {
  const t = title.toUpperCase();
  for (let team of TEAMS) {
    if (t.includes(team)) return team;
  }
  return "OTHER";
};

const cleanTitle = (t) => t.replace(/\s+/g, " ").trim();

const isValid = (title, image) => {
  if (!title || title.length < 15) return false;
  if (!image || !image.startsWith("http")) return false;

  const bad = ["video","live","gallery","photo","βαθμολογία","πρόγραμμα","market"];
  return !bad.some(w => title.toLowerCase().includes(w));
};

// ================= SCRAPERS =================

const scrapeSport24 = async () => {
  try {
    const { data } = await axios.get("https://www.sport24.gr/football/");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {
      let title = cleanTitle($(el).find("h2, h3").first().text());
      let link = $(el).find("a").attr("href");
      let image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src");

      if (!title || !link || !image) return;

      if (!link.startsWith("http")) {
        link = "https://www.sport24.gr" + link;
      }

      if (!isValid(title, image)) return;

      articles.push({
        title,
        link,
        image,
        source: "Sport24",
        team: detectTeam(title),
        pubDate: new Date()
      });
    });

    return articles;
  } catch (err) {
    console.log("Sport24 ERROR:", err.message);
    return [];
  }
};

const scrapeSDNA = async () => {
  try {
    const { data } = await axios.get("https://www.sdna.gr/podosfairo");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {
      let title = cleanTitle($(el).find("h2, h3").text());
      let link = $(el).find("a").attr("href");
      let image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src");

      if (!title || !link || !image) return;

      if (!link.startsWith("http")) {
        link = "https://www.sdna.gr" + link;
      }

      if (!isValid(title, image)) return;

      articles.push({
        title,
        link,
        image,
        source: "SDNA",
        team: detectTeam(title),
        pubDate: new Date()
      });
    });

    return articles;
  } catch (err) {
    console.log("SDNA ERROR:", err.message);
    return [];
  }
};

const scrapeGazzetta = async () => {
  try {
    const { data } = await axios.get("https://www.gazzetta.gr/football");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {
      let title = cleanTitle($(el).find("h2, h3").text());
      let link = $(el).find("a").attr("href");
      let image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src");

      if (!title || !link || !image) return;

      if (!link.startsWith("http")) {
        link = "https://www.gazzetta.gr" + link;
      }

      if (!isValid(title, image)) return;

      articles.push({
        title,
        link,
        image,
        source: "Gazzetta",
        team: detectTeam(title),
        pubDate: new Date()
      });
    });

    return articles;
  } catch (err) {
    console.log("Gazzetta ERROR:", err.message);
    return [];
  }
};

// ================= DEDUPE =================
const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter(a => {
    if (seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  });
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {
    // 1. DB FIRST
    const cached = await Article.find().sort({ pubDate: -1 }).limit(50);

    if (cached.length > 20) {
      return res.json(cached);
    }

    // 2. SCRAPE
    const [s1, s2, s3] = await Promise.all([
      scrapeSport24(),
      scrapeSDNA(),
      scrapeGazzetta()
    ]);

    let all = [...s1, ...s2, ...s3];
    all = dedupe(all);

    // 3. SAVE DB
    await Article.deleteMany({});
    await Article.insertMany(all);

    res.json(all);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "FAILED" });
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log("RUNNING ON " + PORT);
});