const express = require("express");
const axios = require("axios");
const cors = require("cors");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

// ================= GLOBAL HEADERS (ANTI-BLOCK) =================
axios.defaults.headers.common["User-Agent"] =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";

axios.defaults.headers.common["Accept"] =
  "text/html,application/xhtml+xml";

axios.defaults.headers.common["Accept-Language"] =
  "el-GR,el;q=0.9,en-US;q=0.8";

axios.defaults.headers.common["Referer"] = "https://www.google.com/";

// ================= HELPERS =================
const normalize = (t = "") =>
  t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const teamMap = {
  ΠΑΟΚ: /παοκ/,
  ΟΛΥΜΠΙΑΚΟΣ: /ολυμπιακ/,
  ΠΑΝΑΘΗΝΑΙΚΟΣ: /παναθην/,
  ΑΕΚ: /\bαεκ\b/,
  ΑΡΗΣ: /αρη/,
};

const detectTeam = (text = "") => {
  const t = normalize(text);
  for (const [team, regex] of Object.entries(teamMap)) {
    if (regex.test(t)) return team;
  }
  return "OTHER";
};

const detectCategory = (title = "", url = "", sourceCategory) => {
  const t = normalize(title + " " + url);

  if (t.includes("basket") || t.includes("μπασκετ")) return "BASKET";
  if (t.includes("football") || t.includes("ποδοσφ")) return "FOOTBALL";

  return sourceCategory || "ALL";
};

const buildUrl = (href, base) => {
  try {
    if (!href || href.startsWith("#")) return null;
    if (href.startsWith("http")) return href;
    return new URL(href, base).href;
  } catch {
    return null;
  }
};

const isArticle = (url) => {
  try {
    const u = new URL(url);
    return (
      u.pathname.length > 10 &&
      !u.pathname.includes("tag") &&
      !u.pathname.includes("category")
    );
  } catch {
    return false;
  }
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ================= SCRAPER =================
const MAX_LINKS = 12; // μικρό για ταχύτητα

async function fetchArticle(url, source, sourceCategory) {
  try {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);

    let title =
      $("meta[property='og:title']").attr("content") ||
      $("h1").first().text() ||
      $("title").text();

    if (!title) return null;
    title = title.trim();
    if (title.length < 3) return null;

    let image =
      $("meta[property='og:image']").attr("content") ||
      $("img").first().attr("src");

    if (image?.startsWith("//")) image = "https:" + image;
    if (image?.startsWith("/")) image = new URL(image, url).href;

    const team = detectTeam(title);
    const baseCategory = detectCategory(title, url, sourceCategory);

    const categories = new Set(["ALL"]);
    if (baseCategory !== "ALL") categories.add(baseCategory);
    if (team !== "OTHER") categories.add(team);
    categories.add(source);

    return {
      title,
      link: url,
      image:
        image || "https://via.placeholder.com/600x400?text=Sport",
      source,
      team,
      category: baseCategory,
      categories: Array.from(categories),
    };
  } catch {
    return null;
  }
}

async function scrape(site) {
  try {
    const res = await axios.get(site.url);
    const $ = cheerio.load(res.data);

    const links = new Set();

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const full = buildUrl(href, site.base);
      if (full && isArticle(full)) links.add(full);
    });

    const articles = [];
    const list = Array.from(links).slice(0, MAX_LINKS);

    for (const link of list) {
      const a = await fetchArticle(link, site.name, site.category);
      if (a) articles.push(a);

      await delay(150);
    }

    return articles;
  } catch {
    return [];
  }
}

// ================= SOURCES =================
const sources = [
  { name: "Gazzetta", category: "FOOTBALL", url: "https://www.gazzetta.gr/football", base: "https://www.gazzetta.gr" },
  { name: "Gazzetta", category: "BASKET", url: "https://www.gazzetta.gr/basketball", base: "https://www.gazzetta.gr" },

  { name: "Sport24", category: "FOOTBALL", url: "https://www.sport24.gr/football/", base: "https://www.sport24.gr" },
  { name: "Sport24", category: "BASKET", url: "https://www.sport24.gr/basket/", base: "https://www.sport24.gr" },

  { name: "To10", category: "FOOTBALL", url: "https://www.to10.gr/category/podosfero/", base: "https://www.to10.gr" },
  { name: "To10", category: "BASKET", url: "https://www.to10.gr/category/basket/", base: "https://www.to10.gr" },

  { name: "SportFM", category: "FOOTBALL", url: "https://www.sport-fm.gr/list/podosfairo/1", base: "https://www.sport-fm.gr" },
];

// ================= API =================
app.get("/articles", async (req, res) => {
  console.log("FETCH ARTICLES");

  const all = [];

  for (const s of sources) {
    const r = await scrape(s);
    all.push(...r);
  }

  res.json(all);
});

app.listen(PORT, () => console.log("Server running"));