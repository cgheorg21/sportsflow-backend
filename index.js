const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= TEAMS =================
const teamKeywords = {
  "ΟΛΥΜΠΙΑΚΟΣ": ["ολυμπιακ","osfp"],
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": ["παναθην","παο"],
  "ΑΕΚ": ["αεκ"],
  "ΠΑΟΚ": ["παοκ"],
  "ΑΡΗΣ": ["αρη"],
  "ΟΦΗ": ["οφη"],
  "ΒΟΛΟΣ": ["βολο"],
  "ΑΤΡΟΜΗΤΟΣ": ["ατρομη"],
  "ΠΑΝΑΙΤΩΛΙΚΟΣ": ["παναιτωλ"],
  "ΑΣΤΕΡΑΣ": ["αστερα"],
  "ΠΑΝΣΕΡΑΙΚΟΣ": ["πανσερ"],
  "ΑΕΛ": ["αελ"],
  "ΚΑΛΑΜΑΤΑ": ["καλαματ"],
  "ΗΡΑΚΛΗΣ": ["ηρακλ"]
};

const detectTeam = (title) => {
  const t = title.toLowerCase();
  for (let team in teamKeywords) {
    if (teamKeywords[team].some(k => t.includes(k))) return team;
  }
  return "OTHER";
};

// ================= SPORT DETECTION =================
const detectSport = (title, link) => {
  const text = (title + " " + link).toLowerCase();

  if (
    text.includes("basket") ||
    text.includes("nba") ||
    text.includes("euroleague") ||
    text.includes("μπάσκετ")
  ) return "BASKET";

  if (
    text.includes("podosfero") ||
    text.includes("football") ||
    text.includes("superleague") ||
    text.includes("champions") ||
    text.includes("ποδοσφ")
  ) return "FOOTBALL";

  return "OTHER";
};

// ================= FILTER =================
const isValid = (title) => {
  const t = title.toLowerCase();

  const bad = [
    "lifestyle","gossip","viral","video","tv",
    "έγκλημα","σοκ","τροχαίο","πολιτική"
  ];

  return !bad.some(w => t.includes(w));
};

// ================= IMAGE =================
const extractImage = (item) => {
  return (
    item["media:content"]?.[0]?.$.url ||
    item["media:thumbnail"]?.[0]?.$.url ||
    item.enclosure?.[0]?.$.url ||
    item.description?.[0]?.match(/<img.*?src="(.*?)"/)?.[1] ||
    ""
  );
};

// ================= RSS SOURCES =================
const FEEDS = [
  // FOOTBALL
  { url: "https://www.sport24.gr/rss/podosfairo", source: "Sport24" },
  { url: "https://www.sdna.gr/rss/podosfairo", source: "SDNA" },
  { url: "https://www.gazzetta.gr/football/rss", source: "Gazzetta" },
  { url: "https://www.to10.gr/category/podosfero/feed/", source: "To10" },

  // BASKET
  { url: "https://www.sport24.gr/rss/basket", source: "Sport24" },
  { url: "https://www.sdna.gr/rss/basket", source: "SDNA" },
  { url: "https://www.gazzetta.gr/basketball/rss", source: "Gazzetta" },
  { url: "https://www.to10.gr/category/basket/feed/", source: "To10" },

  // GENERAL
  { url: "https://sportday.gr/feed/", source: "Sportday" },
  { url: "https://www.onsports.gr/rss", source: "Onsports" },
  { url: "https://www.novasports.gr/rss.xml", source: "Novasports" },
  { url: "https://www.athletiko.gr/feed/", source: "Athletiko" }
];

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
      const image = extractImage(item);

      if (!isValid(title)) return null;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      let categories = ["ALL", feed.source];

      if (sport !== "OTHER") categories.push(sport);
      if (team !== "OTHER") categories.push(team);

      return {
        title,
        link,
        image,
        source: feed.source,
        sport,
        team,
        categories,
        pubDate: new Date(item.pubDate?.[0] || Date.now())
      };
    }).filter(Boolean);

  } catch (err) {
    console.log(feed.source + " ERROR");
    return [];
  }
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {

  const results = await Promise.all(FEEDS.map(fetchFeed));
  let all = results.flat();

  // dedupe
  const seen = new Set();
  all = all.filter(a => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  // sort newest first
  all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  res.json(all);
});

// ================= START =================
app.listen(PORT, () => {
  console.log("RUNNING ON " + PORT);
});