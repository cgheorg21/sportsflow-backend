const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const cors = require("cors");
const cheerio = require("cheerio");

const app = express();
app.use(cors());

const PORT = 3000;

const FEEDS = [
  { url: "https://www.gazzetta.gr/rss", source: "Gazzetta" },
  { url: "https://www.sdna.gr/rss.xml", source: "SDNA" },
  { url: "https://sportday.gr/feed", source: "Sportday" },
  { url: "https://www.to10.gr/feed", source: "To10" },
  { url: "https://www.athletiko.gr/feed", source: "Athletiko" },
  { url: "https://www.novasports.gr/rss", source: "Novasports" }
];

// 🔥 IMAGE
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

app.get("/articles", async (req, res) => {
  try {
    let allArticles = [];

    // =========================
    // 🔥 RSS (SAFE VERSION)
    // =========================
    for (const feed of FEEDS) {
      try {
        const response = await axios.get(feed.url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 5000
        });

        const result = await xml2js.parseStringPromise(response.data);

        let items = [];

        if (feed.source === "SDNA") {
        items = result.rss?.channel?.[0]?.item || [];
        } else {
        items = result.rss?.channel?.[0]?.item || [];
        }

        items = items.slice(0, 50);

        // normal RSS
        if (result?.rss?.channel?.[0]?.item) {
          items = result.rss.channel[0].item;
        }

        // SDNA fallback
        else if (result?.feed?.entry) {
          items = result.feed.entry;
        }

        if (!items || items.length === 0) {
          console.log("No items:", feed.url);
          continue;
        }

        items = items.slice(0, 50);

        const articles = items.map(item => {

          let title = "";
          if (typeof item.title?.[0] === "object") {
            title = item.title[0]._ || "";
          } else {
            title = item.title?.[0] || "";
          }

          let link = "";
          if (item.link?.[0]?.$?.href) {
            link = item.link[0].$.href;
          } else {
            link = item.link?.[0] || "";
          }

          return {
            title,
            description: item.description?.[0] || "",
            link,
            pubDate: item.pubDate?.[0] || new Date().toISOString(),
            image: extractImage(item),
            source: feed.source
          };
        });

        allArticles = allArticles.concat(articles);

      } catch (err) {
        console.log("Error with feed:", feed.url);
      }
    }

    // =========================
    // 🔥 SCRAPING
    // =========================
    const sport24Articles = await fetchSport24();
    const sportFMArticles = await fetchSportFM();
    const sdnaArticles = await fetchSDNA();

    allArticles = allArticles.concat(
    sport24Articles,
    sportFMArticles,
    sdnaArticles
    );

    // =========================
    // 🔥 LIMIT PER SOURCE
    // =========================
    const limitPerSource = 20;
    const grouped = {};

    allArticles.forEach(article => {
      if (!grouped[article.source]) {
        grouped[article.source] = [];
      }
      if (grouped[article.source].length < limitPerSource) {
        grouped[article.source].push(article);
      }
    });

    allArticles = Object.values(grouped).flat();

    // =========================
    // 🔥 CLEAN
    // =========================
    allArticles = allArticles.filter(a =>
      a.title &&
      a.title.length > 20 &&
      a.title.split(" ").length > 4 &&
      a.link &&
      a.link.startsWith("http")
    );

    // =========================
    // 🔥 SORT
    // =========================
    allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    res.json(allArticles);

  } catch (error) {
    res.status(500).json({ error: "Error fetching articles" });
  }
});

// =======================
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});