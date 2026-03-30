const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// ================= MODEL =================
const Article = mongoose.model("Article", new mongoose.Schema({
  title: String,
  link: { type: String, unique: true },
  image: String,
  content: String,
  pubDate: Date,
  source: String,
  category: String
}));

// ================= CATEGORY =================
function detectCategory(text) {
  text = text.toLowerCase();
  if (["nba","euroleague","μπασκετ"].some(k => text.includes(k))) return "basket";
  if (["ποδοσφ","football","super league"].some(k => text.includes(k))) return "football";
  return "other";
}

// ================= GENERIC ARTICLE PARSER =================
async function parseArticle(url, source) {
  try {
    const res = await axios.get(url, { timeout: 5000 });
    const $ = cheerio.load(res.data);

    const title =
      $("meta[property='og:title']").attr("content") ||
      $("title").text();

    const image =
      $("meta[property='og:image']").attr("content") ||
      $("img").first().attr("src") ||
      "";

    const content = $("p").map((i,el)=>$(el).text()).get().join(" ");

    return {
      title,
      link: url,
      image,
      content,
      pubDate: new Date(),
      source,
      category: detectCategory(title + content)
    };

  } catch {
    return null;
  }
}

// ================= LINK EXTRACTOR =================
async function extractLinks(url, selector) {
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    let links = new Set();

    $(selector).each((_, el) => {
      const link = $(el).attr("href");
      if (link && link.includes("/")) {
        links.add(link.startsWith("http") ? link : url + link);
      }
    });

    return Array.from(links);

  } catch {
    return [];
  }
}

// ================= CRAWL SITE =================
async function crawlSite(baseUrl, selector, source) {
  const links = await extractLinks(baseUrl, selector);

  let articles = [];

  for (const link of links.slice(0, 30)) {
    const article = await parseArticle(link, source);
    if (article && article.title.length > 20) {
      articles.push(article);
    }
  }

  return articles;
}

// ================= ALL SOURCES =================
async function fetchAll() {
  console.log("CRAWLING...");

  const results = await Promise.all([
    crawlSite("https://www.gazzetta.gr/football", "a", "Gazzetta"),
    crawlSite("https://www.sdna.gr/podosfairo", "a", "SDNA"),
    crawlSite("https://www.sport24.gr/", "a", "Sport24"),
    crawlSite("https://www.to10.gr/", "a", "To10"),
    crawlSite("https://sportday.gr/", "a", "Sportday"),
    crawlSite("https://www.sport-fm.gr/", "a", "SportFM"),
    crawlSite("https://www.athletiko.gr/", "a", "Athletiko")
  ]);

  const all = results.flat();

  for (const a of all) {
    try {
      await Article.updateOne(
        { link: a.link },
        { $setOnInsert: a },
        { upsert: true }
      );
    } catch {}
  }

  console.log("Saved:", all.length);
}

// ================= RUN =================
fetchAll();
setInterval(fetchAll, 180000);

// ================= API =================
app.get("/articles", async (req, res) => {
  const { page = 1 } = req.query;

  const data = await Article.find()
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server running");
});