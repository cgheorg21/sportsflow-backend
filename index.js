const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const cors = require("cors");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// =======================
// 🔥 TEAM + CATEGORY DETECTION
// =======================
const teamKeywords = {
  PAOK: ["παοκ", "δικεφαλ", "τουμπ", "ασπρομαυρ", "thessaloniki"],
  OLYMPIACOS: ["ολυμπιακ", "osfp", "πειραι", "ερυθρολευκ", "θρυλο", "λιμανι"],
  PANATHINAIKOS: ["παναθην", "παο", "τριφυλλ", "πρασιν", "λεωφορ"],
  AEK: ["αεκ", "ενωση", "δικεφαλ", "φιλαδελφ", "κιτρινομαυρ"],
  ARIS: ["αρη", "κιτριν", "βικελιδ", "super 3"],
  OFI: ["οφη", "ηρακλειο", "κρητ", "γεντι κουλε"],
  VOLOS: ["βολο", "μαγνησια", "πανθεσσαλικ"],
  LEVADIAKOS: ["λεβαδ", "λιβαδ", "βοιωτ"],
  ATROMITOS: ["ατρομη", "περιστερ", "κυανολευκ"],
  KIFISIA: ["κηφισ", "ζηρινει", "βορεια προαστια"],
  PANETOLIKOS: ["παναιτωλ", "αγριν", "τιτορμ"],
  AEL: ["αελ", "λαρισ", "βυσσιν", "καμπου"],
  PANSERRAIKOS: ["πανσερ", "σερρ", "λιονταρ"],
  ASTERAS: ["αστερα", "αρκαδ", "κολοκοτρων"],
  KALAMATA: ["καλαματ", "μαυρη θυελλα", "μεσσην"],
  IRAKLIS: ["ηρακλ", "γηραι", "καυτανζογλει"]
};

function detectTeam(text) {
  text = text.toLowerCase();
  for (const team in teamKeywords) {
    if (teamKeywords[team].some(k => text.includes(k))) {
      return team;
    }
  }
  return null;
}

function detectCategory(text) {
  text = text.toLowerCase();

  if (["μπασκετ", "basket", "nba", "euroleague"].some(k => text.includes(k)))
    return "basket";

  if (["ποδοσφ", "football", "super league", "uefa"].some(k => text.includes(k)))
    return "football";

  return "other";
}

// =======================
// 🔥 IMAGE
// =======================
function extractImage(item) {
  const description = item.description?.[0] || "";
  const content = item["content:encoded"]?.[0] || "";

  if (item["media:content"]?.[0]?.$?.url)
    return item["media:content"][0].$.url;

  if (item.enclosure?.[0]?.$?.url)
    return item.enclosure[0].$.url;

  const matchContent = content.match(/<img.*?src="(.*?)"/);
  if (matchContent) return matchContent[1];

  const matchDesc = description.match(/<img.*?src="(.*?)"/);
  if (matchDesc) return matchDesc[1];

  return "";
}

// =======================
// 🔥 FEEDS
// =======================
const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" }
];

// =======================
// 🔥 MAIN ROUTE
// =======================
app.get("/articles", async (req, res) => {
  try {

    // ⚡ ΠΑΡΑΛΛΗΛΑ (BIG SPEED BOOST)
    const feedPromises = FEEDS.map(feed =>
      axios.get(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 5000
      })
      .then(res => ({ data: res.data, source: feed.source }))
      .catch(() => null)
    );

    const feedResponses = await Promise.all(feedPromises);

    let allArticles = [];

    for (const feed of feedResponses) {
      if (!feed) continue;

      try {
        const result = await xml2js.parseStringPromise(feed.data);
        let items = result?.rss?.channel?.[0]?.item || [];

        items = items.slice(0, 40);

        const articles = items.map(item => {

          const title =
            typeof item.title?.[0] === "object"
              ? item.title[0]._ || ""
              : item.title?.[0] || "";

          const link =
            item.link?.[0]?.$?.href ||
            item.link?.[0] ||
            "";

          const text = title + link;

          return {
            title,
            link,
            pubDate: item.pubDate?.[0] || new Date().toISOString(),
            image: extractImage(item),
            source: feed.source,
            team: detectTeam(text),
            category: detectCategory(text)
          };
        });

        allArticles = allArticles.concat(articles);

      } catch (e) {}
    }

    // =======================
    // 🔥 SCRAPING (ΠΑΡΑΛΛΗΛΑ)
    // =======================
    const [sport24, sportfm, sdna] = await Promise.all([
      fetchSport24(),
      fetchSportFM(),
      fetchSDNA()
    ]);

    allArticles = allArticles.concat(sport24, sportfm, sdna);

    // =======================
    // 🔥 CLEAN
    // =======================
    allArticles = allArticles.filter(a =>
      a.title &&
      a.title.length > 20 &&
      a.link &&
      a.link.startsWith("http")
    );

    // =======================
    // 🔥 DEDUP (BY LINK)
    // =======================
    const map = new Map();

    allArticles.forEach(a => {
      if (!map.has(a.link)) {
        map.set(a.link, a);
      }
    });

    allArticles = Array.from(map.values());

    // =======================
    // 🔥 SORT
    // =======================
    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    res.json(allArticles);

  } catch (err) {
    res.status(500).json({ error: "Error fetching articles" });
  }
});

// =======================
// 🔥 SPORT24
// =======================
async function fetchSport24() {
  try {
    const response = await axios.get("https://www.sport24.gr/");
    const $ = cheerio.load(response.data);

    let articles = [];

    $("article").each((i, el) => {
      const link = $(el).find("a").first().attr("href");
      let title = $(el).find("h2").first().text().trim();

      if (!title) title = $(el).find("h3").first().text().trim();
      if (!title || title.length < 20) return;

      const text = title + link;

      articles.push({
        title,
        link: link.startsWith("http") ? link : `https://www.sport24.gr${link}`,
        image: $(el).find("img").attr("src") || "",
        pubDate: new Date().toISOString(),
        source: "Sport24",
        team: detectTeam(text),
        category: detectCategory(text)
      });
    });

    return articles.slice(0, 40);

  } catch {
    return [];
  }
}

// =======================
// 🔥 SPORTFM
// =======================
async function fetchSportFM() {
  try {
    const response = await axios.get("https://www.sport-fm.gr/rss/news");
    const result = await xml2js.parseStringPromise(response.data);
    const items = result?.rss?.channel?.[0]?.item || [];

    return items.slice(0, 30).map(item => {
      let title = item.title?.[0] || "";

      if (title.includes("|||")) {
        const parts = title.split("|||").map(p => p.trim());
        title = parts.reduce((a, b) => (a.length > b.length ? a : b));
      }

      const link = item.link?.[0] || "";
      const text = title + link;

      return {
        title,
        link,
        image: item["media:thumbnail"]?.[0]?.$.url || "",
        pubDate: item.pubDate?.[0] || new Date().toISOString(),
        source: "SportFM",
        team: detectTeam(text),
        category: detectCategory(text)
      };
    });

  } catch {
    return [];
  }
}

// =======================
// 🔥 SDNA
// =======================
async function fetchSDNA() {
  try {
    const response = await axios.get("https://www.sdna.gr/");
    const $ = cheerio.load(response.data);

    let articles = [];

    $("a").each((i, el) => {
      let title = $(el).text().trim();
      const link = $(el).attr("href");

      if (!title || title.length < 25) return;

      const text = title + link;

      if (link && link.includes("/podosfairo/")) {
        articles.push({
          title,
          link: link.startsWith("http") ? link : `https://www.sdna.gr${link}`,
          image: "",
          pubDate: new Date().toISOString(),
          source: "SDNA",
          team: detectTeam(text),
          category: detectCategory(text)
        });
      }
    });

    return articles.slice(0, 25);

  } catch {
    return [];
  }
}

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
