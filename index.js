const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= HELPERS =================
const getHTML = async (url) => {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "el-GR,el;q=0.9"
    }
  });
  return data;
};

const clean = (t) => t?.replace(/\s+/g, " ").trim();

const isValid = (title) => title && title.length > 15;

// ================= SCRAPERS =================

// 1️⃣ SPORT24
const scrapeSport24 = async () => {
  try {
    const html = await getHTML("https://www.sport24.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article").each((_, el) => {
      const title = clean($(el).find("h2, h3").text());
      let link = $(el).find("a").attr("href");

      if (!title || !link) return;
      if (!link.startsWith("http")) link = "https://www.sport24.gr" + link;

      if (!isValid(title)) return;

      articles.push({ title, link, source: "Sport24" });
    });

    console.log("Sport24:", articles.length);
    return articles;
  } catch (e) {
    console.log("Sport24 ERROR", e.message);
    return [];
  }
};

// 2️⃣ ATHLETIKO
const scrapeAthletiko = async () => {
  try {
    const html = await getHTML("https://www.athletiko.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("article h2 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;
      if (!link.startsWith("http")) link = "https://www.athletiko.gr" + link;

      articles.push({ title, link, source: "Athletiko" });
    });

    console.log("Athletiko:", articles.length);
    return articles;
  } catch (e) {
    console.log("Athletiko ERROR", e.message);
    return [];
  }
};

// 3️⃣ SDNA (403 FIX)
const scrapeSDNA = async () => {
  try {
    const html = await axios.get("https://www.sdna.gr/", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://google.com"
      }
    }).then(r => r.data);

    const $ = cheerio.load(html);
    const articles = [];

    $("h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;
      if (!link.startsWith("http")) link = "https://www.sdna.gr" + link;

      articles.push({ title, link, source: "SDNA" });
    });

    console.log("SDNA:", articles.length);
    return articles;
  } catch (e) {
    console.log("SDNA ERROR", e.message);
    return [];
  }
};

// 4️⃣ ONSPORTS
const scrapeOnsports = async () => {
  try {
    const html = await getHTML("https://www.onsports.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;
      if (!link.startsWith("http")) link = "https://www.onsports.gr" + link;

      articles.push({ title, link, source: "Onsports" });
    });

    console.log("Onsports:", articles.length);
    return articles;
  } catch (e) {
    console.log("Onsports ERROR", e.message);
    return [];
  }
};

// 5️⃣ GAZZETTA
const scrapeGazzetta = async () => {
  try {
    const html = await getHTML("https://www.gazzetta.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;
      if (!link.startsWith("http")) link = "https://www.gazzetta.gr" + link;

      articles.push({ title, link, source: "Gazzetta" });
    });

    console.log("Gazzetta:", articles.length);
    return articles;
  } catch (e) {
    console.log("Gazzetta ERROR", e.message);
    return [];
  }
};

// 6️⃣ TO10
const scrapeTo10 = async () => {
  try {
    const html = await getHTML("https://www.to10.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("h2 a, h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;

      articles.push({ title, link, source: "To10" });
    });

    console.log("To10:", articles.length);
    return articles;
  } catch (e) {
    console.log("To10 ERROR", e.message);
    return [];
  }
};

// 7️⃣ SPORTDAY
const scrapeSportday = async () => {
  try {
    const html = await getHTML("https://sportday.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;
      if (!link.startsWith("http")) link = "https://sportday.gr" + link;

      articles.push({ title, link, source: "Sportday" });
    });

    console.log("Sportday:", articles.length);
    return articles;
  } catch (e) {
    console.log("Sportday ERROR", e.message);
    return [];
  }
};

// 8️⃣ NOVASPORTS
const scrapeNovasports = async () => {
  try {
    const html = await getHTML("https://www.novasports.gr/");
    const $ = cheerio.load(html);

    const articles = [];

    $("h3 a").each((_, el) => {
      const title = clean($(el).text());
      let link = $(el).attr("href");

      if (!title || !link) return;
      if (!link.startsWith("http")) link = "https://www.novasports.gr" + link;

      articles.push({ title, link, source: "Novasports" });
    });

    console.log("Novasports:", articles.length);
    return articles;
  } catch (e) {
    console.log("Novasports ERROR", e.message);
    return [];
  }
};

// ================= ROUTE =================
app.get("/articles", async (req, res) => {
  try {
    const results = await Promise.all([
      scrapeSport24(),
      scrapeAthletiko(),
      scrapeSDNA(),
      scrapeOnsports(),
      scrapeGazzetta(),
      scrapeTo10(),
      scrapeSportday(),
      scrapeNovasports()
    ]);

    const all = results.flat();

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