let cache = null;
let lastFetchTime = 0;
const CACHE_DURATION = 2 * 60 * 1000; // 2 λεπτά
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
// 🔥 SPORT24
// =======================
async function fetchSport24() {
  try {
    const response = await axios.get("https://www.sport24.gr/", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(response.data);

    let articles = [];

    $("article").each((i, el) => {

      const link = $(el).find("a").first().attr("href");

      let title = $(el).find("h2").first().text().trim();

      if (!title) {
        title = $(el).find("h3").first().text().trim();
      }

      if (title.includes("\n")) {
        title = title.split("\n")[0];
      }

      // ❗ κόψε μικρά / λάθος titles
      if (!title || title.split(" ").length < 5) return;

      const image =
        $(el).find("img").attr("src") ||
        $(el).find("img").attr("data-src") ||
        "";

      if (link) {
        articles.push({
          title,
          link: link.startsWith("http")
            ? link
            : `https://www.sport24.gr${link}`,
          image,
          pubDate: new Date().toISOString(),
          source: "Sport24"
        });
      }
    });

    // 🔥 REMOVE DUPLICATES
    articles = articles.filter((a, index, self) =>
      index === self.findIndex(t => t.title === a.title)
    );

    return articles.slice(0, 50);

  } catch (err) {
    console.log("Sport24 error");
    return [];
  }
}

// =======================
// 🔥 SPORT-FM (WORKING)
// =======================
async function fetchSportFM() {
  try {
    const response = await axios.get("https://www.sport-fm.gr/rss/news", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/rss+xml"
      }
    });

    const result = await xml2js.parseStringPromise(response.data);
    const items = result?.rss?.channel?.[0]?.item || [];

    function extractId(link) {
      const match = link?.match(/article\/(\d+)/);
      return match ? match[1] : null;
    }

    const seen = new Set();
    let articles = [];

    for (const item of items.slice(0, 30)) {

      const link = item.link?.[0] || "";
      const id = extractId(link);

      if (!id || seen.has(id)) continue;
      seen.add(id);

      let title = item.title?.[0] || "";

      // 🔥 FIX |||
      if (title.includes("|||")) {
        const parts = title.split("|||").map(p => p.trim());
        title = parts.reduce((a, b) => (a.length > b.length ? a : b));
      }

      title = title.replace(/\s+/g, " ").trim();

      // 🔥 IMAGE από RSS
      let image =
        item["media:thumbnail"]?.[0]?.$.url ||
        item.enclosure?.[0]?.$.url ||
        "";

      // 🔥 FALLBACK → ΠΑΡΕ ΑΠΟ ΤΟ ΑΡΘΡΟ
      if (!image || image.length < 10) {
        try {
          const articlePage = await axios.get(link, {
            headers: { "User-Agent": "Mozilla/5.0" }
          });

          const $ = cheerio.load(articlePage.data);

          image =
            $("meta[property='og:image']").attr("content") ||
            $("meta[name='twitter:image']").attr("content") ||
            "";

        } catch (e) {
          console.log("Image fetch failed:", link);
        }
      }

      articles.push({
        title,
        link,
        image,
        pubDate: item.pubDate?.[0] || new Date().toISOString(),
        source: "SportFM"
      });
    }

    return articles;

  } catch (err) {
    console.log("SportFM error", err.message);
    return [];
  }
}
//SDNA
async function fetchSDNA() {
  try {
    const response = await axios.get("https://www.sdna.gr/", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const $ = cheerio.load(response.data);
    let articles = [];

    const links = $("a").toArray();

for (const el of links) {

  let title = $(el).text().trim();
  const link = $(el).attr("href");

  title = title.replace(/\s+/g, " ");

  if (
    !title ||
    title.length < 25 ||
    title.includes("LIVE") ||
    title.includes("BC") ||
    title.includes("Stoiximan") ||
    title.includes("getScore") ||
    title.match(/^\d+$/)
  ) continue;

  let image =
  $(el).find("img").attr("src") ||
  $(el).find("img").attr("data-src") ||
  $(el).find("img").attr("data-original") ||
  $(el).closest("article").find("img").attr("src") ||
  $(el).closest("article").find("img").attr("data-src") ||
  $(el).closest("article").find("img").attr("data-original") ||
  "";

if (image && image.startsWith("data")) {
  image = "";
}

const srcset = $(el).find("img").attr("srcset");
if ((!image || image.length < 10) && srcset) {
  image = srcset.split(",")[0].split(" ")[0];
}

// 👉 FIX PATH
if (image && image.startsWith("/")) {
  image = "https://www.sdna.gr" + image;
}

// fallback στο άρθρο
if ((!image || image.length < 10) && link) {
  try {
    const articlePage = await axios.get(
      link.startsWith("http")
        ? link
        : `https://www.sdna.gr${link}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );

    const $$ = cheerio.load(articlePage.data);

    image =
      $$("meta[property='og:image']").attr("content") ||
      $$("img").first().attr("src") ||
      "";

  } catch (e) {}
}

  if (
    link &&
    (
      link.includes("/podosfairo/") ||
      link.includes("/mpasket/")
    )
  ) {
    articles.push({
      title,
      link: link.startsWith("http")
        ? link
        : `https://www.sdna.gr${link}`,
      image,
      pubDate: new Date().toISOString(),
      source: "SDNA"
    });
  }
};

    // dedup
    articles = articles.filter((a, i, self) =>
      i === self.findIndex(t => t.title === a.title)
    );

    return articles.slice(0, 25);

  } catch (err) {
    console.log("SDNA error", err.message);
    return [];
  }
}
// =======================
async function fetchAndCacheArticles() {
  try {
    console.log("Auto fetching...");

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

    cache = allArticles;
    lastFetchTime = Date.now();

    console.log("Cache updated:", allArticles.length);

  } catch (err) {
    console.log("Auto fetch error:", err.message);
  }
}
// 🔥 MAIN ROUTE
// =======================
app.get("/articles", (req, res) => {
  if (cache) {
    return res.json(cache);
  } else {
    return res.json([]);
  }
});
// =======================
fetchAndCacheArticles(); // τρέχει μόλις ανοίξει ο server
setInterval(fetchAndCacheArticles, 2 * 60 * 1000); // κάθε 2 λεπτά
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
