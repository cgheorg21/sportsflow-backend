const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const mongoose = require("mongoose");
const xml2js = require("xml2js");

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
  sport: String,
  team: String,
  categories: [String],
  pubDate: Date
});

const Article = mongoose.model("Article", ArticleSchema);

// ================= CONFIG =================
const RSS_SOURCES = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://www.to10.gr/feed/", source: "To10" },
  { url: "https://sportday.gr/feed/", source: "Sportday" },
  { url: "https://www.athletiko.gr/feed/", source: "Athletiko" }
];

// ================= TEAMS =================
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

// ================= HELPERS =================
const clean = (t="") => t.replace(/\s+/g, " ").trim();

const detectSport = (title, link) => {
  const t = (title + " " + link).toLowerCase();
  if (t.includes("basket") || t.includes("nba")) return "BASKET";
  return "FOOTBALL";
};

const detectTeam = (title) => {
  const t = title.toLowerCase();
  for (let team in teamKeywords) {
    if (teamKeywords[team].some(k => t.includes(k))) return team;
  }
  return null;
};

const buildCategories = (article) => {
  const cats = ["ALL"];

  if (article.sport) cats.push(article.sport);
  if (article.team) cats.push(article.team);
  if (article.source) cats.push(article.source);

  return cats;
};

// ================= FETCH RSS =================
const fetchRSS = async (url) => {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/rss+xml"
    },
    timeout: 10000
  });

  return xml2js.parseStringPromise(data);
};

const parseRSS = async (source) => {
  try {
    const json = await fetchRSS(source.url);
    const items = json.rss.channel[0].item || [];

    return items.map(item => {
      const title = clean(item.title?.[0]);
      const link = item.link?.[0];

      let image =
        item["media:content"]?.[0]?.$.url ||
        item.enclosure?.[0]?.$.url ||
        "";

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      return {
        title,
        link,
        image,
        source: source.source,
        sport,
        team,
        categories: buildCategories({ sport, team, source: source.source }),
        pubDate: new Date(item.pubDate?.[0] || Date.now())
      };
    });

  } catch (e) {
    console.log(source.source, "RSS ERROR");
    return [];
  }
};

// ================= SCRAPERS =================

// SPORT24
const scrapeSport24 = async () => {
  try {
    const { data } = await axios.get("https://www.sport24.gr/football/", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const arr = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h3").text());
      let link = $(el).find("a").attr("href");
      const image = $(el).find("img").attr("src");

      if (!title || !link) return;

      if (!link.startsWith("http")) link = "https://www.sport24.gr" + link;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      arr.push({
        title,
        link,
        image,
        source: "Sport24",
        sport,
        team,
        categories: buildCategories({ sport, team, source: "Sport24" }),
        pubDate: new Date()
      });
    });

    return arr;
  } catch {
    return [];
  }
};

// ONSPORTS
const scrapeOnsports = async () => {
  try {
    const { data } = await axios.get("https://www.onsports.gr/", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const arr = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h2").text());
      const link = $(el).find("a").attr("href");
      const image = $(el).find("img").attr("src");

      if (!title || !link) return;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      arr.push({
        title,
        link,
        image,
        source: "Onsports",
        sport,
        team,
        categories: buildCategories({ sport, team, source: "Onsports" }),
        pubDate: new Date()
      });
    });

    return arr;
  } catch {
    return [];
  }
};

// NOVASPORTS
const scrapeNova = async () => {
  try {
    const { data } = await axios.get("https://www.novasports.gr/", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const arr = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h3").text());
      const link = $(el).find("a").attr("href");
      const image = $(el).find("img").attr("src");

      if (!title || !link) return;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      arr.push({
        title,
        link,
        image,
        source: "Novasports",
        sport,
        team,
        categories: buildCategories({ sport, team, source: "Novasports" }),
        pubDate: new Date()
      });
    });

    return arr;
  } catch {
    return [];
  }
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {

    // DB FIRST
    const cached = await Article.find().sort({ pubDate: -1 }).limit(100);
    if (cached.length > 30) return res.json(cached);

    // RSS
    const rssResults = await Promise.all(
      RSS_SOURCES.map(parseRSS)
    );

    // SCRAPERS
    const [sport24, onsports, nova] = await Promise.all([
      scrapeSport24(),
      scrapeOnsports(),
      scrapeNova()
    ]);

    let all = [
      ...rssResults.flat(),
      ...sport24,
      ...onsports,
      ...nova
    ];

    // CLEAN EMPTY
    all = all.filter(a => a.title && a.link);

    // DEDUPE
    const seen = new Set();
    all = all.filter(a => {
      if (seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    });

    // SAVE
    await Article.deleteMany({});
    await Article.insertMany(all);

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