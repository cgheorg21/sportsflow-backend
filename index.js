const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const mongoose = require("mongoose");
const Parser = require("rss-parser");

const app = express();
app.use(cors());

const parser = new Parser();
const PORT = process.env.PORT || 3000;

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

const Article = mongoose.model("Article", new mongoose.Schema({
  title: String,
  link: String,
  image: String,
  source: String,
  sport: String,
  team: String,
  categories: [String],
  pubDate: Date
}));

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

const detectTeam = (text) => {
  const t = text.toLowerCase();
  for (let team in teamKeywords) {
    if (teamKeywords[team].some(k => t.includes(k))) return team;
  }
  return null;
};

// ================= SPORT DETECTION =================
const detectSport = (text) => {
  const t = text.toLowerCase();

  if (t.includes("basket") || t.includes("nba") || t.includes("euroleague") || t.includes("mpasket") || t.includes("μπασκετ"))
    return "BASKET";

  if (t.includes("football") || t.includes("podosfairo") || t.includes("soccer") || t.includes("uefa") || t.includes("euro") || t.includes("ποδοσφαιρο") || t.includes("μουντιαλ"))
    return "FOOTBALL";

  return null;
};

// ================= FILTER =================
const isSports = (title, link) => {
  const t = (title + link).toLowerCase();

  const allowed = [
    "basket","nba","euroleague", "mpasket", "μπασκετ", "ποδοσφαιρο",
    "football","podosfairo","soccer",
    "superleague","premier","liga", "uefa"
  ];

  return allowed.some(k => t.includes(k));
};

// ================= RSS =================
const RSS_FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.to10.gr/feed/", source: "To10" },
  { url: "https://sportday.gr/feed/", source: "Sportday" },
  { url: "https://www.onsports.gr/rss", source: "Onsports" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" }
];

// ================= RSS FETCH =================
const fetchRSS = async () => {
  let articles = [];

  for (let feed of RSS_FEEDS) {
    try {
      const data = await parser.parseURL(feed.url);

      data.items.forEach(item => {
        let title = item.title || "";
        let link = item.link || "";

        let image =
          item.enclosure?.url ||
          item["media:content"]?.url ||
          item.content?.match(/src="(.*?)"/)?.[1] ||
          "";

        if (!title || !link) return;
        if (!isSports(title, link)) return;
        if (link.includes("/plus/")) return;

        const sport = detectSport(title + link);
        if (!sport) return;

        const team = detectTeam(title);

        const categories = ["ALL", sport, feed.source];
        if (team) categories.push(team);

        articles.push({
          title,
          link,
          image,
          source: feed.source,
          sport,
          team,
          categories,
          pubDate: new Date(item.pubDate || Date.now())
        });
      });

    } catch (e) {
      console.log("RSS FAIL:", feed.source);
    }
  }

  return articles;
};

// ================= SCRAPER (SDNA FIX) =================
const scrapeSDNA = async () => {
  try {
    const { data } = await axios.get("https://www.sdna.gr/podosfairo", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(data);
    const articles = [];

    $("article").each((_, el) => {
      let title = $(el).find("h3, h2").text().trim();
      let link = $(el).find("a").attr("href");

      if (!title || !link) return;

      if (!link.startsWith("http"))
        link = "https://www.sdna.gr" + link;

      if (!isSports(title, link)) return;

      const sport = detectSport(title + link);
      if (!sport) return;

      const team = detectTeam(title);

      const categories = ["ALL", sport, "SDNA"];
      if (team) categories.push(team);

      articles.push({
        title,
        link,
        image: "",
        source: "SDNA",
        sport,
        team,
        categories,
        pubDate: new Date()
      });
    });

    return articles;

  } catch {
    console.log("SDNA FAIL");
    return [];
  }
};

// ================= DEDUPE =================
const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter(a => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {

    const cached = await Article.find().sort({ pubDate: -1 }).limit(100);

    if (cached.length > 30) {
      return res.json(cached);
    }

    const [rss, sdna] = await Promise.all([
      fetchRSS(),
      scrapeSDNA()
    ]);

    let all = [...rss, ...sdna];

    all = dedupe(all);

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