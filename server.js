const express = require("express");
const path = require("path");
const app = express();

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", (req, res) => res.send("ok"));

// Adsgram "Reward URL": reklama ko'rilganda Adsgram shu manzilga so'rov yuboradi.
// Hozircha faqat qabul qilib log yozadi. Keyinroq bu yerda balansni bazada oshiramiz.
app.get("/reward", (req, res) => {
  console.log("Reward so'rovi:", req.query);
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("CoinPlay ishga tushdi, port " + PORT));
