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

const extractImage = (item) => {
  return (
    item.enclosure?.url ||
    item.enclosure?.link ||
    item["media:content"]?.url ||
    item["media:thumbnail"]?.url ||
    (item.content?.match(/<img.*?src="(.*?)"/)?.[1]) ||
    (item.contentSnippet?.match(/<img.*?src="(.*?)"/)?.[1]) ||
    ""
  );
};
// ================= SCRAPERS =================

// ✅ SPORT24 (SCRAPER)
const scrapeSport24 = async () => {
  try {
    const html = await getHTML("https://www.sport24.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h2, h3").first().text());
      let link = $(el).find("a").attr("href");

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.sport24.gr" + link;
      }

      let image =
      $(el).find("img").attr("src") ||
      $(el).find("img").attr("data-src") ||
      $(el).find("img").attr("data-lazy-src");

      articles.push({
      title,
      link,
      image,
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

    $("article").each((_, el) => {
      const title = clean($(el).find("h2, h3").text());
      let link = $(el).find("a").attr("href");

      let image =
        $(el).find("img").attr("src") ||
        $(el).find("img").attr("data-src") ||
        $(el).find("img").attr("srcset")?.split(" ")[0];

      articles.push({
      title,
      link,
      image,
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

// 🔥 ONSPORTS (RSS)
const scrapeOnsports = async () => {
  try {
    const feed = await parser.parseURL("https://www.onsports.gr/latest-news?format=feed");

    const articles = feed.items.map(item => ({
    title: item.title,
    link: item.link,
    image: extractImage(item),
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
    const feed = await parser.parseURL("https://www.gazzetta.gr/rss");

    const articles = feed.items.map(item => ({
      title: item.title,
      link: item.link,
      image: extractImage(item),
      pubDate: item.pubDate || new Date()
    }));

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
      image: extractImage(item),
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
      image: extractImage(item),
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
    const feed = await parser.parseURL("https://www.novasports.gr/feed/");

    const articles = feed.items.map(item => ({
      title: item.title,
      link: item.link,
      source: "Novasports",
      image: extractImage(item),
      pubDate: item.pubDate || new Date()
    }));

    console.log("Novasports:", articles.length);
    return articles;
  } catch (e) {
    console.log("Novasports ERROR", e.message);
    return [];
  }
};
// ================= DEDUP =================
  const dedupe = (arr) => {
  const seen = new Set();

  return arr.filter(a => {
    if (!a.link) return false;

    if (seen.has(a.link)) return false;

    seen.add(a.link);
    return true;
  });
};
// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {

    const results = await Promise.all([
      scrapeSport24(),
      scrapeAthletiko(),
      scrapeOnsports(),
      scrapeGazzetta(),
      scrapeTo10(),
      scrapeSportday(),
      scrapeNovasports()
    ]);

    const all = dedupe(results.flat());
    console.log("TOTAL:", all.length);
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