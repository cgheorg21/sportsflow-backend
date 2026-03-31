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

const ArticleSchema = new mongoose.Schema({
  title: String,
  link: String,
  image: String,
  source: String,
  sport: String,
  team: String,
  categories: [String],
  pubDate: Date
});

const Article = mongoose.model("Article", ArticleSchema);

// ================= FEEDS =================
const FEEDS = [
  { url: "https://www.sport24.gr/feed/", source: "Sport24" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.to10.gr/feed/", source: "To10" },
  { url: "https://sportday.gr/feed/", source: "Sportday" },
  { url: "https://www.onsports.gr/rss", source: "Onsports" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" },
  { url: "https://www.athletiko.gr/feed/", source: "Athletiko" }
];

// ================= TEAM DETECTION =================
const teamKeywords = {
  "ΟΛΥΜΠΙΑΚΟΣ": ["ολυμπιακ","osfp"],
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": ["παναθην","παο"],
  "ΑΕΚ": ["αεκ"],
  "ΠΑΟΚ": ["παοκ"],
  "ΑΡΗΣ": ["αρη"],
};

const detectTeam = (text) => {
  const t = text.toLowerCase();
  for (let team in teamKeywords) {
    if (teamKeywords[team].some(k => t.includes(k))) {
      return team;
    }
  }
  return "OTHER";
};

// ================= SPORT DETECTION =================
const detectSport = (text) => {
  const t = text.toLowerCase();

  if (t.includes("basket")) return "BASKET";
  if (t.includes("nba")) return "BASKET";
  if (t.includes("euroleague")) return "BASKET";

  return "FOOTBALL"; // default
};

// ================= IMAGE =================
const extractImage = (item) => {
  return (
    item["media:content"]?.[0]?.$.url ||
    item.enclosure?.[0]?.$.url ||
    ""
  );
};

// ================= CATEGORIES =================
const buildCategories = (team, source, sport) => {
  const categories = ["ALL"];

  if (sport) categories.push(sport);
  if (team !== "OTHER") categories.push(team);
  if (source) categories.push(source);

  return categories;
};

// ================= FETCH =================
const fetchRSS = async (feed) => {
  try {
    const { data } = await axios.get(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const parsed = await xml2js.parseStringPromise(data);
    const items = parsed.rss.channel[0].item;

    return items.map(item => {

      const title = item.title?.[0] || "";
      const link = item.link?.[0] || "";
      const pubDate = new Date(item.pubDate?.[0] || Date.now());
      const image = extractImage(item);

      const text = title + " " + link;

      const sport = detectSport(text);
      const team = detectTeam(text);

      return {
        title,
        link,
        image,
        source: feed.source,
        sport,
        team,
        categories: buildCategories(team, feed.source, sport),
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
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {

    // SCRAPE ALL
    const results = await Promise.all(FEEDS.map(fetchRSS));
    let all = results.flat();

    all = dedupe(all);

    // SAVE DB
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