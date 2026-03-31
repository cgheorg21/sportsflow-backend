const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= AXIOS FIX =================
const axiosInstance = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "en-US,en;q=0.9"
  }
});

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB connected"))
.catch(err => console.log("Mongo error:", err));

// ================= SCHEMA =================
const ArticleSchema = new mongoose.Schema({
  title: String,
  link: String,
  image: String,
  source: String,
  team: String,
  categories: [String],
  pubDate: Date
});

const Article = mongoose.model("Article", ArticleSchema);

// ================= TEAMS =================
const teamKeywords = {
  "ΟΛΥΜΠΙΑΚΟΣ": ["ολυμπιακ","osfp","πειραι"],
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": ["παναθην","παο","τριφυλλ"],
  "ΑΕΚ": ["αεκ","ενωση"],
  "ΠΑΟΚ": ["παοκ","τουμπα"],
  "ΑΡΗΣ": ["αρη","aris"],
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

const detectTeam = (title) => {
  const t = title.toLowerCase();

  for (let team in teamKeywords) {
    if (teamKeywords[team].some(k => t.includes(k))) {
      return team;
    }
  }

  return "OTHER";
};

// ================= HELPERS =================
const cleanTitle = (t) =>
  t.replace(/\s+/g, " ").replace(/\n/g, "").trim();

const getImage = (el, $) => {
  return (
    $(el).find("img").attr("src") ||
    $(el).find("img").attr("data-src") ||
    $(el).find("img").attr("srcset")?.split(" ")[0] ||
    ""
  );
};

const isValid = (title, image) => {
  if (!title || title.length < 10) return false;
  if (!image || !image.startsWith("http")) return false;

  const bad = ["video","live","gallery","photo"];
  return !bad.some(w => title.toLowerCase().includes(w));
};

const buildCategories = (team, source) => {
  const cats = ["ALL", "FOOTBALL"];

  if (team !== "OTHER") cats.push(team);
  if (source) cats.push(source);

  return cats;
};

// ================= SCRAPERS =================

// SPORT24
const scrapeSport24 = async () => {
  try {
    const { data } = await axiosInstance.get("https://www.sport24.gr/football/");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {

      let title = cleanTitle($(el).find("h3").first().text());
      let link = $(el).find("a").attr("href");
      let image = getImage(el, $);

      if (!title || !link || !image) return;

      if (!link.startsWith("http")) {
        link = "https://www.sport24.gr" + link;
      }

      if (!isValid(title, image)) return;

      const team = detectTeam(title);

      articles.push({
        title,
        link,
        image,
        source: "Sport24",
        team,
        categories: buildCategories(team, "Sport24"),
        pubDate: new Date()
      });
    });

    return articles;

  } catch (err) {
    console.log("Sport24 ERROR:", err.message);
    return [];
  }
};

// SDNA
const scrapeSDNA = async () => {
  try {
    const { data } = await axiosInstance.get("https://www.sdna.gr/podosfairo");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {

      let title = cleanTitle($(el).find("h3").text());
      let link = $(el).find("a").attr("href");
      let image = getImage(el, $);

      if (!title || !link || !image) return;

      if (!link.startsWith("http")) {
        link = "https://www.sdna.gr" + link;
      }

      if (!isValid(title, image)) return;

      const team = detectTeam(title);

      articles.push({
        title,
        link,
        image,
        source: "SDNA",
        team,
        categories: buildCategories(team, "SDNA"),
        pubDate: new Date()
      });
    });

    return articles;

  } catch (err) {
    console.log("SDNA ERROR:", err.message);
    return [];
  }
};

// GAZZETTA
const scrapeGazzetta = async () => {
  try {
    const { data } = await axiosInstance.get("https://www.gazzetta.gr/football");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {

      let title = cleanTitle($(el).find("h3").text());
      let link = $(el).find("a").attr("href");
      let image = getImage(el, $);

      if (!title || !link || !image) return;

      if (!link.startsWith("http")) {
        link = "https://www.gazzetta.gr" + link;
      }

      if (!isValid(title, image)) return;

      const team = detectTeam(title);

      articles.push({
        title,
        link,
        image,
        source: "Gazzetta",
        team,
        categories: buildCategories(team, "Gazzetta"),
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
    const key = a.title + a.link;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {

    const cached = await Article.find()
      .sort({ pubDate: -1 })
      .limit(50);

    const [s1, s2, s3] = await Promise.all([
      scrapeSport24(),
      scrapeSDNA(),
      scrapeGazzetta()
    ]);

    console.log("Sport24:", s1.length);
    console.log("SDNA:", s2.length);
    console.log("Gazzetta:", s3.length);

    let all = [...s1, ...s2, ...s3];
    all = dedupe(all);

    // ❗ ΜΗΝ ΣΒΗΝΕΙΣ DB αν fail
    if (all.length === 0) {
      console.log("SCRAPING FAILED - RETURN CACHE");
      return res.json(cached);
    }

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