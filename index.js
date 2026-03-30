const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const puppeteer = require("puppeteer");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log(err));

// ================= MODEL =================
const Article = mongoose.model("Article", new mongoose.Schema({
  title: String,
  link: { type: String, unique: true },
  image: String,
  content: String,
  pubDate: Date,
  source: String,
  category: String
}));

// ================= CATEGORY =================
function detectCategory(text) {
  text = text.toLowerCase();
  if (["nba","euroleague","μπασκετ"].some(k => text.includes(k))) return "basket";
  if (["ποδοσφ","football","super league"].some(k => text.includes(k))) return "football";
  return "other";
}

// ================= BROWSER =================
let browser;

async function initBrowser() {
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
}

// ================= SCRAPE PAGE =================
async function scrapePage(url, source) {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a"))
        .map(a => a.href)
        .filter(href => href.includes("/") && href.length > 30);
    });

    let articles = [];

    for (const link of links.slice(0, 20)) {
      try {
        const articlePage = await browser.newPage();
        await articlePage.goto(link, { waitUntil: "domcontentloaded" });

        const data = await articlePage.evaluate(() => {
          const title =
            document.querySelector("meta[property='og:title']")?.content ||
            document.title;

          const image =
            document.querySelector("meta[property='og:image']")?.content ||
            "";

          const paragraphs = Array.from(document.querySelectorAll("p"))
            .map(p => p.innerText)
            .join(" ");

          return { title, image, content: paragraphs };
        });

        await articlePage.close();

        if (!data.title || data.title.length < 20) continue;

        articles.push({
          title: data.title,
          link,
          image: data.image,
          content: data.content,
          pubDate: new Date(),
          source,
          category: detectCategory(data.title + data.content)
        });

      } catch {}
    }

    await page.close();
    return articles;

  } catch {
    await page.close();
    return [];
  }
}

// ================= FULL CRAWL =================
async function crawlAll() {
  console.log("PUPPETEER CRAWLING...");

  const results = await Promise.all([
    scrapePage("https://www.gazzetta.gr/football", "Gazzetta"),
    scrapePage("https://www.sdna.gr/podosfairo", "SDNA"),
    scrapePage("https://www.sport24.gr/", "Sport24"),
    scrapePage("https://www.to10.gr/", "To10"),
    scrapePage("https://sportday.gr/", "Sportday"),
    scrapePage("https://www.sport-fm.gr/", "SportFM"),
    scrapePage("https://www.athletiko.gr/", "Athletiko")
  ]);

  const all = results.flat();

  for (const a of all) {
    try {
      await Article.updateOne(
        { link: a.link },
        { $setOnInsert: a },
        { upsert: true }
      );
    } catch {}
  }

  console.log("Saved:", all.length);
}

// ================= RUN =================
(async () => {
  await initBrowser();
  await crawlAll();
  setInterval(crawlAll, 180000);
})();

// ================= API =================
app.get("/articles", async (req, res) => {
  const { page = 1 } = req.query;

  const data = await Article.find()
    .sort({ pubDate: -1 })
    .skip((page - 1) * 20)
    .limit(20);

  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server running");
});