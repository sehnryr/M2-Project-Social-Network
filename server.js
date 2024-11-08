const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const client = new MongoClient(process.env.MONGODB_ADDON_URI);

const sessionMiddleware = session({
    secret: "secret-key",
    resave: true,
    saveUninitialized: true,
});

app.use(express.static("public"));
app.use(bodyParser.json());
app.use(sessionMiddleware);

io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Middleware to check if user is authenticated
function auth(req, res, next) {
    if (req?.session?.user) {
        return next();
    } else {
        return res.sendStatus(401);
    }
}

// Middleware to check if the id is a valid ObjectId
function validateId(req, res, next) {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
        return res.sendStatus(400);
    }

    next();
}

// Middleware to check the values of an event body
function validateEvent(req, res, next) {
    const { title, theme, imageUrl, price, date } = req.body;

    // Check if theme is valid
    if (theme && !["sport", "culture", "festif", "pro", "autres"].includes(theme)) {
        return res.sendStatus(400);
    }

    // Check if price is a number
    if (price && isNaN(price)) {
        return res.sendStatus(400);
    }

    // Check if date is a valid date
    if (date && isNaN(Date.parse(date))) {
        return res.sendStatus(400);
    }

    next();
}

app.post("/login", async function (req, res) {
    const { username, password } = req.body;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const usersCollection = database.collection("users");
        const user = await usersCollection.findOne({
            username: username,
            password: password,
        });

        if (user) {
            req.session.user = username;
            res.sendStatus(200);
        } else {
            res.sendStatus(401);
        }
    } finally {
        await client.close();
    }
});

app.post("/logout", function (req, res) {
    req.session.destroy();
    res.sendStatus(200);
});

app.post("/register", async function (req, res) {
    const { username, password } = req.body;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const usersCollection = database.collection("users");
        const user = await usersCollection.findOne({
            username: username,
        });

        if (user) {
            res.sendStatus(409);
        } else {
            await usersCollection.insertOne({
                username: username,
                password: password,
                status: "user",
                avatarUrl: null,
                firstname: null,
                lastname: null,
                birthdate: null,
            });
            res.sendStatus(201);
        }
    } finally {
        await client.close();
    }
});

app.get("/details", auth, async function (req, res) {
    const username = req.session.user;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const usersCollection = database.collection("users");
        const user = await usersCollection.findOne(
            { username: username },
            { projection: { _id: 0 } },
        );

        const eventsCollection = database.collection("events");
        const events = await eventsCollection
            .find({ username: username }, { projection: { username: 0 } })
            .toArray();

        const favoritesCollection = database.collection("favorites");
        const favorites = await favoritesCollection
            .find({ username: username }, { projection: { _id: 0, username: 0 } })
            .toArray();

        if (user) {
            res.json({
                ...user,
                events: events,
                favorites: favorites,
            });
        } else {
            res.sendStatus(404);
        }
    } finally {
        await client.close();
    }
});

app.patch("/details", auth, async function (req, res) {
    const username = req.session.user;
    const { firstname, lastname, birthdate, avatarUrl } = req.body;

    // Check if birthdate is a valid date
    if (birthdate && isNaN(Date.parse(birthdate))) {
        return res.sendStatus(400);
    }

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const usersCollection = database.collection("users");
        const user = await usersCollection.findOne({ username: username });

        if (user) {
            const payload = {
                ...(firstname && { firstname: firstname }),
                ...(lastname && { lastname: lastname }),
                ...(birthdate && { birthdate: birthdate }),
                ...(avatarUrl && { avatarUrl: avatarUrl }),
            };

            await usersCollection.updateOne({ username: username }, { $set: payload });
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } finally {
        await client.close();
    }
});

app.get("/events", async function (req, res) {
    const {
        name,
        lePrice,
        ltPrice,
        gePrice,
        gtPrice,
        theme,
        beforeDate,
        afterDate,
        sortPrice,
        sortDate,
    } = req.query;

    if (lePrice && isNaN(lePrice)) {
        return res.sendStatus(400);
    }

    if (ltPrice && isNaN(ltPrice)) {
        return res.sendStatus(400);
    }

    if (gePrice && isNaN(gePrice)) {
        return res.sendStatus(400);
    }

    if (gtPrice && isNaN(gtPrice)) {
        return res.sendStatus(400);
    }

    if (theme && !["sport", "culture", "festif", "pro", "autres"].includes(theme)) {
        return res.sendStatus(400);
    }

    if (beforeDate && isNaN(Date.parse(beforeDate))) {
        return res.sendStatus(400);
    }

    if (afterDate && isNaN(Date.parse(afterDate))) {
        return res.sendStatus(400);
    }

    if (sortPrice && !["ascendent", "descendent"].includes(sortPrice)) {
        return res.sendStatus(400);
    }

    if (sortDate && !["ascendent", "descendent"].includes(sortDate)) {
        return res.sendStatus(400);
    }

    const price = {
        ...(lePrice && { $lte: parseFloat(lePrice) }),
        ...(ltPrice && { $lt: parseFloat(ltPrice) }),
        ...(gePrice && { $gte: parseFloat(gePrice) }),
        ...(gtPrice && { $gt: parseFloat(gtPrice) }),
    };

    const date = {
        ...(beforeDate && { $lte: new Date(beforeDate) }),
        ...(afterDate && { $gte: new Date(afterDate) }),
    };

    const query = {
        ...(name && { title: { $regex: name, $options: "i" } }),
        ...(price && Object.keys(price).length > 0 && { price: price }),
        ...(theme && { theme: theme }),
        ...(date && Object.keys(date).length > 0 && { date: date }),
    };

    const sort = {
        ...(sortPrice && { price: sortPrice === "ascendent" ? 1 : -1 }),
        ...(sortDate && { date: sortDate === "ascendent" ? 1 : -1 }),
    };

    const options = {
        ...(sort && Object.keys(sort).length > 0 && { sort: sort }),
    };

    console.log(query);

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const eventsCollection = database.collection("events");
        const events = await eventsCollection.find(query, options).toArray();
        res.json(events);
    } finally {
        await client.close();
    }
});

app.get("/event/:id", validateId, async function (req, res) {
    const { id } = req.params;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const eventsCollection = database.collection("events");
        const event = await eventsCollection.findOne({ _id: new ObjectId(id) });

        const favoritesCollection = database.collection("favorites");
        const favorites = await favoritesCollection
            .find({ eventId: id }, { projection: { _id: 0, eventId: 0 } })
            .toArray();

        if (event) {
            res.json({
                ...event,
                favorites: favorites,
            });
        } else {
            res.sendStatus(404);
        }
    } finally {
        await client.close();
    }
});

app.post("/event", auth, validateEvent, async function (req, res) {
    const username = req.session.user;
    const { title, theme, imageUrl, price, date } = req.body;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const eventsCollection = database.collection("events");

        await eventsCollection.insertOne({
            username: username,
            title: title,
            theme: theme,
            imageUrl: imageUrl,
            price: price,
            date: date,
        });

        res.sendStatus(201);
    } finally {
        await client.close();
    }
});

app.patch("/event/:id", auth, validateId, validateEvent, async function (req, res) {
    const { id } = req.params;
    const username = req.session.user;
    const { title, theme, imageUrl, price, date } = req.body;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const eventsCollection = database.collection("events");
        const event = await eventsCollection.findOne({
            _id: new ObjectId(id),
            username: username,
        });

        if (event) {
            const payload = {
                ...(title && { title: title }),
                ...(theme && { theme: theme }),
                ...(imageUrl && { imageUrl: imageUrl }),
                ...(price && { price: price }),
                ...(date && { date: date }),
            };

            await eventsCollection.updateOne({ _id: new ObjectId(id) }, { $set: payload });
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } finally {
        await client.close();
    }
});

app.delete("/event/:id", auth, validateId, async function (req, res) {
    const { id } = req.params;
    const username = req.session.user;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const eventsCollection = database.collection("events");
        const event = await eventsCollection.findOne({
            _id: new ObjectId(id),
            username: username,
        });

        if (event) {
            await eventsCollection.deleteOne({ _id: new ObjectId(id) });
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } finally {
        await client.close();
    }
});

app.post("/event/:id/favorite", auth, validateId, async function (req, res) {
    const { id } = req.params;
    const username = req.session.user;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const eventsCollection = database.collection("events");
        const event = await eventsCollection.findOne({ _id: new ObjectId(id) });

        if (event) {
            const favoritesCollection = database.collection("favorites");
            const favorite = await favoritesCollection.findOne({ username: username, eventId: id });

            if (favorite) {
                res.sendStatus(409);
            } else {
                await favoritesCollection.insertOne({
                    username: username,
                    eventId: id,
                });
                res.sendStatus(201);
            }
        } else {
            res.sendStatus(404);
        }
    } finally {
        await client.close();
    }
});

app.delete("/event/:id/favorite", auth, validateId, async function (req, res) {
    const { id } = req.params;
    const username = req.session.user;

    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const favoritesCollection = database.collection("favorites");
        const favorite = await favoritesCollection.findOne({ username: username, eventId: id });

        if (favorite) {
            await favoritesCollection.deleteOne({ username: username, eventId: id });
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } finally {
        await client.close();
    }
});

app.get("/history", auth, async function (req, res) {
    try {
        await client.connect();
        const database = client.db(process.env.MONGODB_ADDON_DB);
        const messagesCollection = database.collection("messages");
        const messages = await messagesCollection
            .find({}, { sort: { date: -1 }, projection: { _id: 0 }, limit: 100 })
            .toArray();
        res.json(messages.reverse());
    } finally {
        await client.close();
    }
});

io.on("connection", (socket) => {
    const session = socket.request.session;

    if (!session || !session.user) {
        socket.disconnect(true);
        return;
    }

    const username = session.user;

    // TODO: Handle user connection

    socket.on("message", async function (msg) {
        // If message is empty, ignore
        if (!msg) {
            return;
        }

        // Truncate message if it's too long
        const maxLength = 2000;
        const message = msg.length > maxLength ? msg.substring(0, maxLength) : msg;

        // Build message payload
        const payload = {
            username: username,
            message: message,
            date: new Date(),
        };

        // Broadcast message to all connected clients
        io.emit("message", payload);

        // Save message to database
        try {
            await client.connect();
            const database = client.db(process.env.MONGODB_ADDON_DB);
            const messagesCollection = database.collection("messages");
            await messagesCollection.insertOne(payload);
        } finally {
            await client.close();
        }
    });

    socket.on("disconnect", () => {
        // TODO: Handle user disconnect
    });
});

server.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
