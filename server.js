const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const client = new MongoClient(process.env.MONGO_URI);

const app = express();
const port = 3000;

// Dummy user credentials for testing
const dummyUser = {
    username: "user",
    password: "password",
};

app.use(bodyParser.json());
app.use(
    session({
        secret: "secret-key",
        resave: true,
        saveUninitialized: true,
    }),
);

// Middleware to check if user is authenticated
function auth(req, res, next) {
    if (req?.session?.user) {
        return next();
    } else {
        return res.sendStatus(401);
    }
}

app.post("/login", function (req, res) {
    const { username, password } = req.body;

    // TODO: Replace with actual authentication logic
    if (username === dummyUser.username && password === dummyUser.password) {
        req.session.user = username;
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

app.post("/logout", function (req, res) {
    req.session.destroy();
    res.sendStatus(200);
});

app.get("/protected", auth, function (req, res) {
    res.send("You are authenticated");
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
