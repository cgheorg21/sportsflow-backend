const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ================= CONFIG & HEADERS =================
const AXIOS_CONFIG = () => ({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  },
  timeout: 10000
});

// ================= DB CONNECTION =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ DB Error:", err));

// ================= MODEL =================
const Article = mongoose.model("Article", new mongoose.Schema({
  title: { type: String, required: true },
  link: { type: String, unique: true, required: true },
  image: String,
  pubDate: { type: Date, default: Date.now },
  source: String,
  team: String,
  category: String
}));

// ================= LOGIC: DETECTION =================
const teamMap = {
  "ΠΑΟΚ": /παοκ|δικέφαλος του βορρά|paok|τούμπα/i,
  "ΟΛΥΜΠΙΑΚΟΣ": /ολυμπιακ|θρύλος|olympiacos|olympiakos|καραϊσκάκη/i,
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": /παναθην|τριφύλλι|panathinaikos| pαο |οάκα/i,
  "ΑΕΚ": / αεκ |δικέφαλος|aek|αγιά σοφιά/i,
  "ΑΡΗΣ": / άρη |άρης|aris fc|βικελίδης/i
};

const detectTeam = (text) => {
  for (const [name, regex] of Object.entries(teamMap)) {
    if (regex.test(text)) return name;
  }
  return "OTHER";
};

const detectCategory = (text, url) => {
  const t = (text + url).toLowerCase();
  if (t.match(/basket|μπασκετ|nba|euroleague/)) return "BASKET";
  if (t.match(/football|ποδοσφ|superleague|uefa|podosfairo/)) return "FOOTBALL";
  return "ALL";
};

// ================= SCRAPER: ARTICLE PAGE =================
async function fetchArticleDetails(url, source) {
  try {
    // Μικρή καθυστέρηση για αποφυγή ban
    await new Promise(r => setTimeout(r, 600)); 
    
    const res = await axios.get(url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);

    const title = $("meta[property='og:title']").attr("content") || $("h1").first().text().trim();
    if (!title || title.length < 20) return null;

    let image = $("meta[property='og:image']").attr("content") || 
                $("meta[name='twitter:image']").attr("content") ||
                $("article img").first().attr("src");

    // Fix relative image URLs
    if (image && image.startsWith('/')) {
        const base = new URL(url).origin;
        image = base + image;
    }

    return {
      title,
      link: url,
      image: image || "https://via.placeholder.com/600x400?text=Sport+News",
      pubDate: new Date(),
      source,
      team: detectTeam(title),
      category: detectCategory(title, url)
    };
  } catch {
    return null;
  }
}

// ================= SCRAPER: LINK EXTRACTOR =================
async function scrapeSource(site) {
  try {
    console.log(`📡 Scraping ${site.name}...`);
    const res = await axios.get(site.url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);
    const links = new Set();

    $("a").each((_, el) => {
      let href = $(el).attr("href");
      if (!href) return;

      const fullUrl = href.startsWith("http") ? href : site.base + (href.startsWith('/') ? '' : '/') + href;

      // Φίλτρο για να μην παίρνει κατηγορίες/videos/tags
      const isBlacklisted = ["/category/", "/videos/", "/tags/", "/author/", "/live/", "/event/"].some(b => fullUrl.includes(b));
      const matchesPattern = site.patterns.some(p => fullUrl.includes(p));

      if (matchesPattern && !isBlacklisted && fullUrl.length > 50) {
        links.add(fullUrl);
      }
    });

    const articles = [];
    const linkArray = Array.from(links).slice(0, 15); // Top 15 links

    for (const link of linkArray) {
      const details = await fetchArticleDetails(link, site.name);
      if (details) articles.push(details);
    }
    return articles;
  } catch (err) {
    console.error(`❌ Error on ${site.name}:`, err.message);
    return [];
  }
}

// ================= ENGINE =================
const sources = [
  { name: "Gazzetta", url: "https://www.gazzetta.gr/football/superleague", base: "https://www.gazzetta.gr", patterns: ["/football/"] },
  { name: "Gazzetta", url: "https://www.gazzetta.gr/basketball", base: "https://www.gazzetta.gr", patterns: ["/basketball/"] },
  { name: "SDNA", url: "https://www.sdna.gr/podosfairo", base: "https://www.sdna.gr", patterns: ["/podosfairo/"] },
  { name: "Sport24", url: "https://www.sport24.gr/football/", base: "https://www.sport24.gr", patterns: ["/football/article/"] },
  { name: "SportFM", url: "https://www.sport-fm.gr/news/podosfairo", base: "https://www.sport-fm.gr", patterns: ["/article/"] },
  { name: "To10", url: "https://www.to10.gr/podosfero/", base: "https://www.to10.gr", patterns: ["/podosfero/"] },
  { name: "Sportday", url: "https://sportday.gr/podosfairo", base: "https://sportday.gr", patterns: ["/podosfairo/"] }
];

async function run() {
  console.log(`\n--- 🕒 Start: ${new Date().toLocaleTimeString()} ---`);
  
  for (const site of sources) {
    const articles = await scrapeSource(site);
    let count = 0;
    for (const a of articles) {
      try {
        const res = await Article.updateOne({ link: a.link }, { $set: a }, { upsert: true });
        if (res.upsertedCount > 0) count++;
      } catch {}
    }
    console.log(`✅ ${site.name}: ${count} new articles.`);
  }
}

// Run engine
run();
setInterval(run, 15 * 60 * 1000); // Κάθε 15 λεπτά

// ================= API =================
app.get("/articles", async (req, res) => {
  const { team, category, source, page = 1 } = req.query;
  const query = {};

  if (team) query.team = team;
  if (source) query.source = source;
  if (category && category !== "ALL") query.category = category;

  const data = await Article.find(query)
    .sort({ pubDate: -1 })
    .skip((parseInt(page) - 1) * 20)
    .limit(20);

  res.json(data);
});

app.listen(PORT, () => console.log(`🌍 Server on port ${PORT}`));