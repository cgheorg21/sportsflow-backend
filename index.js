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

const Article = mongoose.model("Article", {
  title: String,
  link: String,
  image: String,
  source: String,
  sport: String,
  team: String,
  categories: [String],
  pubDate: Date
});

// ================= TEAM DETECTION =================
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

const detectTeam = (title) => {
  const t = title.toLowerCase();
  for (let team in teamKeywords) {
    if (teamKeywords[team].some(k => t.includes(k))) return team;
  }
  return "OTHER";
};

// ================= SPORT DETECTION =================
const detectSport = (title, link) => {
  const t = (title + " " + link).toLowerCase();

  if (t.includes("/basket")) return "BASKET";
  if (t.includes("/podosfero")) return "FOOTBALL";

  if (t.match(/μπασκετ|nba|euroleague|καε/)) return "BASKET";
  if (t.match(/ποδοσφ|superleague|champions|league/)) return "FOOTBALL";

  return "OTHER";
};

// ================= CLEAN =================
const isValid = (title) => {
  const t = title.toLowerCase();

  const bad = [
    "live",
    "video",
    "gallery",
    "photo",
    "στοίχημα",
    "tv",
    "μοντέλο",
    "παρουσιάστρια"
  ];

  return !bad.some(w => t.includes(w));
};

// ================= RSS FETCH =================
const fetchRSS = async (url, source) => {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const parsed = await xml2js.parseStringPromise(data);
    const items = parsed.rss.channel[0].item;

    return items.map(i => {
      const title = i.title?.[0] || "";
      const link = i.link?.[0] || "";

      let image = "";
      if (i.enclosure) image = i.enclosure[0].$.url;
      if (!image && i["media:content"]) image = i["media:content"][0].$.url;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      const categories = ["ALL", source];
      if (sport !== "OTHER") categories.push(sport);
      if (team !== "OTHER") categories.push(team);

      return {
        title,
        link,
        image,
        source,
        sport,
        team,
        categories,
        pubDate: new Date()
      };
    }).filter(a => isValid(a.title));

  } catch (err) {
    console.log(source + " RSS ERROR:", err.message);
    return [];
  }
};

// ================= SCRAPER (fallback) =================
const scrapeGeneric = async (url, source) => {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const articles = [];

    $("article, a").each((_, el) => {
      let title = $(el).text().trim();
      let link = $(el).attr("href");
      let image = $(el).find("img").attr("src");

      if (!title || !link) return;
      if (!link.startsWith("http")) return;
      if (!isValid(title)) return;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      const categories = ["ALL", source];
      if (sport !== "OTHER") categories.push(sport);
      if (team !== "OTHER") categories.push(team);

      articles.push({
        title,
        link,
        image,
        source,
        sport,
        team,
        categories,
        pubDate: new Date()
      });
    });

    return articles;

  } catch (err) {
    console.log(source + " SCRAPER ERROR:", err.message);
    return [];
  }
};

// ================= SOURCES =================
const SOURCES = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.to10.gr/feed/", source: "To10" },
  { url: "https://sportday.gr/feed/", source: "Sportday" },
  { url: "https://www.athletiko.gr/feed/", source: "Athletiko" },

  { url: "https://www.sport24.gr/rss", source: "Sport24" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://www.onsports.gr/rss/all.xml", source: "Onsports" },
  { url: "https://www.novasports.gr/feed/", source: "Novasports" }
];

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {

    const cached = await Article.find().sort({ pubDate: -1 }).limit(100);
    if (cached.length > 30) return res.json(cached);

    let all = [];

    // RSS FIRST
    const rssResults = await Promise.all(
      SOURCES.map(s => fetchRSS(s.url, s.source))
    );

    rssResults.forEach(r => all.push(...r));

    // SCRAPER fallback αν κάποιο site είναι άδειο
    for (let s of SOURCES) {
      const exists = all.some(a => a.source === s.source);
      if (!exists) {
        console.log("SCRAPING fallback:", s.source);
        const extra = await scrapeGeneric(s.url, s.source);
        all.push(...extra);
      }
    }

    // DEDUPE
    const seen = new Set();
    all = all.filter(a => {
      const key = a.title + a.link;
      if (seen.has(key)) return false;
      seen.add(key);
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