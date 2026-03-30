import express from 'express';
import mongoose from 'mongoose';
import axios from 'axios';
import * as cheerio from 'cheerio';
import cors from 'cors';

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

// ================= DB =================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ DB CONNECTED'))
  .catch(err => console.log('❌ DB ERROR:', err));

// ================= MODEL =================
const articleSchema = new mongoose.Schema({
  title: String,
  link: { type: String, unique: true },
  image: String,
  source: String,
  category: String,
  team: String,
  categories: [String],
  pubDate: Date
});

const Article = mongoose.model('Article', articleSchema);

// ================= FILTER =================
function isArticle(link, title) {
  if (!link || !title) return false;

  const badPatterns = [
    '/tag/', '/category/', '/author/', '/teams/', '/team-sport/',
    '/list/', '/program', '/tv', '/radio', '/app',
    'instagram', 'facebook', 'twitter', 'youtube', 'tiktok',
    '/match', '/league', '/cup'
  ];

  const badTitles = [
    'live', 'match center', 'πρόγραμμα',
    'βαθμολογίες', 'videos', 'highlights'
  ];

  const isBadLink = badPatterns.some(p => link.toLowerCase().includes(p));
  const isBadTitle = badTitles.some(p => title.toLowerCase().includes(p));

  const looksLikeArticle =
    link.split('/').length > 5 ||
    /\d{4}/.test(link);

  return !isBadLink && !isBadTitle && looksLikeArticle;
}

// ================= CATEGORY =================
function detectCategory(title, link) {
  const text = (title + ' ' + link).toLowerCase();

  if (
    text.includes('basket') ||
    text.includes('nba') ||
    text.includes('euroleague')
  ) {
    return 'BASKET';
  }

  return 'FOOTBALL';
}

// ================= TEAMS =================
function detectTeam(title) {
  const t = title.toLowerCase();

  const teams = [
    { name: "ΑΕΚ", keywords: ['αεκ'] },
    { name: "ΟΛΥΜΠΙΑΚΟΣ", keywords: ['ολυμπιακ'] },
    { name: "ΠΑΝΑΘΗΝΑΙΚΟΣ", keywords: ['παναθηναϊκ', 'παναθηναικ'] },
    { name: "ΠΑΟΚ", keywords: ['παοκ'] },
    { name: "ΑΡΗΣ", keywords: ['αρης'] },
    { name: "ΟΦΗ", keywords: ['οφη'] },
    { name: "ΒΟΛΟΣ", keywords: ['βολος'] },
    { name: "ΛΕΒΑΔΕΙΑΚΟΣ", keywords: ['λεβαδειακ'] },
    { name: "ΑΤΡΟΜΗΤΟΣ", keywords: ['ατρομητος'] },
    { name: "ΚΗΦΙΣΙΑ", keywords: ['κηφισια'] },
    { name: "ΠΑΝΑΙΤΩΛΙΚΟΣ", keywords: ['παναιτωλικ'] },
    { name: "ΑΕΛ", keywords: ['αελ'] },
    { name: "ΠΑΝΣΕΡΑΙΚΟΣ", keywords: ['πανσερραικ'] },
    { name: "ΑΣΤΕΡΑΣ", keywords: ['αστερας'] },
    { name: "ΚΑΛΑΜΑΤΑ", keywords: ['καλαματα'] },
    { name: "ΗΡΑΚΛΗΣ", keywords: ['ηρακλης'] }
  ];

  for (let team of teams) {
    if (team.keywords.some(k => t.includes(k))) {
      return team.name;
    }
  }

  return "OTHER";
}

// ================= IMAGE =================
function extractImage($) {
  let image =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('img').first().attr('src') ||
    '';

  if (image && image.startsWith('//')) {
    image = 'https:' + image;
  }

  return image;
}

// ================= SCRAPER =================
async function scrapeSite(url, source) {
  try {
    console.log(`📡 ${source}`);

    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const $ = cheerio.load(data);
    const links = [];

    $('a').each((i, el) => {
      const link = $(el).attr('href');
      const title = $(el).text().trim();

      if (link && title) {
        links.push({ link, title });
      }
    });

    console.log(`🔗 LINKS FOUND: ${source} ${links.length}`);

    for (let item of links) {
      let { link, title } = item;

      if (!link.startsWith('http')) continue;
      if (!isArticle(link, title)) continue;

      const exists = await Article.findOne({ link });
      if (exists) continue;

      try {
        const { data } = await axios.get(link);
        const $$ = cheerio.load(data);

        const image = extractImage($$);
        const category = detectCategory(title, link);
        const team = detectTeam(title);

        await Article.create({
          title,
          link,
          image,
          source,
          category,
          team,
          categories: ['ALL', category, team],
          pubDate: new Date()
        });

        console.log(`💾 SAVED: ${title}`);

      } catch (err) {
        console.log('❌ Article error');
      }
    }

  } catch (err) {
    console.log(`❌ ${source}`);
  }
}

// ================= RUN SCRAPER =================
async function runScraper() {
  console.log('🚀 SCRAPER START');

  await scrapeSite('https://www.gazzetta.gr/', 'Gazzetta');
  await scrapeSite('https://www.sport24.gr/', 'Sport24');
  await scrapeSite('https://www.sport-fm.gr/', 'SportFM');
  await scrapeSite('https://www.novasports.gr/', 'Novasports');
  await scrapeSite('https://www.sportday.gr/', 'Sportday');
  await scrapeSite('https://www.athletiko.gr/', 'Athletiko');

  console.log('✅ SCRAPER DONE');
}

// ================= ROUTES =================
app.get('/articles', async (req, res) => {
  const articles = await Article.find()
    .sort({ pubDate: -1 })
    .limit(100);

  res.json(articles);
});

// ================= START =================
app.listen(PORT, () => {
  console.log('🌍 Server running');
  runScraper();
});