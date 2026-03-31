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
//==============TEAM KEYWORDS==================
const teamKeywords = {
  "ΟΛΥΜΠΙΑΚΟΣ": ["ολυμπιακ", "osfp", "πειραιας", "ερυθρολευκοι", "θρυλος", "λιμανι", "δαφνοστεφανωμενος"],
  "ΠΑΝΑΘΗΝΑΙΚΟΣ": ["παναθην", "παο", "τριφυλλι", "αθηνα", "λεωφορος", "πρασινοι", "pao"],
  "ΑΕΚ": ["αεκ", "ενωση", "δικεφαλος", "προσφυγια", "νεα φιλαδελφεια", "κιτρινομαυροι"],
  "ΠΑΟΚ": ["παοκ", "τουμπα", "δικεφαλος του βορρα", "ασπρομαυροι", "θυρα 4"],
  "ΑΡΗΣ": ["αρη", "θεος του πολεμου", "κλεανθης βικελιδης", "κιτρινοι", "super 3"],
  "ΟΦΗ": ["οφη", "κρητη", "ηρακλειο", "γεντι κουλε", "ομιλητες"],
  "ΒΟΛΟΣ": ["βολο", "μαγνησια", "πανθεσσαλικο", "κυανερυθροι", "νεα ομαδα"],
  "ΑΤΡΟΜΗΤΟΣ": ["ατρομη", "περιστερι", "αστερι", "κυανολευκοι", "δυτικα προαστια", "fentagin"],
  "ΠΑΝΑΙΤΩΛΙΚΟΣ": ["παναιτωλ", "αγρινιο", "τιτορμος", "κιτρινομπλε", "καναρινια", "αιτωλοακαρνανικη"],
  "ΑΣΤΕΡΑΣ": ["αστερα", "αρκαδια", "θεοδωρος κολοκοτρωνης", "κυανοκιτρινοι", "πελοποννησος"],
  "ΠΑΝΣΕΡΑΙΚΟΣ": ["πανσερ", "σερρες", "λιονταρια", "κοκκινοι", "δημοτικο γηπεδο"],
  "ΑΕΛ": ["αελ", "βασιλισσα του καμπου", "αλογακι", "θεσσαλια", "βυσσινι", "πρωταθλημα 1988"],
  "ΚΑΛΑΜΑΤΑ": ["καλαματ", "μαυρη θυελλα", "μεσσηνια", "παραλια", "μαυροασπροι"],
  "ΛΕΒΑΔΕΙΑΚΟΣ": ["λεβαδ", "λιβαδεια", "βοιωτια", "κομποτης", "στερεα ελλαδα"],
  "ΚΗΦΙΣΙΑ": ["κηφισ", "βορεια προαστια", "ζηρινειο", "νεοφωτιστοι", "μπλε-ασπρο", "ανοδος"],
  "ΗΡΑΚΛΗΣ": ["ηρακλ", "γηραιος", "καυτατζογλειο", "κυανολευκοι", "αυτονομη θυρα 10", "ιστορια"]
};


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

const cleanTitle = (title) => {
  if (!title) return "";

  const t = title.trim();

  // κόβει διπλό τίτλο
  const half = t.slice(0, t.length / 2);
  if (t.endsWith(half)) return half;

  return t;
};

const detectTeam = (title) => {
  const t = title.toLowerCase();

  //  ΠΡΩΤΑ τα πιο "επικίνδυνα"
  if (t.includes("παοκ")) return "ΠΑΟΚ";

  if (t.includes("παναθηναϊκ") || t.includes("παναθην")) return "ΠΑΝΑΘΗΝΑΙΚΟΣ";

  if (t.includes("ολυμπιακ")) return "ΟΛΥΜΠΙΑΚΟΣ";

  if (t.includes("αεκ")) return "ΑΕΚ";

  if (t.includes("αρης")) return "ΑΡΗΣ";

  if (t.includes("οφη")) return "ΟΦΗ";

  if (t.includes("βολο")) return "ΒΟΛΟΣ";

  if (t.includes("ατρομη")) return "ΑΤΡΟΜΗΤΟΣ";

  if (t.includes("παναιτωλ")) return "ΠΑΝΑΙΤΩΛΙΚΟΣ";

  if (t.includes("αστερα")) return "ΑΣΤΕΡΑΣ";

  if (t.includes("πανσερ")) return "ΠΑΝΣΕΡΑΙΚΟΣ";

  if (t.includes("αελ")) return "ΑΕΛ";

  if (t.includes("καλαματ")) return "ΚΑΛΑΜΑΤΑ";

  if (t.includes("λεβαδ")) return "ΛΕΒΑΔΕΙΑΚΟΣ";

  if (t.includes("κηφισ")) return "ΚΗΦΙΣΙΑ";

  if (t.includes("ηρακλ")) return "ΗΡΑΚΛΗΣ";

  return null;
};

const detectSport = (title, link) => {
  const t = (title + " " + link).toLowerCase();

  //  URL FIRST (πιο reliable)
  if (link.includes("/basket")) return "BASKET";
  if (link.includes("/mpasket")) return "BASKET";

  if (link.includes("/football")) return "FOOTBALL";
  if (link.includes("/podosfairo")) return "FOOTBALL";

  //  fallback keywords
  if (
    t.includes("basket") ||
    t.includes("nba") ||
    t.includes("euroleague") ||
    t.includes("μπασκετ")
  ) return "BASKET";

  if (
    t.includes("football") ||
    t.includes("soccer") ||
    t.includes("ποδοσφ")
  ) return "FOOTBALL";

  return "NEWS";
};

const buildCategories = (article) => {

  const categories = ["NEWS"];

  const sport = detectSport(article.title, article.link);
  categories.push(sport);

  const team = detectTeam(article.title);
  if (team) categories.push(team);

  if (article.source) categories.push(article.source);

  return categories;
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

    const all = dedupe(results.flat())
    .map(a => ({
      ...a,
      title: cleanTitle(a.title),
      categories: buildCategories(a)
    }))
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)); // 👈 ΕΔΩ

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