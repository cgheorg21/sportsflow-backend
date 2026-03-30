const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// Headers για να αποφύγουμε το "Bot Detection"
const AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    timeout: 10000
};

// ================= DB CONNECTION =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ DB Error:", err));

// ================= SCHEMA =================
const Article = mongoose.model("Article", new mongoose.Schema({
  title: { type: String, required: true },
  link: { type: String, unique: true, required: true },
  image: String,
  pubDate: { type: Date, default: Date.now },
  source: String,
  team: String,
  category: String
}));

// ================= DETECTION LOGIC =================
const teamKeywords = {
  "ΠΑΟΚ": ["παοκ", "δικεφαλος του βορρα", "paok", "τουμπα"],
  "ΟΛΥΜΠΙΑΚΟΣ": ["ολυμπιακ", "θρυλος", "olympiacos", "olympiakos", "καραισκακη"],
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": ["παναθην", "τριφυλλι", "panathinaikos", " pαο ", "οακα"],
  "ΑΕΚ": [" αεκ ", "δικεφαλος", "aek", "αγια σοφια"],
  "ΑΡΗΣ": [" αρη ", "κιτρινομαυροι", "aris fc", "βικελιδης"]
};

function detectTeam(text) {
  const t = text.toLowerCase();
  for (const [team, keywords] of Object.entries(teamKeywords)) {
    if (keywords.some(k => t.includes(k))) return team;
  }
  return "OTHER"; 
}

function detectCategory(text, url) {
  const combined = (text + url).toLowerCase();
  if (combined.includes("basket") || combined.includes("μπασκετ") || combined.includes("nba") || combined.includes("euroleague")) return "BASKET";
  if (combined.includes("football") || combined.includes("podosfairo") || combined.includes("ποδοσφ") || combined.includes("superleague")) return "FOOTBALL";
  return "ALL";
}

// ================= ARTICLE SCRAPER =================
async function fetchArticle(url, source) {
  try {
    const res = await axios.get(url, AXIOS_CONFIG);
    const $ = cheerio.load(res.data);

    const title = $("meta[property='og:title']").attr("content") || $("h1").first().text().trim();
    
    // Προσπάθεια εύρεσης εικόνας με σειρά προτεραιότητας
    let image = 
      $("meta[property='og:image']").attr("content") || 
      $("meta[name='twitter:image']").attr("content") ||
      $("article img").first().attr("src") ||
      $(".main-image img").attr("src");

    if (!title || title.length < 15) return null;

    // Διόρθωση Relative URLs (π.χ. /images/abc.jpg -> https://site.gr/images/abc.jpg)
    if (image && !image.startsWith('http')) {
        const urlObj = new URL(url);
        image = urlObj.origin + (image.startsWith('/') ? '' : '/') + image;
    }

    return {
      title,
      link: url,
      image: image || "https://via.placeholder.com/600x400?text=No+Image",
      pubDate: new Date(),
      source,
      team: detectTeam(title),
      category: detectCategory(title, url)
    };
  } catch (e) {
    return null;
  }
}

// ================= LIST SCRAPER =================
async function scrapeLinks(url, base, patterns, source) {
  try {
    const res = await axios.get(url, AXIOS_CONFIG);
    const $ = cheerio.load(res.data);
    let links = new Set();

    $("a").each((_, el) => {
      let href = $(el).attr("href");
      if (!href) return;
      
      const full = href.startsWith("http") ? href : base + (href.startsWith('/') ? '' : '/') + href;

      // Φιλτράρουμε ώστε να παίρνουμε μόνο άρθρα και όχι κατηγορίες ή tags
      if (patterns.some(p => full.includes(p)) && full.length > 45) {
        links.add(full);
      }
    });

    // Μετατροπή σε Array και περιορισμός (batch) για να μην μπλοκαριστούμε
    const linkArray = Array.from(links).slice(0, 12); 
    const promises = linkArray.map(link => fetchArticle(link, source));
    const results = await Promise.all(promises);
    
    return results.filter(a => a !== null);
  } catch (e) {
      console.error(`❌ Error in ${source}:`, e.message);
      return [];
  }
}

// ================= MAIN ENGINE =================
async function run() {
  console.log(`\n--- 🕒 Scraper Started: ${new Date().toLocaleTimeString()} ---`);

  const sources = [
    { name: "Gazzetta", url: "https://www.gazzetta.gr/football", base: "https://www.gazzetta.gr", patterns: ["/football/"] },
    { name: "Gazzetta", url: "https://www.gazzetta.gr/basketball", base: "https://www.gazzetta.gr", patterns: ["/basketball/"] },
    { name: "SDNA", url: "https://www.sdna.gr/podosfairo", base: "https://www.sdna.gr", patterns: ["/podosfairo/"] },
    { name: "SDNA", url: "https://www.sdna.gr/mpasket", base: "https://www.sdna.gr", patterns: ["/mpasket/"] },
    { name: "Sport24", url: "https://www.sport24.gr/football/", base: "https://www.sport24.gr", patterns: ["/football/"] },
    { name: "Sport24", url: "https://www.sport24.gr/basket/", base: "https://www.sport24.gr", patterns: ["/basket/"] },
    { name: "SportFM", url: "https://www.sport-fm.gr/news/podosfairo", base: "https://www.sport-fm.gr", patterns: ["/article/"] },
    { name: "SportFM", url: "https://www.sport-fm.gr/news/basket", base: "https://www.sport-fm.gr", patterns: ["/article/"] },
    { name: "To10", url: "https://www.to10.gr/category/podosfero/", base: "https://www.to10.gr", patterns: ["/podosfero/"] },
    { name: "To10", url: "https://www.to10.gr/category/basket/", base: "https://www.to10.gr", patterns: ["/basket/"] },
    { name: "Sportday", url: "https://sportday.gr/podosfairo", base: "https://sportday.gr", patterns: ["/podosfairo/"] },
    { name: "Sportday", url: "https://sportday.gr/basket", base: "https://sportday.gr", patterns: ["/basket/"] },
    { name: "Novasports", url: "https://www.novasports.gr/sport/podosfairo/news/", base: "https://www.novasports.gr", patterns: ["/podosfairo/"] },
    { name: "Novasports", url: "https://www.novasports.gr/sport/mpasket/news/", base: "https://www.novasports.gr", patterns: ["/mpasket/"] }
  ];

  for (const site of sources) {
    const articles = await scrapeLinks(site.url, site.base, site.patterns, site.name);
    
    let savedCount = 0;
    for (const a of articles) {
      try {
        const res = await Article.updateOne(
          { link: a.link },
          { $setOnInsert: a },
          { upsert: true }
        );
        if (res.upsertedCount > 0) savedCount++;
      } catch (err) {}
    }
    console.log(`🗞️ ${site.name} (${site.url.split('/').pop()}): New ${savedCount}`);
  }

  console.log("--- ✅ Scraper Finished ---\n");
}

// Εκκίνηση και επανάληψη κάθε 15 λεπτά
run();
setInterval(run, 15 * 60 * 1000);

// ================= API ENDPOINTS =================
app.get("/articles", async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => console.log(`🌍 API Server on port ${PORT}`));