const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");
const xml2js = require("xml2js");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

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
  sport: String,
  categories: [String],
  pubDate: Date
});

const Article = mongoose.model("Article", ArticleSchema);

// ================= FEEDS =================
const FEEDS = [

  // ===== FOOTBALL =====
  { url: "https://www.sport24.gr/feed/football/", source: "Sport24", sport: "FOOTBALL" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA", sport: "FOOTBALL" },
  { url: "https://www.gazzetta.gr/rss/football", source: "Gazzetta", sport: "FOOTBALL" },
  { url: "https://www.sport-fm.gr/rss/podosfairo", source: "SportFM", sport: "FOOTBALL" },
  { url: "https://www.novasports.gr/feed/category/podosfairo/", source: "Novasports", sport: "FOOTBALL" },
  { url: "https://www.to10.gr/feed/", source: "To10", sport: "FOOTBALL" },
  { url: "https://www.contra.gr/feed/", source: "Contra", sport: "FOOTBALL" },

  // ===== BASKET =====
  { url: "https://www.sport24.gr/feed/basket/", source: "Sport24", sport: "BASKET" },
  { url: "https://www.gazzetta.gr/rss/basketball", source: "Gazzetta", sport: "BASKET" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA", sport: "BASKET" },
  { url: "https://www.sport-fm.gr/rss/mpasket", source: "SportFM", sport: "BASKET" }
];

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

// ================= CATEGORY BUILDER =================
const buildCategories = (team, source, sport) => {
  const cats = ["ALL", sport];

  if (team !== "OTHER") cats.push(team);
  if (source) cats.push(source);

  return cats;
};

// ================= IMAGE FROM DESCRIPTION =================
const extractImage = (item) => {
  if (item.enclosure && item.enclosure[0].$.url) {
    return item.enclosure[0].$.url;
  }

  if (item.description) {
    const match = item.description[0].match(/<img.*?src="(.*?)"/);
    if (match) return match[1];
  }

  return "";
};

// ================= FETCH RSS =================
const fetchRSS = async (feed) => {
  try {
    const { data } = await axios.get(feed.url);
    const parsed = await xml2js.parseStringPromise(data);

    const items = parsed.rss.channel[0].item;

    return items.map(item => {

      const title = item.title[0];
      const link = item.link[0];
      const pubDate = new Date(item.pubDate[0]);
      const image = extractImage(item);

      const team = detectTeam(title);

      return {
        title,
        link,
        image,
        source: feed.source,
        sport: feed.sport,
        team,
        categories: buildCategories(team, feed.source, feed.sport),
        pubDate
      };
    });

  } catch (err) {
    console.log(feed.source, "ERROR:", err.message);
    return [];
  }
};

// ================= DEDUPE =================
const dedupe = (arr) => {
  const seen = new Set();

  return arr.filter(a => {
    const key = a.title;
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
      .limit(150);

    const results = await Promise.all(FEEDS.map(fetchRSS));

    let all = results.flat();
    all = dedupe(all);

    console.log("TOTAL:", all.length);

    if (all.length === 0) {
      console.log("RSS FAILED");
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