const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const mongoose = require("mongoose");
const Parser = require("rss-parser");
const parser = new Parser();

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
  pubDate: Date
});

const Article = mongoose.model("Article", ArticleSchema);

// ================= HELPERS =================
const getHTML = async (url) => {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });
  return data;
};

const getRSS = async (url) => {
  const { data } = await axios.get(url);
  return cheerio.load(data, { xmlMode: true });
};

const clean = (t) => t?.replace(/\s+/g, " ").trim();

// ================= SCRAPERS =================

// ✅ SPORT24 (SCRAPER)
const scrapeSport24 = async () => {
  try {
    const html = await getHTML("https://www.sport24.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h2, h3").text());
      let link = $(el).find("a").attr("href");

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.sport24.gr" + link;
      }

      articles.push({
        title,
        link,
        source: "Sport24",
        pubDate: new Date()
      });
    });

    console.log("Sport24:", articles.length);
    return articles;

  } catch (e) {
    console.log("Sport24 ERROR", e.message);
    return [];
  }
};

// ✅ ATHLETIKO (SCRAPER)
const scrapeAthletiko = async () => {
  try {
    const html = await getHTML("https://www.athletiko.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article h2 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.athletiko.gr" + link;
      }

      articles.push({
        title,
        link,
        source: "Athletiko",
        pubDate: new Date()
      });
    });

    console.log("Athletiko:", articles.length);
    return articles;

  } catch (e) {
    console.log("Athletiko ERROR", e.message);
    return [];
  }
};

// 🔥 SDNA (RSS)
const scrapeSDNA = async () => {
  try {
    const { data } = await axios.get("https://www.sdna.gr/", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "el-GR,el;q=0.9,en;q=0.8"
      }
    });

    const $ = cheerio.load(data);
    const articles = [];

    $("h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.sdna.gr" + link;
      }

      articles.push({
        title,
        link,
        source: "SDNA",
        pubDate: new Date()
      });
    });

    console.log("SDNA:", articles.length);
    return articles;
  } catch (e) {
    console.log("SDNA ERROR", e.message);
    return [];
  }
};

// 🔥 ONSPORTS (RSS)
const scrapeOnsports = async () => {
  try {
    const feed = await parser.parseURL("https://www.onsports.gr/rss");

    const articles = feed.items.map(item => ({
      title: item.title,
      link: item.link,
      source: "Onsports",
      pubDate: item.pubDate || new Date()
    }));

    console.log("Onsports:", articles.length);
    return articles;
  } catch (e) {
    console.log("Onsports ERROR", e.message);
    return [];
  }
};

// 🔥 GAZZETTA (RSS)
const scrapeGazzetta = async () => {
  try {
    const { data } = await axios.get("https://www.gazzetta.gr");
    const $ = cheerio.load(data);
    const articles = [];

    $("h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.gazzetta.gr" + link;
      }

      articles.push({
        title,
        link,
        source: "Gazzetta",
        pubDate: new Date()
      });
    });

    console.log("Gazzetta:", articles.length);
    return articles;
  } catch (e) {
    console.log("Gazzetta ERROR", e.message);
    return [];
  }
};

// 🔥 TO10 (RSS)
const scrapeTo10 = async () => {
  try {
    const feed = await parser.parseURL("https://www.to10.gr/feed/");

    const articles = feed.items.map(item => ({
      title: item.title,
      link: item.link,
      source: "To10",
      pubDate: item.pubDate || new Date()
    }));

    console.log("To10:", articles.length);
    return articles;
  } catch (e) {
    console.log("To10 ERROR", e.message);
    return [];
  }
};

// 🔥 SPORTDAY (RSS)
const scrapeSportday = async () => {
  try {
    const feed = await parser.parseURL("https://sportday.gr/feed/");

    const articles = feed.items.map(item => ({
      title: item.title,
      link: item.link,
      source: "Sportday",
      pubDate: item.pubDate || new Date()
    }));

    console.log("Sportday:", articles.length);
    return articles;
  } catch (e) {
    console.log("Sportday ERROR", e.message);
    return [];
  }
};

// 🔥 NOVASPORTS (RSS)
const scrapeNovasports = async () => {
  try {
    const feed = await parser.parseURL("https://www.novasports.gr/rss.xml");

    const articles = feed.items.map(item => ({
      title: item.title,
      link: item.link,
      source: "Novasports",
      pubDate: item.pubDate || new Date()
    }));

    console.log("Novasports:", articles.length);
    return articles;
  } catch (e) {
    console.log("Novasports ERROR", e.message);
    return [];
  }
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {

    const results = await Promise.all([
      scrapeSport24(),
      scrapeAthletiko(),
      scrapeSDNA(),
      scrapeOnsports(),
      scrapeGazzetta(),
      scrapeTo10(),
      scrapeSportday(),
      scrapeNovasports()
    ]);

    const all = results.flat();

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