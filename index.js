const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const mongoose = require("mongoose");

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

// ================= HELPERS =================

const getHTML = async (url) => {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "el-GR,el;q=0.9,en;q=0.8"
    }
  });
  return data;
};

const clean = (t) => t?.replace(/\s+/g, " ").trim();

const getImage = ($el) => {
  return (
    $el.find("img").attr("src") ||
    $el.find("img").attr("data-src") ||
    $el.find("img").attr("data-original") ||
    ""
  );
};

const fallbackImage = (img) =>
  img && img.startsWith("http")
    ? img
    : "https://via.placeholder.com/600x400?text=Sports";

// ================= SPORT =================

const detectSport = (title, link) => {
  const t = (title + link).toLowerCase();

  if (t.includes("basket") || t.includes("nba") || t.includes("euroleague"))
    return "BASKET";

  return "FOOTBALL";
};

// ================= TEAM =================

const detectTeam = (title) => {
  const t = title.toLowerCase();

  if (t.includes("ολυμπιακ") || t.includes("osfp") || t.includes("πειραιας") || t.includes("ερυθρολευκοι") || t.includes("θρυλος") || t.includes("λιμανι") || t.includes("δαφνοστεφανωμενος")) return "ΟΛΥΜΠΙΑΚΟΣ";

if (t.includes("παναθην") || t.includes("παο") || t.includes("τριφυλλι") || t.includes("αθηνα") || t.includes("λεωφορος") || t.includes("πρασινοι") || t.includes("pao")) return "ΠΑΝΑΘΗΝΑΙΚΟΣ";

if (t.includes("αεκ") || t.includes("ενωση") || t.includes("δικεφαλος") || t.includes("προσφυγια") || t.includes("νεα φιλαδελφεια") || t.includes("κιτρινομαυροι")) return "ΑΕΚ";

if (t.includes("παοκ") || t.includes("τουμπα") || t.includes("δικεφαλος του βορρα") || t.includes("ασπρομαυροι") || t.includes("θυρα 4")) return "ΠΑΟΚ";

if (t.includes("αρη") || t.includes("θεος του πολεμου") || t.includes("κλεανθης βικελιδης") || t.includes("κιτρινοι") || t.includes("super 3")) return "ΑΡΗΣ";

if (t.includes("οφη") || t.includes("κρητη") || t.includes("ηρακλειο") || t.includes("γεντι κουλε") || t.includes("ομιλητες")) return "ΟΦΗ";

if (t.includes("βολο") || t.includes("μαγνησια") || t.includes("πανθεσσαλικο") || t.includes("κυανερυθροι") || t.includes("νεα ομαδα")) return "ΒΟΛΟΣ";

if (t.includes("ατρομη") || t.includes("περιστερι") || t.includes("αστερι") || t.includes("κυανολευκοι") || t.includes("δυτικα προαστια") || t.includes("fentagin")) return "ΑΤΡΟΜΗΤΟΣ";

if (t.includes("παναιτωλ") || t.includes("αγρινιο") || t.includes("τιτορμος") || t.includes("κιτρινομπλε") || t.includes("καναρινια") || t.includes("αιτωλοακαρνανικη")) return "ΠΑΝΑΙΤΩΛΙΚΟΣ";

if (t.includes("αστερα") || t.includes("αρκαδια") || t.includes("θεοδωρος κολοκοτρωνης") || t.includes("κυανοκιτρινοι") || t.includes("πελοποννησος")) return "ΑΣΤΕΡΑΣ";

if (t.includes("πανσερ") || t.includes("σερρες") || t.includes("λιονταρια") || t.includes("κοκκινοι") || t.includes("δημοτικο γηπεδο")) return "ΠΑΝΣΕΡΑΙΚΟΣ";

if (t.includes("αελ") || t.includes("βασιλισσα του καμπου") || t.includes("αλογακι") || t.includes("θεσσαλια") || t.includes("βυσσινι") || t.includes("πρωταθλημα 1988")) return "ΑΕΛ";

if (t.includes("καλαματ") || t.includes("μαυρη θυελλα") || t.includes("μεσσηνια") || t.includes("παραλια") || t.includes("μαυροασπροι")) return "ΚΑΛΑΜΑΤΑ";

if (t.includes("λεβαδ") || t.includes("λιβαδεια") || t.includes("βοιωτια") || t.includes("κομποτης") || t.includes("στερεα ελλαδα")) return "ΛΕΒΑΔΕΙΑΚΟΣ";

if (t.includes("κηφισ") || t.includes("βορεια προαστια") || t.includes("ζηρινειο") || t.includes("νεοφωτιστοι") || t.includes("μπλε-ασπρο") || t.includes("ανοδος")) return "ΚΗΦΙΣΙΑ";

if (t.includes("ηρακλ") || t.includes("γηραιος") || t.includes("καυτατζογλειο") || t.includes("κυανολευκοι") || t.includes("αυτονομη θυρα 10") || t.includes("ιστορια")) return "ΗΡΑΚΛΗΣ";

  return null;
};

const buildCategories = (sport, team, source) => {
  const c = ["ALL", sport, source];
  if (team) c.push(team);
  return c;
};

// ================= FILTER =================

const isValid = (title) => {
  if (!title || title.length < 20) return false;

  const bad = ["video", "live", "gallery", "photo", "στοιχημα"];
  return !bad.some(w => title.toLowerCase().includes(w));
};

// ================= SCRAPERS =================

// 🔴 SPORT24
const scrapeSport24 = async () => {
  try {
    const html = await getHTML("https://www.sport24.gr/football/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h3, h2").first().text());
      let link = $(el).find("a").attr("href");
      let image = fallbackImage(getImage($(el)));

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.sport24.gr" + link;
      }

      if (!isValid(title)) return;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      articles.push({
        title,
        link,
        image,
        source: "Sport24",
        sport,
        team,
        categories: buildCategories(sport, team, "Sport24"),
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

// 🔴 SDNA (FIX 403)
const scrapeSDNA = async () => {
  try {
    const html = await getHTML("https://www.sdna.gr/podosfairo");
    const $ = cheerio.load(html);

    const articles = [];

    $(".node--type-article").each((_, el) => {
      const title = clean($(el).find("h3, h2").text());
      let link = $(el).find("a").attr("href");
      let image = fallbackImage(getImage($(el)));

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.sdna.gr" + link;
      }

      if (!isValid(title)) return;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      articles.push({
        title,
        link,
        image,
        source: "SDNA",
        sport,
        team,
        categories: buildCategories(sport, team, "SDNA"),
        pubDate: new Date()
      });
    });

    console.log("SDNA:", articles.length);
    return articles;

  } catch (e) {
    console.log("SDNA ERROR", e.message);
    return [];
  }
};

// 🔴 ONSPORTS
const scrapeOnsports = async () => {
  try {
    const html = await getHTML("https://www.onsports.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h3, h2").text());
      let link = $(el).find("a").attr("href");
      let image = fallbackImage(getImage($(el)));

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.onsports.gr" + link;
      }

      if (!isValid(title)) return;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      articles.push({
        title,
        link,
        image,
        source: "Onsports",
        sport,
        team,
        categories: buildCategories(sport, team, "Onsports"),
        pubDate: new Date()
      });
    });

    console.log("Onsports:", articles.length);
    return articles;

  } catch (e) {
    console.log("Onsports ERROR", e.message);
    return [];
  }
};

// 🔴 ATHLETIKO
const scrapeAthletiko = async () => {
  try {
    const html = await getHTML("https://www.athletiko.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h3, h2").text());
      let link = $(el).find("a").attr("href");
      let image = fallbackImage(getImage($(el)));

      if (!title || !link) return;

      if (!link.startsWith("http")) {
        link = "https://www.athletiko.gr" + link;
      }

      if (!isValid(title)) return;

      const sport = detectSport(title, link);
      const team = detectTeam(title);

      articles.push({
        title,
        link,
        image,
        source: "Athletiko",
        sport,
        team,
        categories: buildCategories(sport, team, "Athletiko"),
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

// ================= DEDUPE =================

const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter(a => {
    const key = a.title + a.link;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// ================= ROUTE =================

app.get("/articles", async (req, res) => {
  try {

    const cached = await Article.find().sort({ pubDate: -1 }).limit(100);
    if (cached.length > 20) {
      return res.json(cached);
    }

    const [s1, s2, s3, s4] = await Promise.all([
      scrapeSport24(),
      scrapeSDNA(),
      scrapeOnsports(),
      scrapeAthletiko()
    ]);

    let all = [...s1, ...s2, ...s3, ...s4];
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