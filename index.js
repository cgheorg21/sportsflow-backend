import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const TEAMS = [
  "ΑΕΚ", "ΟΛΥΜΠΙΑΚΟΣ", "ΠΑΝΑΘΗΝΑΙΚΟΣ", "ΠΑΟΚ", "ΑΡΗΣ",
  "ΟΦΗ", "ΒΟΛΟΣ", "ΛΕΒΑΔΕΙΑΚΟΣ", "ΑΤΡΟΜΗΤΟΣ", "ΚΗΦΙΣΙΑ",
  "ΠΑΝΑΙΤΩΛΙΚΟΣ", "ΑΕΛ", "ΠΑΝΣΕΡΑΙΚΟΣ", "ΑΣΤΕΡΑΣ",
  "ΚΑΛΑΜΑΤΑ", "ΗΡΑΚΛΗΣ"
];

const isValidArticle = (title, image) => {
  if (!title || title.length < 20) return false;
  if (!image || !image.startsWith("http")) return false;

  const badWords = [
    "video",
    "live",
    "stats",
    "βαθμολογία",
    "πρόγραμμα",
    "market"
  ];

  return !badWords.some(w => title.toLowerCase().includes(w));
};

const detectTeam = (title) => {
  for (let team of TEAMS) {
    if (title.includes(team)) return team;
  }
  return "OTHER";
};


// ================= SPORT24 =================
const scrapeSport24 = async () => {
  try {
    const { data } = await axios.get("https://www.sport24.gr/football/");
    const $ = cheerio.load(data);

    const articles = [];

    $("article").each((i, el) => {
      const title = $(el).find("h3").text().trim();
      const link = $(el).find("a").attr("href");
      const image = $(el).find("img").attr("src");

      if (!isValidArticle(title, image)) return;

      articles.push({
        title,
        link,
        image,
        source: "Sport24",
        team: detectTeam(title)
      });
    });

    return articles;
  } catch (err) {
    console.log("Sport24 error");
    return [];
  }
};


// ================= SDNA =================
const scrapeSDNA = async () => {
  try {
    const { data } = await axios.get("https://www.sdna.gr/podosfairo");
    const $ = cheerio.load(data);

    const articles = [];

    $(".node--type-article").each((i, el) => {
      const title = $(el).find("h3").text().trim();
      const link = "https://www.sdna.gr" + $(el).find("a").attr("href");
      const image = $(el).find("img").attr("src");

      if (!isValidArticle(title, image)) return;

      articles.push({
        title,
        link,
        image,
        source: "SDNA",
        team: detectTeam(title)
      });
    });

    return articles;
  } catch (err) {
    console.log("SDNA error");
    return [];
  }
};


// ================= GAZZETTA =================
const scrapeGazzetta = async () => {
  try {
    const { data } = await axios.get("https://www.gazzetta.gr/football");
    const $ = cheerio.load(data);

    const articles = [];

    $(".teaser").each((i, el) => {
      const title = $(el).find("h3").text().trim();
      const link = "https://www.gazzetta.gr" + $(el).find("a").attr("href");
      const image = $(el).find("img").attr("src");

      if (!isValidArticle(title, image)) return;

      articles.push({
        title,
        link,
        image,
        source: "Gazzetta",
        team: detectTeam(title)
      });
    });

    return articles;
  } catch (err) {
    console.log("Gazzetta error");
    return [];
  }
};


// ================= API =================
app.get("/news", async (req, res) => {
  try {
    const [sport24, sdna, gazzetta] = await Promise.all([
      scrapeSport24(),
      scrapeSDNA(),
      scrapeGazzetta()
    ]);

    const allNews = [...sport24, ...sdna, ...gazzetta];

    // remove duplicates
    const unique = Object.values(
      allNews.reduce((acc, item) => {
        acc[item.title] = item;
        return acc;
      }, {})
    );

    res.json(unique.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: "Something went wrong" });
  }
});


// ================= FILTER BY TEAM =================
app.get("/news/:team", async (req, res) => {
  const team = req.params.team;

  try {
    const [sport24, sdna, gazzetta] = await Promise.all([
      scrapeSport24(),
      scrapeSDNA(),
      scrapeGazzetta()
    ]);

    const allNews = [...sport24, ...sdna, ...gazzetta];

    const filtered = allNews.filter(n => n.team === team);

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: "Error filtering" });
  }
});


// ================= START =================
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});