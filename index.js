const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const TEAMS = [
  "ΑΕΚ","ΟΛΥΜΠΙΑΚΟΣ","ΠΑΝΑΘΗΝΑΙΚΟΣ","ΠΑΟΚ","ΑΡΗΣ",
  "ΟΦΗ","ΒΟΛΟΣ","ΛΕΒΑΔΕΙΑΚΟΣ","ΑΤΡΟΜΗΤΟΣ","ΚΗΦΙΣΙΑ",
  "ΠΑΝΑΙΤΩΛΙΚΟΣ","ΑΕΛ","ΠΑΝΣΕΡΑΙΚΟΣ","ΑΣΤΕΡΑΣ",
  "ΚΑΛΑΜΑΤΑ","ΗΡΑΚΛΗΣ"
];

// ================= HELPERS =================

const cleanTitle = (title) =>
  title.replace(/\s+/g, " ").trim();

const detectTeam = (title) => {
  const t = title.toUpperCase();
  for (let team of TEAMS) {
    if (t.includes(team)) return team;
  }
  return "OTHER";
};

const isValid = (title, image) => {
  if (!title || title.length < 15) return false;
  if (!image || !image.startsWith("http")) return false;

  const bad = [
    "video","live","gallery","photo",
    "βαθμολογία","πρόγραμμα","market","auto","moto"
  ];

  return !bad.some(w => title.toLowerCase().includes(w));
};

// ================= SPORT24 =================

const scrapeSport24 = async () => {
  try {
    const { data } = await axios.get("https://www.sport24.gr/football/");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {
      let title = cleanTitle($(el).find("h2, h3").first().text());

      let link = $(el).find("a").attr("href");

      let image =
        $(el).find("img").attr("src") ||
        $(el).find("img").attr("data-src");

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

// ================= SDNA =================

const scrapeSDNA = async () => {
  try {
    const { data } = await axios.get("https://www.sdna.gr/podosfairo");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {
      let title = cleanTitle($(el).find("h2, h3").text());

      let link = $(el).find("a").attr("href");

      let image =
        $(el).find("img").attr("src") ||
        $(el).find("img").attr("data-src");

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

// ================= GAZZETTA =================

const scrapeGazzetta = async () => {
  try {
    const { data } = await axios.get("https://www.gazzetta.gr/football");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((_, el) => {
      let title = cleanTitle($(el).find("h2, h3").text());

      let link = $(el).find("a").attr("href");

      let image =
        $(el).find("img").attr("src") ||
        $(el).find("img").attr("data-src");

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

// ================= ROUTE /articles =================

app.get("/articles", async (req, res) => {
  try {
    const [s1, s2, s3] = await Promise.all([
      scrapeSport24(),
      scrapeSDNA(),
      scrapeGazzetta()
    ]);

    let all = [...s1, ...s2, ...s3];

    all = dedupe(all);

    all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    res.json(all.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: "FAILED" });
  }
});

// ================= START =================

app.listen(PORT, () => {
  console.log("API RUNNING 🚀 " + PORT);
});