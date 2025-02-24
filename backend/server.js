const express = require("express");
const { config } = require("dotenv");
const path = require("path");
const MonkeyError = require("./handlers/error");
config({ path: path.join(__dirname, ".env") });
const CronJob = require("cron").CronJob;
const cors = require("cors");
const admin = require("firebase-admin");
const Logger = require("./handlers/logger.js");
const serviceAccount = require("./credentials/serviceAccountKey.json");
const { connectDB, mongoDB } = require("./init/mongodb");

const PORT = process.env.PORT || 5005;

// MIDDLEWARE &  SETUP
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.set("trust proxy", 1);

app.use((req, res, next) => {
  if (process.env.MAINTENANCE === "true") {
    res.status(503).json({ message: "Server is down for maintenance" });
  } else {
    next();
  }
});

const userRouter = require("./api/routes/user");
app.use("/user", userRouter);
const configRouter = require("./api/routes/config");
app.use("/config", configRouter);
const resultRouter = require("./api/routes/result");
app.use("/results", resultRouter);
const presetRouter = require("./api/routes/preset");
app.use("/presets", presetRouter);
const quoteRatings = require("./api/routes/quote-ratings");
app.use("/quote-ratings", quoteRatings);
const psaRouter = require("./api/routes/psa");
app.use("/psa", psaRouter);
const leaderboardsRouter = require("./api/routes/leaderboards");
app.use("/leaderboard", leaderboardsRouter);

app.use(function (e, req, res, next) {
  let monkeyError;
  if (e.errorID) {
    //its a monkey error
    monkeyError = e;
  } else {
    //its a server error
    monkeyError = new MonkeyError(e.status, e.message, e.stack);
  }
  if (!monkeyError.uid && req.decodedToken) {
    monkeyError.uid = req.decodedToken.uid;
  }
  if (process.env.MODE !== "dev" && monkeyError.status > 400) {
    Logger.log(
      `system_error`,
      `${monkeyError.status} ${monkeyError.message}`,
      monkeyError.uid
    );
    mongoDB().collection("errors").insertOne({
      _id: monkeyError.errorID,
      timestamp: Date.now(),
      status: monkeyError.status,
      uid: monkeyError.uid,
      message: monkeyError.message,
      stack: monkeyError.stack,
    });
  }
  return res.status(e.status || 500).json(monkeyError);
});

app.get("/test", (req, res) => {
  res.send("Hello World!");
});

const LeaderboardsDAO = require("./dao/leaderboards");

app.listen(PORT, async () => {
  console.log(`listening on port ${PORT}`);
  await connectDB();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("Database Connected");

  let lbjob = new CronJob("30 4/5 * * * *", async () => {
    LeaderboardsDAO.update("time", "15", "english");
    LeaderboardsDAO.update("time", "60", "english");
  });
  lbjob.start();

  let logjob = new CronJob("0 0 0 * * *", async () => {
    let data = await mongoDB()
      .collection("logs")
      .deleteMany({ timestamp: { $lt: Date.now() - 604800000 } });
    Logger.log(
      "system_logs_deleted",
      `${data.deletedCount} logs deleted older than 7 days`,
      undefined
    );
  });
  logjob.start();
});
