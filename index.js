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
  .catch(err => console.log(err));

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
  { url: "https://www.sport24.gr/rss.xml", source: "Sport24" },
  { url: "https://www.sdna.gr/rss/all", source: "SDNA" },
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.to10.gr/feed/", source: "To10" },
  { url: "https://sportday.gr/feed/", source: "Sportday" },
  { url: "https://www.onsports.gr/rss.xml", source: "Onsports" },
  { url: "https://www.novasports.gr/rss.xml", source: "Novasports" },
  { url: "https://www.athletiko.gr/feed/", source: "Athletiko" }
];

// ================= TEAM DETECTION =================
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

  if (
    t.includes("nba") ||
    t.includes("euroleague") ||
    t.includes("basket") ||
    t.includes("μπάσκετ")
  ) return "BASKET";

  if (
    t.includes("football") ||
    t.includes("ποδοσφ") ||
    t.includes("super league") ||
    t.includes("champions league")
  ) return "FOOTBALL";

  return "OTHER";
};

// ================= IMAGE =================
const extractImage = (item) => {
  return (
    item["media:content"]?.[0]?.$.url ||
    item["media:thumbnail"]?.[0]?.$.url ||
    item.enclosure?.[0]?.$.url ||
    item["content:encoded"]?.[0]?.match(/<img.*?src="(.*?)"/)?.[1] ||
    ""
  );
};

// ================= FILTER =================
const isValid = (title) => {
  if (!title || title.length < 20) return false;

  const bad = [
    "lifestyle",
    "viral",
    "gossip",
    "μόδα",
    "ζώδια"
  ];

  return !bad.some(w => title.toLowerCase().includes(w));
};

// ================= FETCH =================
const fetchFeed = async (feed) => {
  try {
    const { data } = await axios.get(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const parsed = await xml2js.parseStringPromise(data);
    const items = parsed.rss.channel[0].item;

    return items.map(item => {
      const title = item.title?.[0] || "";
      const link = item.link?.[0] || "";

      if (!isValid(title)) return null;

      const sport = detectSport(title + link);
      const team = detectTeam(title);

      const categories = [
        "ALL",
        sport !== "OTHER" ? sport : null,
        team !== "OTHER" ? team : null,
        feed.source
      ].filter(Boolean);

      return {
        title,
        link,
        image: extractImage(item),
        source: feed.source,
        sport,
        team,
        categories,
        pubDate: new Date(item.pubDate?.[0] || Date.now())
      };
    }).filter(Boolean);

  } catch (err) {
    console.log(feed.source, "ERROR");
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

    // CACHE FIRST
    const cached = await Article.find().sort({ pubDate: -1 }).limit(100);
    if (cached.length > 30) return res.json(cached);

    // FETCH ALL
    const results = await Promise.all(FEEDS.map(fetchFeed));

    let all = results.flat();
    all = dedupe(all);

    // SAVE
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