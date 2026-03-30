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
  timeout: 15000  //  10s → 15s για αργά sites
});

// ================= DB CONNECTION =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
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
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": /παναθην|τριφύλλι|panathinaikos|pao\b|οάκα/i,
  "ΑΕΚ": /\baek\b|δικέφαλος|αγιά σοφιά|\bαεκ\b/i,
  "ΑΡΗΣ": /\bάρης\b|\bαρης\b|\baris\b|βικελίδης/i
};

const detectTeam = (text) => {
  for (const [name, regex] of Object.entries(teamMap)) {
    if (regex.test(text)) return name;
  }
  return "OTHER";
};

//  FIX: Πλέον δέχεται και sourceUrl για να ξέρει από ποιο section ήρθε
const detectCategory = (title, articleUrl, sourceUrl = "") => {
  const combined = (title + " " + articleUrl + " " + sourceUrl).toLowerCase();
  if (combined.match(/basket|μπασκετ|nba|euroleague|basketball/)) return "BASKET";
  if (combined.match(/football|ποδοσφ|superleague|uefa|podosfairo|soccer/)) return "FOOTBALL";
  return "ALL";
};

// ================= HELPER: Safe URL builder =================
function buildUrl(href, base) {
  try {
    // Αν είναι ήδη absolute URL
    if (href.startsWith("http://") || href.startsWith("https://")) {
      return href;
    }
    // Αν είναι root-relative
    if (href.startsWith("/")) {
      return new URL(href, base).href;
    }
    // Relative path
    return new URL(href, base + "/").href;
  } catch {
    return null;
  }
}

// ================= SCRAPER: ARTICLE PAGE =================
async function fetchArticleDetails(url, source, sourceUrl) {
  try {
    await new Promise(r => setTimeout(r, 400)); // ⬇ 600ms → 400ms

    const res = await axios.get(url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);

    const title =
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text().trim();

    //  FIX: Χαμηλώνουμε το threshold — 10 αντί 20
    if (!title || title.length < 10) return null;

    let image =
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("article img").first().attr("src") ||
      $(".article-image img, .featured-image img, .post-thumbnail img").first().attr("src");

    if (image && image.startsWith("/")) {
      image = new URL(image, url).href;
    }

    return {
      title: title.trim(),
      link: url,
      image: image || "https://via.placeholder.com/600x400?text=Sport+News",
      pubDate: new Date(),
      source,
      team: detectTeam(title),
      //  FIX: Περνάμε και το sourceUrl
      category: detectCategory(title, url, sourceUrl)
    };
  } catch (err) {
    console.error(`  ⚠️ fetchArticleDetails failed: ${url} — ${err.message}`);
    return null;
  }
}

// ================= SCRAPER: LINK EXTRACTOR =================
async function scrapeSource(site) {
  try {
    console.log(`📡 Scraping ${site.name} (${site.url})...`);
    const res = await axios.get(site.url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);
    const links = new Set();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || href === "#" || href.startsWith("mailto:") || href.startsWith("javascript:")) return;

      //  FIX: Χρήση safe URL builder
      const fullUrl = buildUrl(href, site.base);
      if (!fullUrl) return;

      const isBlacklisted = [
        "/category/", "/videos/", "/tags/", "/author/",
        "/live/", "/event/", "/gallery/", "/photos/", "?page="
      ].some(b => fullUrl.includes(b));

      const matchesPattern = site.patterns.some(p => fullUrl.includes(p));

      //  FIX: Αφαιρούμε το length > 50 — χρησιμοποιούμε patterns μόνο
      if (matchesPattern && !isBlacklisted) {
        links.add(fullUrl);
      }
    });

    console.log(`  🔗 Found ${links.size} candidate links for ${site.name}`);

    const articles = [];
    //  FIX: 15 → 25 links per source
    const linkArray = Array.from(links).slice(0, 25);

    //  FIX: Parallel fetching σε batches των 5 (5x πιο γρήγορο, χωρίς ban)
    const BATCH_SIZE = 5;
    for (let i = 0; i < linkArray.length; i += BATCH_SIZE) {
      const batch = linkArray.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(link => fetchArticleDetails(link, site.name, site.url))
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) articles.push(r.value);
      }
      // Μικρή παύση μεταξύ batches
      if (i + BATCH_SIZE < linkArray.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return articles;
  } catch (err) {
    console.error(`❌ Error on ${site.name} (${site.url}):`, err.message);
    return [];
  }
}

// ================= SOURCES =================
const sources = [
  // Gazzetta — ξεχωριστά sections για category detection
  { name: "Gazzetta", url: "https://www.gazzetta.gr/football/superleague", base: "https://www.gazzetta.gr", patterns: ["/football/"] },
  { name: "Gazzetta", url: "https://www.gazzetta.gr/basketball",           base: "https://www.gazzetta.gr", patterns: ["/basketball/"] },
  // SDNA
  { name: "SDNA",     url: "https://www.sdna.gr/podosfairo",               base: "https://www.sdna.gr",     patterns: ["/podosfairo/", "/article"] },
  // Sport24
  { name: "Sport24",  url: "https://www.sport24.gr/football/",             base: "https://www.sport24.gr",  patterns: ["/football/"] },
  { name: "Sport24",  url: "https://www.sport24.gr/basketball/",           base: "https://www.sport24.gr",  patterns: ["/basketball/"] },
  // SportFM
  { name: "SportFM",  url: "https://www.sport-fm.gr/news/podosfairo",      base: "https://www.sport-fm.gr", patterns: ["/article/"] },
  // To10
  { name: "To10",     url: "https://www.to10.gr/podosfero/",               base: "https://www.to10.gr",     patterns: ["/podosfero/"] },
  // Sportday
  { name: "Sportday", url: "https://sportday.gr/podosfairo",               base: "https://sportday.gr",     patterns: ["/podosfairo/"] }
];

// ================= ENGINE =================
async function run() {
  console.log(`\n--- 🕒 Start: ${new Date().toLocaleTimeString()} ---`);

  //  FIX: Sources τρέχουν παράλληλα μεταξύ τους (κέρδος ~3-4x ταχύτητα)
  const allResults = await Promise.allSettled(sources.map(site => scrapeSource(site)));

  let totalNew = 0;
  for (let i = 0; i < sources.length; i++) {
    const result = allResults[i];
    if (result.status !== "fulfilled") continue;

    const articles = result.value;
    let count = 0;
    for (const a of articles) {
      try {
        const res = await Article.updateOne({ link: a.link }, { $set: a }, { upsert: true });
        if (res.upsertedCount > 0) count++;
      } catch {}
    }
    console.log(` ${sources[i].name} (${sources[i].url}): ${count} new articles`);
    totalNew += count;
  }
  console.log(`\n🎯 Total new articles this run: ${totalNew}`);
  console.log(`--- ✅ Done: ${new Date().toLocaleTimeString()} ---\n`);
}

run();
setInterval(run, 15 * 60 * 1000);

// ================= API =================
app.get("/articles", async (req, res) => {
  try {
    const { team, category, source, page = 1 } = req.query;
    const query = {};

    if (team && team !== "ALL") query.team = team;
    if (source) query.source = source;
    //  FIX: "ALL" επιστρέφει ΟΛΑ — δεν φιλτράρει κατηγορία
    if (category && category !== "ALL") query.category = category;

    const data = await Article.find(query)
      .sort({ pubDate: -1 })
      .skip((parseInt(page) - 1) * 20)
      .limit(20);

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🌍 Server on port ${PORT}`));