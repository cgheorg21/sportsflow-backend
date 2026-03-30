const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");
const mongoose = require("mongoose");
const { parseStringPromise } = require("xml2js"); // npm install xml2js

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const AXIOS_CONFIG = () => ({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'el-GR,el;q=0.9,en-US;q=0.8',
    'Cache-Control': 'no-cache',
  },
  timeout: 15000
});

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ DB Error:", err));

const Article = mongoose.model("Article", new mongoose.Schema({
  title: { type: String, required: true },
  link: { type: String, unique: true, required: true },
  image: String,
  pubDate: { type: Date, default: Date.now },
  source: String,
  team: String,
  category: String
}));

// ================= DETECTION =================
const teamMap = {
  "ΠΑΟΚ":         /\bπαοκ\b|δικέφαλος.βορρά|τούμπα|\bpaok\b/i,
  "ΟΛΥΜΠΙΑΚΟΣ":   /ολυμπιακ|θρύλος|\bolympiacos\b|\bolympiakos\b|καραϊσκάκη/i,
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": /παναθην|τριφύλλι|panathinaikos|\bpao\b/i,
  "ΑΕΚ":          /\bαεκ\b|\baek\b|αγιά.σοφιά/i,
  "ΑΡΗΣ":         /\bάρης\b|\bαρης\b|\baris\b|βικελίδης/i
};

const detectTeam = (text) => {
  for (const [name, regex] of Object.entries(teamMap)) {
    if (regex.test(text)) return name;
  }
  return "OTHER";
};

// ✅ Sport-specific keywords + source URL context
const detectCategory = (title = "", articleUrl = "", sourceUrl = "") => {
  const t = (title + " " + articleUrl + " " + sourceUrl).toLowerCase();

  const basketKeywords = [
    "basket", "μπασκετ", "μπάσκετ", "nba", "euroleague", "eurocup",
    "basketball", "gbl", "basket league", "τριπόντο", "καλάθι",
    "παρκέ", "rebound", "φάουλ", "τάιμ άουτ"
  ];

  const footballKeywords = [
    "football", "ποδοσφ", "podosfairo", "superleague", "super league",
    "uefa", "champions league", "europa league", "conference league",
    "premier league", "la liga", "serie a", "bundesliga", "ligue 1",
    "γκολ", "πέναλτι", "οφσάιντ", "τέρμα", "κόρνερ", "αγωνιστ"
  ];

  if (basketKeywords.some(k => t.includes(k))) return "BASKET";
  if (footballKeywords.some(k => t.includes(k))) return "FOOTBALL";
  return "ALL";
};

// ================= URL BUILDER =================
function buildUrl(href, base) {
  try {
    if (!href || href.startsWith("mailto:") || href.startsWith("javascript:") || href === "#") return null;
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// ================= SCRAPER: ARTICLE PAGE =================
async function fetchArticleDetails(url, source, sourceUrl) {
  try {
    await new Promise(r => setTimeout(r, 300));
    const res = await axios.get(url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);

    const title =
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text().trim();

    if (!title || title.length < 10) return null;

    let image =
      $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("article img, .featured-image img, .post-thumbnail img, .entry-image img").first().attr("src");

    if (image?.startsWith("/")) image = new URL(image, url).href;

    return {
      title: title.trim(),
      link: url,
      image: image || "https://via.placeholder.com/600x400?text=Sport+News",
      pubDate: new Date(),
      source,
      team: detectTeam(title),
      category: detectCategory(title, url, sourceUrl)
    };
  } catch {
    return null;
  }
}

// ================= SCRAPER: HTML LINK EXTRACTOR =================
async function scrapeHtmlSource(site) {
  try {
    console.log(`📡 Scraping HTML: ${site.name} → ${site.url}`);
    const res = await axios.get(site.url, AXIOS_CONFIG());
    const $ = cheerio.load(res.data);
    const links = new Set();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const fullUrl = buildUrl(href, site.base);
      if (!fullUrl) return;

      const blacklist = ["/category/", "/tag/", "/tags/", "/author/", "/videos/",
                         "/gallery/", "/photos/", "/live/", "/event/", "?page=",
                         "/protoselida", "/newspapers", "/radio", "/tv", "/matchcenter",
                         "/vathmologies", "/programma", "/stoixima", "/kouponi"];

      if (blacklist.some(b => fullUrl.includes(b))) return;
      if (site.patterns.some(p => fullUrl.includes(p))) links.add(fullUrl);
    });

    console.log(`  🔗 ${site.name}: ${links.size} candidate links`);

    const articles = [];
    const linkArray = Array.from(links).slice(0, 30);
    const BATCH = 5;

    for (let i = 0; i < linkArray.length; i += BATCH) {
      const batch = linkArray.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(link => fetchArticleDetails(link, site.name, site.url))
      );
      results.forEach(r => { if (r.status === "fulfilled" && r.value) articles.push(r.value); });
      if (i + BATCH < linkArray.length) await new Promise(r => setTimeout(r, 800));
    }

    return articles;
  } catch (err) {
    console.error(`❌ ${site.name}: ${err.message}`);
    return [];
  }
}

// ================= SCRAPER: RSS FEED (για SDNA που κάνει 403) =================
async function scrapeRssFeed(feed) {
  try {
    console.log(`📡 RSS: ${feed.name} → ${feed.url}`);
    const res = await axios.get(feed.url, AXIOS_CONFIG());
    const parsed = await parseStringPromise(res.data, { explicitArray: false });
    const items = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    const list = Array.isArray(items) ? items : [items];

    const articles = list.slice(0, 30).map(item => {
      const title = item.title?._ || item.title || "";
      const link = item.link?.$ ? item.link.$.href : (item.link || item.guid || "");
      const image =
        item["media:content"]?.$.url ||
        item["media:thumbnail"]?.$.url ||
        item.enclosure?.$.url ||
        "https://via.placeholder.com/600x400?text=Sport+News";
      const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();

      if (!title || title.length < 10 || !link) return null;

      return {
        title: title.trim(),
        link,
        image,
        pubDate,
        source: feed.name,
        team: detectTeam(title),
        category: detectCategory(title, link, feed.url)
      };
    }).filter(Boolean);

    console.log(`  ✅ ${feed.name}: ${articles.length} articles from RSS`);
    return articles;
  } catch (err) {
    console.error(`❌ RSS ${feed.name}: ${err.message}`);
    return [];
  }
}

// ================= SOURCES =================
// HTML scrapers — με σωστά URLs και patterns βάσει fetch
const htmlSources = [
  // Gazzetta ✅ (δούλευε ήδη)
  { name: "Gazzetta", url: "https://www.gazzetta.gr/football/superleague", base: "https://www.gazzetta.gr", patterns: ["/football/"] },
  { name: "Gazzetta", url: "https://www.gazzetta.gr/basketball",           base: "https://www.gazzetta.gr", patterns: ["/basketball/"] },

  // Sport24 ✅ FIX: αφαιρέθηκε "/article/" — τα URLs είναι /football/ΤΙΤΛΟΣ/
  { name: "Sport24",  url: "https://www.sport24.gr/football/",             base: "https://www.sport24.gr",  patterns: ["/football/"] },
  { name: "Sport24",  url: "https://www.sport24.gr/basket/",               base: "https://www.sport24.gr",  patterns: ["/basket/"] },

  // SportFM ✅ FIX: σωστό URL (/list/podosfairo/1) + basket section
  { name: "SportFM",  url: "https://www.sport-fm.gr/list/podosfairo/1",    base: "https://www.sport-fm.gr", patterns: ["/article/podosfairo/"] },
  { name: "SportFM",  url: "https://www.sport-fm.gr/list/basket/2",        base: "https://www.sport-fm.gr", patterns: ["/article/basket/"] },

  // To10 ✅ FIX: σωστό URL — /category/podosfero/ αντί /podosfero/
  { name: "To10",     url: "https://www.to10.gr/category/podosfero/",      base: "https://www.to10.gr",     patterns: ["/category/podosfero/"] },
  { name: "To10",     url: "https://www.to10.gr/category/basket/",         base: "https://www.to10.gr",     patterns: ["/category/basket/"] },

  // Sportday ✅ FIX: τα άρθρα είναι /article/ paths
  { name: "Sportday", url: "https://sportday.gr/podosfairo",               base: "https://sportday.gr",     patterns: ["/article/"] },
];

// RSS feeds — για sites που κάνουν 403 (π.χ. SDNA)
const rssFeeds = [
  { name: "SDNA",     url: "https://www.sdna.gr/feed/" },
  { name: "Gazzetta", url: "https://www.gazzetta.gr/feed/" }, // backup
];

// ================= ENGINE =================
async function run() {
  console.log(`\n--- 🕒 Start: ${new Date().toLocaleTimeString()} ---`);

  const [htmlResults, rssResults] = await Promise.all([
    Promise.allSettled(htmlSources.map(s => scrapeHtmlSource(s))),
    Promise.allSettled(rssFeeds.map(f => scrapeRssFeed(f)))
  ]);

  const allArticles = [
    ...htmlResults.flatMap(r => r.status === "fulfilled" ? r.value : []),
    ...rssResults.flatMap(r => r.status === "fulfilled" ? r.value : [])
  ];

  let totalNew = 0;
  for (const a of allArticles) {
    try {
      const res = await Article.updateOne({ link: a.link }, { $set: a }, { upsert: true });
      if (res.upsertedCount > 0) totalNew++;
    } catch {}
  }

  console.log(`\n🎯 Total new articles: ${totalNew} / ${allArticles.length} fetched`);
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